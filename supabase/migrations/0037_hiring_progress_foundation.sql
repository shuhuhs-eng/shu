-- ============================================================================
-- Beauty Reach — 0037_hiring_progress_foundation
--
-- 法人・複数店舗対応 Phase 8。面談・選考・採用進捗管理のDB基盤。
--
-- ★【状態: 案（未適用・未commit）】レビュー用。Supabaseへは適用しない。
--
-- ★実装前に確認した現行schema（この前提に基づいて設計）:
--   ・面談/選考/採用/候補者に相当する既存テーブル・RPC・enumは存在しない
--     （全migrationを grep 済み。interview は notifications.type の
--     'interview_action_required'（0023、未使用の通知種別）が唯一の言及）。
--   ・scouts.response_status / salary_offers.status は「返信・条件提示」の
--     状態であり、面談・選考・採用の状態ではない。これらへ詰め込まず、
--     別テーブルで管理する（既存statusの意味は一切変更しない）。
--   ・stylist_salon_interests / scouts / salary_offers は store_id を持つ
--     （0032/0035）。採用進捗はこれらと独立した「店舗×美容師」の1行とする。
--   ・店舗アクセス判定は is_store_accessible(store_id)（0026）。
--     会社(salon_organizations)は salon_stores.organization_id で解決できる
--     ため、organization_id は重複保存しない（会社集計は salon_stores を
--     JOIN するだけでよい）。
--   ・notifications.type はCHECK制約で種別が固定、かつ
--     unique(user_id, type, related_entity_id) のため、同一進捗での
--     面談日時変更等の繰り返し通知が成立しない。通知は今回扱わない
--     （後続で制約の拡張とあわせて設計する）。
--
-- ★監査記録の保全（削除方針）:
--   hired は将来の成功報酬・請求の根拠になりうるため、親データの削除で
--   採用進捗・履歴が連鎖的に消えないようにする。
--   ・store_id        … FK on delete RESTRICT。既存運用では店舗を物理削除せず
--                       salon_stores.status / usage_status で管理しており
--                       （アプリに店舗のDELETE処理は無い）、採用進捗のある店舗
--                       （およびそれを含む会社）の物理削除は拒否する。
--   ・各user id       … stylist_user_id / created_by / updated_by /
--                       hired_by_user_id / events.actor_user_id は FK無しの
--                       履歴識別子uuid。auth.usersの削除（退会・退職）は
--                       妨げず、かつ採用記録・履歴も消えない。
--   ・source_*_id     … FK無し（過去の起点の参照。scouts/salary_offersが
--                       消えても source との整合を崩さない）。
--   ・events          … hiring_process_id は FK on delete RESTRICT。かつ
--                       UPDATE/DELETE をtriggerで禁止（完全な追記専用）。
--                       processも履歴を持つため物理削除できない。
--   ・authenticated/anon には引き続きDELETE権限なし（テーブル権限なし）。
--   ※将来アカウント削除時に表示名が必要になる場合は、表示用snapshot列を
--     追加する（別migration）。個人情報の削除要請への対応（匿名化）も同様に、
--     専用RPCで別設計とする。
--
-- ★データモデル:
--   store_hiring_processes       … current row。unique(store_id, stylist_user_id)。
--                                  同じ美容師が同じ会社の2店舗と進める場合は
--                                  店舗ごとに別の行になる。
--   store_hiring_process_events  … 追記専用の履歴（誰がいつ何を変更したか）。
--
-- ★公開範囲の分離（最重要）:
--   ・両テーブルとも RLS有効・ポリシー無し・anon/authenticatedへの
--     テーブル権限なし＝直接のSELECT/INSERT/UPDATE/DELETEは一切不可。
--     internal_note / reason_code / reason_note / 各user idなど、美容師に
--     見せてはいけない列が同じ行にあるため、列単位の公開制御に頼らず、
--     必ずSECURITY DEFINER RPC経由にする。
--   ・店舗側RPC（salon role + is_store_accessible）は社内メモ・理由を返す。
--   ・美容師側RPC（stylist role + stylist_user_id = auth.uid()）は、
--     店舗名・状況・面談情報・店舗からの案内(candidate_message)・
--     公開メモ(public_note)のみを返す。internal_note・reason_*・
--     スタッフのuser idは絶対に返さない。
--
-- ★ステータス（日本語UI）:
--   contacting          連絡調整中（面談前）
--   interview_scheduled 面談予定
--   interview_completed 面談済み
--   selection           選考中
--   offered             内定
--   hired               採用（確定）
--   declined            辞退（declined_by = stylist / store）
--   rejected            不採用（店舗判断）
--   ※「interested」は採用進捗には含めない。stylist_salon_interestsが担う。
--
-- ★採用進捗の開始（手動登録を採用）:
--   add_hiring_candidate() で店舗スタッフが明示的に「採用進捗に追加」する。
--   自動登録はしない（Interestやスカウト返信だけで勝手に候補者化しない）。
--   ただし何の接点もない美容師を追加できないよう、次のいずれかを必須とする:
--     ・その店舗へのInterest（stylist_salon_interests.store_id）
--     ・その店舗のスカウトに対する前向きな返信（interested / question）
--     ・その店舗の給与オファーが承諾（accepted）または条件相談（revision_requested）
--   起点(source)はRPCが実データから決定する（クライアントを信用しない）。
--
-- ★採用確定(hired):
--   offered からのみ遷移でき、hired_at / hired_by_user_id を記録する。
--   unique(store_id, stylist_user_id)により同一店舗×美容師でhiredが2つ
--   作られることはなく、BEFORE UPDATE triggerでhired後の状態戻し・
--   hired_atの書き換えを禁止する（成功報酬・請求の起点として不変にする）。
--
-- ★権限:
--   読み取り（店舗側）: salon role + is_store_accessible(store_id)。
--           store_members.role = viewer も閲覧できる。他店舗・他社の進捗は
--           存在有無も含めて「見つからない」として扱う。
--   書き込み（店舗側）: salon role + can_manage_store_hiring(store_id)。
--           viewerは完全な閲覧専用で、書き込みは一切できない。書き込める者:
--             A. 所属organizationの company_owner / company_admin /
--                recruiting_admin（その会社の全店舗）
--             B. organization role = area_manager で、対象store_idの
--                store_members割当がある店舗（割当のstore_members.roleが
--                viewerでも「担当店舗の割当」として書き込み可）
--             C. 対象店舗の store_members.role = store_manager / recruiter
--   美容師側: stylist role + stylist_user_id = auth.uid() のみ。
--
-- ★既存関数・既存テーブルは一切変更しない（0001〜0036は無変更）。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. store_hiring_processes（current row）
-- ----------------------------------------------------------------------------
create table public.store_hiring_processes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.salon_stores(id) on delete restrict,
  -- FK無し: 退会等でauth.usersが消えても採用記録を残す履歴識別子。
  stylist_user_id uuid not null,

  status text not null default 'contacting' check (status in (
    'contacting', 'interview_scheduled', 'interview_completed',
    'selection', 'offered', 'hired', 'declined', 'rejected'
  )),

  -- 起点。RPCが実データから決める。source_*_idは起点の行への履歴参照（FK無し。
  -- 起点の行が消えても source との整合制約を崩さない）。
  source text not null check (source in ('interest', 'scout', 'salary_offer')),
  source_scout_id uuid,
  source_salary_offer_id uuid,

  -- 面談（美容師にも見せる）。
  interview_at timestamptz,
  interview_type text check (interview_type in ('online', 'in_person', 'phone')),
  interview_location text check (interview_location is null or char_length(interview_location) <= 500),

  -- 店舗から美容師への案内（美容師に見せる）。
  candidate_message text check (candidate_message is null or char_length(candidate_message) <= 1000),

  -- ★社内メモ（美容師には絶対に見せない）。
  internal_note text check (internal_note is null or char_length(internal_note) <= 2000),

  -- 辞退・不採用。declined_byで美容師起点/店舗起点を区別。
  -- reason_code / reason_noteは将来の分析用で、美容師には自動公開しない。
  declined_by text check (declined_by in ('stylist', 'store')),
  reason_code text check (reason_code in (
    'skill_mismatch', 'culture_mismatch', 'conditions_mismatch',
    'timing', 'other_offer', 'position_filled', 'other'
  )),
  reason_note text check (reason_note is null or char_length(reason_note) <= 1000),

  -- 採用確定情報（請求等の起点）。
  hired_at timestamptz,
  hired_by_user_id uuid,  -- FK無し（履歴識別子）
  closed_at timestamptz,

  created_by_user_id uuid,  -- FK無し（履歴識別子）
  updated_by_user_id uuid,  -- FK無し（履歴識別子）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- ★同じ店舗×美容師は1行のみ。別店舗なら別の行（同一会社の2店舗でも混同しない）。
  constraint store_hiring_processes_store_stylist_unique unique (store_id, stylist_user_id),
  -- 面談日時を持つなら形式も必須。
  constraint store_hiring_processes_interview_type_required
    check (interview_at is null or interview_type is not null),
  -- hiredと採用確定日時は常に一致する。
  constraint store_hiring_processes_hired_consistency
    check ((status = 'hired') = (hired_at is not null)),
  -- declinedのときだけ辞退起点を持つ。
  constraint store_hiring_processes_declined_by_consistency
    check ((status = 'declined') = (declined_by is not null)),
  -- sourceと起点IDの整合をDBで保証する。
  constraint store_hiring_processes_source_consistency check (
    (source = 'interest'     and source_scout_id is null     and source_salary_offer_id is null)
    or (source = 'scout'        and source_scout_id is not null and source_salary_offer_id is null)
    or (source = 'salary_offer' and source_scout_id is null     and source_salary_offer_id is not null)
  )
);
create index store_hiring_processes_store_status_idx on public.store_hiring_processes(store_id, status);
create index store_hiring_processes_stylist_idx on public.store_hiring_processes(stylist_user_id);

