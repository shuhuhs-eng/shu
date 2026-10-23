-- ============================================================================
-- Beauty Reach — 0039_success_fee_foundation
--
-- Phase 11。採用成立(store_hiring_processes.status = 'hired')を将来の成功報酬の
-- 起点として「1件だけ」記録する基盤。実請求・決済連携・Stripeは扱わない。
--
-- ★【状態: 案（未適用・未commit）】レビュー用。Supabaseへは適用しない。
--
-- ★調査結果（既存schema）:
--   ・billing / invoice / payment / success_fee / contract / subscription /
--     charge / stripe / plan / pricing に相当するテーブル・RPC・enumは存在しない
--     （全migrationをgrep済み。0026のコメントに「将来、契約プラン・請求・Stripe・
--     店舗利用枠・成功報酬を会社(salon_organizations)単位に紐づける想定」と
--     あるのみ。アプリ側にもStripe等の依存は無い）。
--   ・platform_admins / is_platform_admin()（0021）が既存の運営者判定。
--     運営者向けRPCは get_admin_* / is_platform_admin() の既存流儀に合わせる。
--
-- ★データモデル:
--   hiring_success_fees         … 採用1件につき成功報酬レコード1件。
--                                  unique(hiring_process_id) で二重生成・二重課金を防ぐ。
--   hiring_success_fee_events   … 追記専用の監査履歴（誰がいつ何を変更したか）。
--
-- ★organization_id を保存する理由:
--   採用進捗(0037)は organization_id を持たず salon_stores から解決するが、成功報酬は
--   「誰に請求するか」の根拠になるため、採用成立時点の請求先会社を固定して保存する
--   （将来、店舗の所属会社が変わっても過去の請求先が変わらない）。作成時に
--   salon_stores.organization_id から取り、以後は変更不可。
--
-- ★料金は一切ハードコードしない:
--   fee_amount / tax_amount / total_amount は null 可。作成時は未確定
--   （pending_confirmation）で、運営者が将来の契約・プラン・会社ごとの条件に
--   従って金額を確定する。消費税率も固定値を持たず、確定時に税額を明示的に渡す。
--
-- ★ステータス（画面では日本語。内部名は表示しない）:
--   pending_confirmation 請求確認中（採用成立で自動作成。金額は未確定）
--   confirmed            請求額確定（金額・税額が確定。確定中は金額の修正のみ可）
--   invoiced             請求済み
--   paid                 入金済み（終端）
--   waived               免除（終端。理由必須）
--   cancelled            取消（終端。理由必須）
--   許可遷移: pending_confirmation → confirmed / waived / cancelled
--             confirmed → confirmed(金額修正) / invoiced / waived / cancelled
--             invoiced → paid / cancelled
--
-- ★自動生成: トリガー（RPCにしない理由）
--   hiredへ変わる経路が将来増えても、成功報酬レコードの作り忘れが起きない。
--   hiredの更新と同一トランザクションで作るため、「hiredなのに成功報酬が無い」
--   状態が生まれない（作成に失敗したらhiredへの変更も失敗する＝通知と違い
--   握りつぶさない）。再実行しても unique + on conflict do nothing で二重生成
--   されない。既存のhiredデータはこのmigrationでbackfillする。
--
-- ★監査・証跡の保全（0037と同じ方針）:
--   ・hiring_process_id / store_id / organization_id は on delete RESTRICT。
--   ・stylist_user_id / actor_user_id は FK無しの履歴識別子uuid（退会しても残る）。
--   ・採用成立の証跡（process / store / organization / stylist / hired_at /
--     currency）は変更不可。events は UPDATE/DELETE 禁止。fees も DELETE 禁止。
--   ・金額は invoiced 以降は変更不可。終端(paid/waived/cancelled)からは遷移不可。
--   ・両テーブルとも RLS有効・ポリシー無し・anon/authenticatedに権限なし
--     （直接のSELECT/INSERT/UPDATE/DELETE不可。必ずSECURITY DEFINER RPC経由）。
--
-- ★権限（重大な設計判断。要レビュー）:
--   ・書き込み（金額確定・請求・入金・免除・取消）: 運営者(is_platform_admin)のみ。
--     会社側は成功報酬を変更できない。
--   ・会社側の閲覧: 自社の company_owner / company_admin のみ。金額を含むため、
--     recruiting_admin / area_manager / store_manager / recruiter / viewer には
--     見せない。運営者用の内部メモ(note)は会社側には返さない。
--   ・美容師には一切見せない。
--
-- ★既存関数・既存テーブルは変更しない（0001〜0038は無変更）。0037の
--   store_hiring_processes には AFTER トリガーを1つ追加するだけで、列・制約・
--   既存トリガー・関数本体は変更しない。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. hiring_success_fees
-- ----------------------------------------------------------------------------
create table public.hiring_success_fees (
  id uuid primary key default gen_random_uuid(),
  hiring_process_id uuid not null references public.store_hiring_processes(id) on delete restrict,
  store_id uuid not null references public.salon_stores(id) on delete restrict,
  organization_id uuid not null references public.salon_organizations(id) on delete restrict,
  stylist_user_id uuid not null,  -- FK無し（履歴識別子）
  hired_at timestamptz not null,

  fee_status text not null default 'pending_confirmation' check (fee_status in (
    'pending_confirmation', 'confirmed', 'invoiced', 'paid', 'waived', 'cancelled'
  )),

  currency text not null default 'JPY' check (currency = 'JPY'),
  fee_amount integer check (fee_amount is null or fee_amount >= 0),
  tax_amount integer check (tax_amount is null or tax_amount >= 0),
  total_amount integer check (total_amount is null or total_amount >= 0),

  confirmed_at timestamptz,
  invoiced_at timestamptz,
  paid_at timestamptz,
  waived_at timestamptz,
  cancelled_at timestamptz,

  -- 運営者用の内部メモ（会社側には返さない）。
  note text check (note is null or char_length(note) <= 1000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- ★採用1件につき成功報酬レコードは1件だけ（二重課金防止）。
  constraint hiring_success_fees_process_unique unique (hiring_process_id),
  -- 金額は「3つとも未確定」か「3つとも確定で total = fee + tax」。
  constraint hiring_success_fees_amounts_consistency check (
    (fee_amount is null and tax_amount is null and total_amount is null)
    or (fee_amount is not null and tax_amount is not null and total_amount is not null
        and total_amount = fee_amount + tax_amount)
  ),
  -- 確定以降は金額が必須。
  constraint hiring_success_fees_status_amounts check (
    fee_status not in ('confirmed', 'invoiced', 'paid') or fee_amount is not null
  ),
  -- ステータスと日時の整合。
  constraint hiring_success_fees_status_timestamps check (
    (fee_status not in ('confirmed', 'invoiced', 'paid') or confirmed_at is not null)
    and (fee_status not in ('invoiced', 'paid') or invoiced_at is not null)
    and ((paid_at is not null) = (fee_status = 'paid'))
    and ((waived_at is not null) = (fee_status = 'waived'))
    and ((cancelled_at is not null) = (fee_status = 'cancelled'))
  )
);
create index hiring_success_fees_org_idx on public.hiring_success_fees(organization_id, fee_status);
create index hiring_success_fees_store_idx on public.hiring_success_fees(store_id);

comment on table public.hiring_success_fees is
  '採用成立(hired)ごとの成功報酬レコード（1採用1件、unique(hiring_process_id)）。金額は未確定(null)から始まり、運営者が確定する。料金・税率はハードコードしない。直接アクセス不可、必ずSECURITY DEFINER RPC経由。';

-- ----------------------------------------------------------------------------
-- 2. hiring_success_fee_events（追記専用の監査履歴）
-- ----------------------------------------------------------------------------
create table public.hiring_success_fee_events (
  id uuid primary key default gen_random_uuid(),
  success_fee_id uuid not null references public.hiring_success_fees(id) on delete restrict,
  event_type text not null check (event_type in (
    'created', 'confirmed', 'amount_updated', 'invoiced', 'paid', 'waived', 'cancelled'
  )),
  from_status text,
  to_status text,
  fee_amount integer,
  tax_amount integer,
  total_amount integer,
  actor_user_id uuid,  -- null = システム（自動作成・backfill）。FK無し（履歴識別子）
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index hiring_success_fee_events_fee_idx
  on public.hiring_success_fee_events(success_fee_id, created_at);

comment on table public.hiring_success_fee_events is
  '成功報酬の履歴（追記専用）。誰がいつ何をしたか、その時点の金額を残す。';

alter table public.hiring_success_fees enable row level security;
alter table public.hiring_success_fee_events enable row level security;
revoke all on public.hiring_success_fees from public, anon, authenticated;
revoke all on public.hiring_success_fee_events from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. 整合性を守るtrigger
-- ----------------------------------------------------------------------------
create or replace function public.hiring_fee_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_from
    when 'pending_confirmation' then p_to in ('confirmed', 'waived', 'cancelled')
    when 'confirmed'            then p_to in ('confirmed', 'invoiced', 'waived', 'cancelled')
    when 'invoiced'             then p_to in ('paid', 'cancelled')
    else false  -- paid / waived / cancelled は終端
  end;
$$;
revoke all on function public.hiring_fee_transition_allowed(text, text) from public, anon, authenticated;

create or replace function public.hiring_success_fees_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- 採用成立の証跡は変更不可。
  if new.hiring_process_id <> old.hiring_process_id
     or new.store_id <> old.store_id
     or new.organization_id <> old.organization_id
     or new.stylist_user_id <> old.stylist_user_id
     or new.hired_at <> old.hired_at
     or new.currency <> old.currency
     or new.created_at <> old.created_at then
    raise exception 'success fee evidence columns cannot be changed';
  end if;

  if new.fee_status <> old.fee_status or new.fee_status = 'confirmed' then
    if not public.hiring_fee_transition_allowed(old.fee_status, new.fee_status) then
      raise exception 'invalid success fee status transition';
    end if;
  end if;

  -- 請求済み以降（および終端）は金額を変更できない。
  if old.fee_status in ('invoiced', 'paid', 'waived', 'cancelled')
     and (new.fee_amount is distinct from old.fee_amount
          or new.tax_amount is distinct from old.tax_amount
          or new.total_amount is distinct from old.total_amount) then
    raise exception 'amounts are frozen after invoicing';
  end if;

  -- 一度付いた日時は書き換えられない。
  if (old.confirmed_at is not null and new.confirmed_at is distinct from old.confirmed_at)
     or (old.invoiced_at is not null and new.invoiced_at is distinct from old.invoiced_at)
     or (old.paid_at is not null and new.paid_at is distinct from old.paid_at)
     or (old.waived_at is not null and new.waived_at is distinct from old.waived_at)
     or (old.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at) then
    raise exception 'status timestamps cannot be changed';
  end if;

  new.updated_at := now();
  return new;
end;
$$;
create trigger trg_hiring_success_fees_guard
  before update on public.hiring_success_fees
  for each row execute function public.hiring_success_fees_guard();

-- fees / events は物理削除不可。events は更新も不可（追記専用）。
create or replace function public.hiring_success_fee_no_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '% rows cannot be deleted', tg_table_name;
end;
$$;
create trigger trg_hiring_success_fees_no_delete
  before delete on public.hiring_success_fees
  for each row execute function public.hiring_success_fee_no_delete();

create or replace function public.hiring_success_fee_events_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'hiring_success_fee_events is append-only';
end;
$$;
create trigger trg_hiring_success_fee_events_append_only
  before update or delete on public.hiring_success_fee_events
  for each row execute function public.hiring_success_fee_events_append_only();

-- ----------------------------------------------------------------------------
-- 4. 採用成立(hired)で成功報酬レコードを自動作成（0037のテーブルへAFTERトリガーを追加）
--    再実行しても unique(hiring_process_id) + on conflict do nothing で二重に作らない。
--    失敗を握りつぶさない（成功報酬の無いhiredを作らないため）。
-- ----------------------------------------------------------------------------
create or replace function public.hiring_create_success_fee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_fee_id uuid;
begin
  select organization_id into v_org from public.salon_stores where id = new.store_id;
  if v_org is null then
    raise exception 'store organization not found for success fee';
  end if;

  insert into public.hiring_success_fees (
    hiring_process_id, store_id, organization_id, stylist_user_id, hired_at
  ) values (
    new.id, new.store_id, v_org, new.stylist_user_id, new.hired_at
  )
  on conflict (hiring_process_id) do nothing
  returning id into v_fee_id;

  if v_fee_id is not null then
    insert into public.hiring_success_fee_events (success_fee_id, event_type, to_status, actor_user_id, note)
    values (v_fee_id, 'created', 'pending_confirmation', null, '採用成立により自動作成');
  end if;
  return new;
end;
$$;
revoke all on function public.hiring_create_success_fee() from public, anon, authenticated;

create trigger trg_store_hiring_processes_success_fee
  after insert or update on public.store_hiring_processes
  for each row when (new.status = 'hired')
  execute function public.hiring_create_success_fee();

-- ----------------------------------------------------------------------------
-- 5. 既存のhiredデータのbackfill（再実行しても二重に作らない）
-- ----------------------------------------------------------------------------
with inserted as (
  insert into public.hiring_success_fees (hiring_process_id, store_id, organization_id, stylist_user_id, hired_at)
  select p.id, p.store_id, s.organization_id, p.stylist_user_id, p.hired_at
  from public.store_hiring_processes p
  join public.salon_stores s on s.id = p.store_id
  where p.status = 'hired'
  on conflict (hiring_process_id) do nothing
  returning id
)
insert into public.hiring_success_fee_events (success_fee_id, event_type, to_status, actor_user_id, note)
select id, 'created', 'pending_confirmation', null, '既存の採用データから作成（backfill）'
from inserted;

-- ----------------------------------------------------------------------------
-- 6. get_admin_success_fees(): 運営者向け一覧（金額確定・請求管理用）
-- ----------------------------------------------------------------------------
create or replace function public.get_admin_success_fees(p_status text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_status is not null and p_status not in
     ('pending_confirmation', 'confirmed', 'invoiced', 'paid', 'waived', 'cancelled') then
    raise exception 'invalid status';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'fee_id', f.id,
    'hiring_process_id', f.hiring_process_id,
    'organization_id', f.organization_id,
    'organization_name', o.name,
    'store_id', f.store_id,
    'store_name', s.store_name,
    'stylist_user_id', f.stylist_user_id,
    'stylist_name', sp.public_name,
    'hired_at', f.hired_at,
    'fee_status', f.fee_status,
    'currency', f.currency,
    'fee_amount', f.fee_amount,
    'tax_amount', f.tax_amount,
    'total_amount', f.total_amount,
    'confirmed_at', f.confirmed_at,
    'invoiced_at', f.invoiced_at,
    'paid_at', f.paid_at,
    'waived_at', f.waived_at,
    'cancelled_at', f.cancelled_at,
    'note', f.note,
    'created_at', f.created_at,
    'updated_at', f.updated_at
  ) order by f.hired_at desc), '[]'::jsonb)
  into v_result
  from public.hiring_success_fees f
  join public.salon_stores s on s.id = f.store_id
  join public.salon_organizations o on o.id = f.organization_id
  left join public.stylist_profiles sp on sp.user_id = f.stylist_user_id
  where p_status is null or f.fee_status = p_status;

  return v_result;