comment on table public.store_hiring_processes is
  '面談・選考・採用進捗（店舗×美容師の現在の状態）。organization_idは持たず、salon_stores.organization_idで会社集計する。直接アクセス不可、必ずSECURITY DEFINER RPC経由。internal_note/reason_*は美容師に公開しない。';

-- ----------------------------------------------------------------------------
-- 2. store_hiring_process_events（追記専用の履歴）
-- ----------------------------------------------------------------------------
create table public.store_hiring_process_events (
  id uuid primary key default gen_random_uuid(),
  hiring_process_id uuid not null references public.store_hiring_processes(id) on delete restrict,
  event_type text not null check (event_type in (
    'candidate_added', 'interview_scheduled', 'interview_rescheduled',
    'interview_cancelled', 'status_changed', 'hired', 'declined', 'rejected',
    'reopened', 'internal_note_updated'
  )),
  from_status text,
  to_status text,
  actor_user_id uuid,  -- FK無し（履歴識別子）
  actor_kind text not null check (actor_kind in ('store', 'stylist')),
  interview_at timestamptz,
  -- 美容師に見せてよい文面 / 社内のみの文面を分離。
  public_note text check (public_note is null or char_length(public_note) <= 1000),
  internal_note text check (internal_note is null or char_length(internal_note) <= 2000),
  reason_code text,
  created_at timestamptz not null default now()
);
create index store_hiring_process_events_process_idx
  on public.store_hiring_process_events(hiring_process_id, created_at);

comment on table public.store_hiring_process_events is
  '採用進捗の履歴（追記専用）。誰がいつ何を変更したかを残す。internal_note/reason_codeは店舗側のみ。';

-- ----------------------------------------------------------------------------
-- 3. 直接アクセスの遮断（RLS有効・ポリシー無し・権限なし）。
-- ----------------------------------------------------------------------------
alter table public.store_hiring_processes enable row level security;
alter table public.store_hiring_process_events enable row level security;
revoke all on public.store_hiring_processes from public, anon, authenticated;
revoke all on public.store_hiring_process_events from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. 整合性を守るtrigger。
-- ----------------------------------------------------------------------------
create or replace function public.store_hiring_processes_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.store_id <> old.store_id or new.stylist_user_id <> old.stylist_user_id then
    raise exception 'store_id and stylist_user_id cannot be changed';
  end if;
  if new.source <> old.source
     or new.source_scout_id is distinct from old.source_scout_id
     or new.source_salary_offer_id is distinct from old.source_salary_offer_id then
    raise exception 'source cannot be changed';
  end if;
  -- 採用確定後は状態を戻せず、確定日時も書き換えられない。
  if old.status = 'hired' and new.status <> 'hired' then
    raise exception 'a hired process cannot change status';
  end if;
  if old.hired_at is not null and new.hired_at is distinct from old.hired_at then
    raise exception 'hired_at cannot be changed';
  end if;
  if old.hired_by_user_id is not null
     and new.hired_by_user_id is distinct from old.hired_by_user_id then
    raise exception 'hired_by_user_id cannot be changed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger trg_store_hiring_processes_guard
  before update on public.store_hiring_processes
  for each row execute function public.store_hiring_processes_guard();