end;
$$;
revoke all on function public.get_admin_success_fees(text) from public, anon;
grant execute on function public.get_admin_success_fees(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. admin_update_success_fee(): 運営者による金額確定・請求・入金・免除・取消
--    p_action: confirm（金額確定 / 確定後の金額修正）/ invoice / paid / waive / cancel
--    waive / cancel は理由(p_note)必須。金額・税額は呼び出し側が明示的に渡す
--    （料金・税率はDBにも持たない）。
-- ----------------------------------------------------------------------------
create or replace function public.admin_update_success_fee(
  p_fee_id uuid,
  p_action text,
  p_fee_amount integer default null,
  p_tax_amount integer default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_f public.hiring_success_fees;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_to text;
  v_event text;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_action is null or p_action not in ('confirm', 'invoice', 'paid', 'waive', 'cancel') then
    raise exception 'invalid action';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then raise exception 'note too long'; end if;

  select * into v_f from public.hiring_success_fees where id = p_fee_id for update;
  if v_f.id is null then raise exception 'success fee not found'; end if;

  v_to := case p_action
    when 'confirm' then 'confirmed'
    when 'invoice' then 'invoiced'
    when 'paid' then 'paid'
    when 'waive' then 'waived'
    else 'cancelled'
  end;
  if not public.hiring_fee_transition_allowed(v_f.fee_status, v_to) then
    raise exception 'invalid success fee status transition';
  end if;

  if p_action = 'confirm' then
    if p_fee_amount is null or p_tax_amount is null or p_fee_amount < 0 or p_tax_amount < 0 then
      raise exception 'fee_amount and tax_amount are required';
    end if;
  elsif p_action in ('waive', 'cancel') and v_note is null then
    raise exception 'reason note is required';
  end if;

  v_event := case p_action
    when 'confirm' then case when v_f.fee_status = 'confirmed' then 'amount_updated' else 'confirmed' end
    when 'invoice' then 'invoiced'
    when 'paid' then 'paid'
    when 'waive' then 'waived'
    else 'cancelled'
  end;

  update public.hiring_success_fees
  set fee_status = v_to,
      fee_amount = case when p_action = 'confirm' then p_fee_amount else fee_amount end,
      tax_amount = case when p_action = 'confirm' then p_tax_amount else tax_amount end,
      total_amount = case when p_action = 'confirm' then p_fee_amount + p_tax_amount else total_amount end,
      confirmed_at = case when p_action = 'confirm' then coalesce(confirmed_at, now()) else confirmed_at end,
      invoiced_at = case when p_action = 'invoice' then now() else invoiced_at end,
      paid_at = case when p_action = 'paid' then now() else paid_at end,
      waived_at = case when p_action = 'waive' then now() else waived_at end,
      cancelled_at = case when p_action = 'cancel' then now() else cancelled_at end,
      note = coalesce(v_note, note)
  where id = v_f.id
  returning * into v_f;

  insert into public.hiring_success_fee_events (
    success_fee_id, event_type, from_status, to_status,
    fee_amount, tax_amount, total_amount, actor_user_id, note
  ) values (
    v_f.id, v_event, case when v_event = 'amount_updated' then 'confirmed' else
      (select e.to_status from public.hiring_success_fee_events e
        where e.success_fee_id = v_f.id order by e.created_at desc, e.id desc limit 1) end,
    v_to, v_f.fee_amount, v_f.tax_amount, v_f.total_amount, v_uid, v_note
  );

  return jsonb_build_object('fee_id', v_f.id, 'fee_status', v_f.fee_status,
                            'fee_amount', v_f.fee_amount, 'tax_amount', v_f.tax_amount,
                            'total_amount', v_f.total_amount);
end;
$$;
revoke all on function public.admin_update_success_fee(uuid, text, integer, integer, text) from public, anon;
grant execute on function public.admin_update_success_fee(uuid, text, integer, integer, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. get_company_success_fees(): 会社側の閲覧（自社のcompany_owner / company_admin のみ）
--    運営者用の内部メモ(note)・美容師のuser id・スタッフのuser idは返さない。
--    p_organization_id を省略すると、自分が company_owner / company_admin の
--    全会社分を返す。権限の無い会社を指定した場合は拒否する。
-- ----------------------------------------------------------------------------
create or replace function public.get_company_success_fees(p_organization_id uuid default null)
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
  if p_organization_id is not null and not exists (
    select 1 from public.organization_members om
    where om.organization_id = p_organization_id and om.user_id = v_uid
      and om.role in ('company_owner', 'company_admin')
  ) then
    raise exception 'organization not found or not accessible';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'fee_id', f.id,
    'hiring_process_id', f.hiring_process_id,
    'organization_id', f.organization_id,
    'store_id', f.store_id,
    'store_name', s.store_name,
    'stylist_name', sp.public_name,
    'hired_at', f.hired_at,
    'fee_status', f.fee_status,
    'currency', f.currency,
    'fee_amount', f.fee_amount,
    'tax_amount', f.tax_amount,
    'total_amount', f.total_amount,
    'confirmed_at', f.confirmed_at,
    'invoiced_at', f.invoiced_at,
    'paid_at', f.paid_at,
    'waived_at', f.waived_at,
    'cancelled_at', f.cancelled_at,
    'created_at', f.created_at,
    'updated_at', f.updated_at
  ) order by f.hired_at desc), '[]'::jsonb)
  into v_result
  from public.hiring_success_fees f
  join public.salon_stores s on s.id = f.store_id
  left join public.stylist_profiles sp on sp.user_id = f.stylist_user_id
  where (p_organization_id is null or f.organization_id = p_organization_id)
    and exists (
      select 1 from public.organization_members om
      where om.organization_id = f.organization_id and om.user_id = v_uid
        and om.role in ('company_owner', 'company_admin')
    );

  return v_result;
end;
$$;
revoke all on function public.get_company_success_fees(uuid) from public, anon;
grant execute on function public.get_company_success_fees(uuid) to authenticated;

commit;