-- 履歴は完全な追記専用（UPDATE/DELETEとも禁止）。
create or replace function public.store_hiring_process_events_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'store_hiring_process_events is append-only';
end;
$$;
create trigger trg_store_hiring_process_events_append_only
  before update or delete on public.store_hiring_process_events
  for each row execute function public.store_hiring_process_events_append_only();

-- ----------------------------------------------------------------------------
-- 5. 内部ヘルパー（クライアントからは呼べない）。
-- ----------------------------------------------------------------------------

-- 許可された状態遷移（店舗側）。
create or replace function public.hiring_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_from
    when 'contacting'          then p_to in ('interview_scheduled', 'rejected', 'declined')
    when 'interview_scheduled' then p_to in ('interview_scheduled', 'interview_completed', 'contacting', 'rejected', 'declined')
    when 'interview_completed' then p_to in ('interview_scheduled', 'selection', 'offered', 'rejected', 'declined')
    when 'selection'           then p_to in ('interview_scheduled', 'offered', 'rejected', 'declined')
    when 'offered'             then p_to in ('selection', 'hired', 'rejected', 'declined')
    when 'declined'            then p_to in ('contacting')
    when 'rejected'            then p_to in ('contacting')
    else false  -- hiredは終端
  end;
$$;
revoke all on function public.hiring_transition_allowed(text, text) from public, anon, authenticated;

-- 採用進捗への「書き込み」権限。is_store_accessible()（閲覧可否）とは別に判定し、
-- store_members.role = viewer だけの担当者は書き込めないようにする。
create or replace function public.can_manage_store_hiring(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'salon')
    and exists (
      select 1
      from public.salon_stores s
      where s.id = p_store_id
        and (
          -- A. 会社の管理者系3role: 所属会社の全店舗で書き込み可。
          exists (
            select 1 from public.organization_members om
            where om.organization_id = s.organization_id
              and om.user_id = auth.uid()
              and om.role in ('company_owner', 'company_admin', 'recruiting_admin')
          )
          -- B. area_manager: 対象店舗のstore_members割当がある場合のみ
          --    （割当側のroleがviewerでも、担当店舗の割当として書き込み可）。
          or (
            exists (
              select 1 from public.organization_members om
              where om.organization_id = s.organization_id
                and om.user_id = auth.uid()
                and om.role = 'area_manager'
            )
            and exists (
              select 1 from public.store_members sm
              where sm.store_id = s.id and sm.user_id = auth.uid()
            )
          )
          -- C. 対象店舗の店長・採用担当（viewerは含めない）。
          or exists (
            select 1 from public.store_members sm
            where sm.store_id = s.id
              and sm.user_id = auth.uid()
              and sm.role in ('store_manager', 'recruiter')
          )
        )
    );
$$;
revoke all on function public.can_manage_store_hiring(uuid) from public, anon, authenticated;

-- 書き込み権限を持つ店舗スタッフとして対象の進捗を行ロック付きで取得する。
-- 存在しない・アクセス権が無い場合は同じメッセージで拒否する（存在有無を漏らさない）。
create or replace function public.hiring_lock_process_for_store_staff(p_process_id uuid)
returns public.store_hiring_processes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.store_hiring_processes;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;

  select * into v_row from public.store_hiring_processes where id = p_process_id for update;
  -- 書き込み用ヘルパーのため、閲覧権限(is_store_accessible)ではなく
  -- 書き込み権限(can_manage_store_hiring)で判定する。viewerは拒否。
  if v_row.id is null or not public.can_manage_store_hiring(v_row.store_id) then
    raise exception 'hiring process not found or not accessible';
  end if;
  return v_row;
end;
$$;
revoke all on function public.hiring_lock_process_for_store_staff(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. add_hiring_candidate(): 「採用進捗に追加」（店舗側・明示的な手動登録）。
-- ----------------------------------------------------------------------------
create or replace function public.add_hiring_candidate(
  p_store_id uuid,
  p_stylist_user_id uuid,
  p_internal_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_note text := nullif(trim(coalesce(p_internal_note, '')), '');
  v_offer_id uuid;
  v_scout_id uuid;
  v_source text;
  v_row public.store_hiring_processes;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;
  if not public.can_manage_store_hiring(p_store_id) then
    raise exception 'store not found or not accessible';
  end if;
  if not exists (select 1 from public.user_roles where user_id = p_stylist_user_id and role = 'stylist') then
    raise exception 'target is not a stylist';
  end if;

  -- 接点の確認と起点の決定（給与オファー > スカウト > Interest の順で採用）。
  select id into v_offer_id from public.salary_offers
  where store_id = p_store_id and stylist_user_id = p_stylist_user_id
    and status in ('accepted', 'revision_requested')
  order by created_at desc limit 1;

  select id into v_scout_id from public.scouts
  where store_id = p_store_id and stylist_user_id = p_stylist_user_id
    and response_status in ('interested', 'question')
  order by sent_at desc limit 1;

  -- sourceに対応するIDだけを保存する（他方は必ずnull）。
  if v_offer_id is not null then
    v_source := 'salary_offer';
    v_scout_id := null;
  elsif v_scout_id is not null then
    v_source := 'scout';
    v_offer_id := null;
  elsif exists (
    select 1 from public.stylist_salon_interests
    where store_id = p_store_id and stylist_user_id = p_stylist_user_id
  ) then
    v_source := 'interest';
  else
    raise exception 'no engagement with this stylist';
  end if;

  -- 重複はunique(store_id, stylist_user_id)に委ねる前に、分かりやすく拒否する。
  if exists (
    select 1 from public.store_hiring_processes
    where store_id = p_store_id and stylist_user_id = p_stylist_user_id
  ) then
    raise exception 'candidate already exists for this store';
  end if;

  insert into public.store_hiring_processes (
    store_id, stylist_user_id, status, source, source_scout_id, source_salary_offer_id,
    internal_note, created_by_user_id, updated_by_user_id
  ) values (
    p_store_id, p_stylist_user_id, 'contacting', v_source, v_scout_id, v_offer_id,
    v_note, v_uid, v_uid
  ) returning * into v_row;

  insert into public.store_hiring_process_events (
    hiring_process_id, event_type, from_status, to_status, actor_user_id, actor_kind, internal_note
  ) values (v_row.id, 'candidate_added', null, 'contacting', v_uid, 'store', v_note);

  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'source', v_row.source);
end;
$$;
revoke all on function public.add_hiring_candidate(uuid, uuid, text) from public, anon;
grant execute on function public.add_hiring_candidate(uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. schedule_hiring_interview(): 面談の登録・日時変更。
-- ----------------------------------------------------------------------------
create or replace function public.schedule_hiring_interview(
  p_process_id uuid,
  p_interview_at timestamptz,
  p_interview_type text,
  p_location text default null,
  p_candidate_message text default null,
  p_internal_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.store_hiring_processes;
  v_location text := nullif(trim(coalesce(p_location, '')), '');
  v_message text := nullif(trim(coalesce(p_candidate_message, '')), '');
  v_internal text := nullif(trim(coalesce(p_internal_note, '')), '');
  v_event text;
begin
  v_p := public.hiring_lock_process_for_store_staff(p_process_id);

  if p_interview_at is null then raise exception 'interview_at required'; end if;
  if p_interview_type is null or p_interview_type not in ('online', 'in_person', 'phone') then
    raise exception 'invalid interview type';
  end if;
  if not public.hiring_transition_allowed(v_p.status, 'interview_scheduled') then
    raise exception 'invalid status transition';
  end if;

  v_event := case
    when v_p.status = 'interview_scheduled' and v_p.interview_at is not null then 'interview_rescheduled'
    else 'interview_scheduled'
  end;

  update public.store_hiring_processes
  set status = 'interview_scheduled',
      interview_at = p_interview_at,
      interview_type = p_interview_type,
      interview_location = v_location,
      candidate_message = coalesce(v_message, v_p.candidate_message),
      updated_by_user_id = v_uid
  where id = v_p.id;

  insert into public.store_hiring_process_events (
    hiring_process_id, event_type, from_status, to_status, actor_user_id, actor_kind,
    interview_at, public_note, internal_note
  ) values (v_p.id, v_event, v_p.status, 'interview_scheduled', v_uid, 'store',
            p_interview_at, v_message, v_internal);

  return jsonb_build_object('id', v_p.id, 'status', 'interview_scheduled', 'interview_at', p_interview_at);
end;
$$;
revoke all on function public.schedule_hiring_interview(uuid, timestamptz, text, text, text, text) from public, anon;
grant execute on function public.schedule_hiring_interview(uuid, timestamptz, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. update_hiring_status(): 面談予定以外のステータス変更（店舗側）。
--    面談予定への変更は日時が必要なため schedule_hiring_interview() を使う。
-- ----------------------------------------------------------------------------
create or replace function public.update_hiring_status(
  p_process_id uuid,
  p_to_status text,
  p_public_note text default null,
  p_internal_note text default null,
  p_reason_code text default null,
  p_reason_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.store_hiring_processes;
  v_public text := nullif(trim(coalesce(p_public_note, '')), '');
  v_internal text := nullif(trim(coalesce(p_internal_note, '')), '');
  v_reason_code text := nullif(trim(coalesce(p_reason_code, '')), '');
  v_reason_note text := nullif(trim(coalesce(p_reason_note, '')), '');
  v_event text;
  v_clear_interview boolean := false;
begin
  v_p := public.hiring_lock_process_for_store_staff(p_process_id);

  if p_to_status is null or p_to_status = 'interview_scheduled' then
    raise exception 'use schedule_hiring_interview for interview_scheduled';
  end if;
  if not public.hiring_transition_allowed(v_p.status, p_to_status) then
    raise exception 'invalid status transition';
  end if;
  -- 理由は辞退・不採用のときだけ受け付ける。
  if (v_reason_code is not null or v_reason_note is not null)
     and p_to_status not in ('declined', 'rejected') then
    raise exception 'reason is only allowed for declined or rejected';
  end if;

  v_event := case
    when v_p.status in ('declined', 'rejected') and p_to_status = 'contacting' then 'reopened'
    when v_p.status = 'interview_scheduled' and p_to_status = 'contacting' then 'interview_cancelled'
    when p_to_status = 'hired' then 'hired'
    when p_to_status = 'declined' then 'declined'
    when p_to_status = 'rejected' then 'rejected'
    else 'status_changed'
  end;
  v_clear_interview := (v_event = 'interview_cancelled');

  update public.store_hiring_processes
  set status = p_to_status,
      interview_at = case when v_clear_interview then null else interview_at end,
      interview_type = case when v_clear_interview then null else interview_type end,
      interview_location = case when v_clear_interview then null else interview_location end,
      candidate_message = coalesce(v_public, candidate_message),
      declined_by = case when p_to_status = 'declined' then 'store' else null end,
      reason_code = case when p_to_status in ('declined', 'rejected') then v_reason_code else null end,
      reason_note = case when p_to_status in ('declined', 'rejected') then v_reason_note else null end,
      hired_at = case when p_to_status = 'hired' then now() else hired_at end,
      hired_by_user_id = case when p_to_status = 'hired' then v_uid else hired_by_user_id end,
      closed_at = case
        when p_to_status in ('hired', 'declined', 'rejected') then now()
        when v_event = 'reopened' then null
        else closed_at end,
      updated_by_user_id = v_uid
  where id = v_p.id;

  insert into public.store_hiring_process_events (
    hiring_process_id, event_type, from_status, to_status, actor_user_id, actor_kind,
    public_note, internal_note, reason_code
  ) values (v_p.id, v_event, v_p.status, p_to_status, v_uid, 'store',
            v_public, coalesce(v_internal, v_reason_note), v_reason_code);

  return jsonb_build_object('id', v_p.id, 'status', p_to_status);
end;
$$;
revoke all on function public.update_hiring_status(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.update_hiring_status(uuid, text, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. update_hiring_internal_note(): 社内メモの更新（店舗側のみ）。
-- ----------------------------------------------------------------------------
create or replace function public.update_hiring_internal_note(
  p_process_id uuid,
  p_internal_note text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.store_hiring_processes;
  v_note text := nullif(trim(coalesce(p_internal_note, '')), '');
begin
  v_p := public.hiring_lock_process_for_store_staff(p_process_id);

  update public.store_hiring_processes
  set internal_note = v_note, updated_by_user_id = v_uid
  where id = v_p.id;

  insert into public.store_hiring_process_events (
    hiring_process_id, event_type, from_status, to_status, actor_user_id, actor_kind, internal_note
  ) values (v_p.id, 'internal_note_updated', v_p.status, v_p.status, v_uid, 'store', v_note);

  return jsonb_build_object('id', v_p.id);
end;
$$;
revoke all on function public.update_hiring_internal_note(uuid, text) from public, anon;
grant execute on function public.update_hiring_internal_note(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 10. get_store_hiring_processes(): 店舗の採用進捗一覧（店舗側）。
--     同じ店舗にアクセスできる全スタッフが同じ内容を見られる。
--     スタッフのuser idは返さない。
-- ----------------------------------------------------------------------------
create or replace function public.get_store_hiring_processes(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;
  if not public.is_store_accessible(p_store_id) then
    raise exception 'store not found or not accessible';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'process_id', h.id,
    'store_id', h.store_id,
    'stylist_user_id', h.stylist_user_id,
    'public_name', sp.public_name,
    'prefecture', sp.prefecture,
    'current_position', sp.current_position,
    'experience_years', sp.experience_years,
    'match', public.calculate_match_axes_by_store(h.stylist_user_id, h.store_id),
    'status', h.status,
    'source', h.source,
    'interview_at', h.interview_at,
    'interview_type', h.interview_type,
    'interview_location', h.interview_location,
    'candidate_message', h.candidate_message,
    'internal_note', h.internal_note,
    'declined_by', h.declined_by,
    'reason_code', h.reason_code,
    'reason_note', h.reason_note,
    'hired_at', h.hired_at,
    'closed_at', h.closed_at,
    'created_at', h.created_at,
    'updated_at', h.updated_at
  ) order by h.updated_at desc), '[]'::jsonb)
  into v_result
  from public.store_hiring_processes h
  left join public.stylist_profiles sp on sp.user_id = h.stylist_user_id
  where h.store_id = p_store_id;

  return v_result;
end;
$$;
revoke all on function public.get_store_hiring_processes(uuid) from public, anon;
grant execute on function public.get_store_hiring_processes(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 11. get_hiring_process_events(): 履歴（店舗側。社内メモ・理由を含む）。
-- ----------------------------------------------------------------------------
create or replace function public.get_hiring_process_events(p_process_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.store_hiring_processes;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;
  select * into v_p from public.store_hiring_processes where id = p_process_id;
  if v_p.id is null or not public.is_store_accessible(v_p.store_id) then
    raise exception 'hiring process not found or not accessible';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'event_type', e.event_type,
    'from_status', e.from_status,
    'to_status', e.to_status,
    'actor_kind', e.actor_kind,
    'is_me', (e.actor_user_id = v_uid),
    'interview_at', e.interview_at,
    'public_note', e.public_note,
    'internal_note', e.internal_note,
    'reason_code', e.reason_code,
    'created_at', e.created_at
  ) order by e.created_at, e.id), '[]'::jsonb)
  into v_result
  from public.store_hiring_process_events e
  where e.hiring_process_id = p_process_id;

  return v_result;
end;
$$;
revoke all on function public.get_hiring_process_events(uuid) from public, anon;
grant execute on function public.get_hiring_process_events(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 12. get_my_hiring_processes(): 美容師が自分の進捗だけを見る。
--     返すのは店舗名・状況・面談・店舗からの案内・公開メモのみ。
--     internal_note / reason_* / スタッフのuser idは絶対に返さない。
--     店舗名は、進捗という接点があるため非公開に変わった店舗でも返す。
-- ----------------------------------------------------------------------------
create or replace function public.get_my_hiring_processes()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'stylist') then
    raise exception 'caller is not a stylist';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'process_id', h.id,
    'store_id', h.store_id,
    'store_name', s.store_name,
    'prefecture', pr.prefecture,
    'city', pr.city,
    'store_is_public', coalesce(pr.visibility = 'PUBLIC', false),
    'status', h.status,
    'interview_at', h.interview_at,
    'interview_type', h.interview_type,
    'interview_location', h.interview_location,
    'candidate_message', h.candidate_message,
    'declined_by', h.declined_by,
    'hired_at', h.hired_at,
    'closed_at', h.closed_at,
    'created_at', h.created_at,
    'updated_at', h.updated_at,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_type', e.event_type,
        'to_status', e.to_status,
        'actor_kind', e.actor_kind,
        'interview_at', e.interview_at,
        'public_note', e.public_note,
        'created_at', e.created_at
      ) order by e.created_at, e.id)
      from public.store_hiring_process_events e
      where e.hiring_process_id = h.id
        and e.event_type <> 'internal_note_updated'
    ), '[]'::jsonb)
  ) order by h.updated_at desc), '[]'::jsonb)
  into v_result
  from public.store_hiring_processes h
  join public.salon_stores s on s.id = h.store_id
  left join public.salon_store_profiles pr on pr.store_id = h.store_id
  where h.stylist_user_id = v_uid;

  return v_result;
end;
$$;
revoke all on function public.get_my_hiring_processes() from public, anon;
grant execute on function public.get_my_hiring_processes() to authenticated;

-- ----------------------------------------------------------------------------
-- 13. decline_hiring_process(): 美容師が自分の進捗を辞退する。
--     自分の進捗(stylist_user_id = auth.uid())のみ。hired/declined/rejected
--     の後は辞退できない。メッセージは店舗側にも見える(public_note)。
-- ----------------------------------------------------------------------------
create or replace function public.decline_hiring_process(
  p_process_id uuid,
  p_public_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.store_hiring_processes;
  v_note text := nullif(trim(coalesce(p_public_note, '')), '');
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'stylist') then
    raise exception 'caller is not a stylist';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'note too long';
  end if;

  select * into v_p from public.store_hiring_processes
  where id = p_process_id and stylist_user_id = v_uid for update;
  if v_p.id is null then raise exception 'hiring process not found'; end if;
  if v_p.status in ('hired', 'declined', 'rejected') then
    raise exception 'hiring process is already closed';
  end if;

  update public.store_hiring_processes
  set status = 'declined', declined_by = 'stylist', closed_at = now(), updated_by_user_id = v_uid
  where id = v_p.id;

  insert into public.store_hiring_process_events (
    hiring_process_id, event_type, from_status, to_status, actor_user_id, actor_kind, public_note
  ) values (v_p.id, 'declined', v_p.status, 'declined', v_uid, 'stylist', v_note);

  return jsonb_build_object('id', v_p.id, 'status', 'declined');
end;
$$;
revoke all on function public.decline_hiring_process(uuid, text) from public, anon;
grant execute on function public.decline_hiring_process(uuid, text) to authenticated;

commit;
