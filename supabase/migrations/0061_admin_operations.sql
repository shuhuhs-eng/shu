-- ============================================================================
-- 0061（レビュー用草案・未適用）: 運営の 連絡・見学案件・アカウント招待・問い合わせ・変更履歴
-- ============================================================================
-- 方針:
--   ・既存の表・列・RLS・権限は変更しない。新しい表と関数だけを足す（巻き戻し=新しい表・関数のdrop）。
--   ・新しい表はすべて RLS 有効＋ポリシー無し（= ブラウザ直接アクセスは全拒否）。読み書きは SECURITY DEFINER の関数だけ。
--     anon・authenticated には表の権限を与えない。
--   ・運営の操作は先頭で is_platform_admin() を確認。相手（サロン/美容師）の操作は _admin_thread_visible_to() で確認。
--   ・メール本文は保存しない（通知は「新着あり」程度。送信結果と失敗理由コードだけを admin_message_deliveries に残す）。
--   ・メール送信・アカウント発行は、この草案の範囲外（アプリ側の実装で、外部設定が済んでから）。
-- 前提: 0060（_admin_is_stylist_account を使う）。
-- 本草案で実装した範囲: 権限判定（_admin_salon_access / _admin_thread_visible_to）、スレッド・メッセージの整合トリガー、
--   運営側RPC（連絡の作成・追記・状態変更・一覧・詳細・通知結果の記録）、相手側RPC（inbox_*: 一覧・詳細・返信）。
-- v3（レビュー指摘への対応）:
--   1) 連投制限は送信者単位（全スレッド合算）で30件/時。送信者ごとのロックで、複数スレッドへの同時送信でも超過しない。
--   2) 連絡作成・運営の追記・相手の返信は送信ID(request_id)を必須にする。同じ送信IDの再送は同じ結果（メッセージ・スレッドID）を返し、
--      同じIDで内容が違うと拒否（request id content mismatch）。通知は1メッセージ1件（DBのunique）で二重作成しない。
--   3) 窓口担当者の宛先検証は【作成時のみ】。異動・退職で権限を失った後も、運営はスレッドを閲覧・追記・完了・再開できる。
--      元担当者の閲覧・返信は、権限の判定（現在のメンバーシップ）で拒否される。運営の詳細に「窓口担当者が現在アクセス不可」を表示。
--   4) 新設の全テーブルは PUBLIC・anon・authenticated・service_role から明示的に権限を外す（既定権限に依存しない）。付与するものは無い
--      （読み書きは SECURITY DEFINER の関数のみ）。
--   5) ロック順序（全操作で共通）: ①送信者ロック → ②送信IDロック → ③スレッド行ロック。逆順に取る操作は無い。
--   6) 巻き戻しは2系統に分離: 未使用時の完全削除（データがあれば拒否）／運用開始後のデータを残す停止・復旧。
-- 未実装（アプリ・外部設定が済んでから）: 見学案件のRPC、招待の発行/再送/受諾、問い合わせの受付、メール送信そのもの。
begin;

-- 1) 変更履歴（会社・店舗・公開状態・利用停止・アカウント/権限付与の実行者）
create table public.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (char_length(action) between 1 and 80),
  target_type text not null check (target_type in ('organization','store','stylist','thread','visit_case','invitation','invoice')),
  target_id uuid not null,
  organization_id uuid references public.salon_organizations(id) on delete set null,
  store_id uuid references public.salon_stores(id) on delete set null,
  before_value jsonb, after_value jsonb,
  created_at timestamptz not null default now()
);
create index on public.admin_audit_events (target_type, target_id, created_at desc);

-- 2) 見学・採用の案件（運営が受付する）
create table public.admin_visit_cases (
  id uuid primary key default gen_random_uuid(),
  stylist_user_id uuid not null references auth.users(id) on delete restrict,
  store_id uuid not null references public.salon_stores(id) on delete restrict,
  status text not null default 'received' check (status in ('received','reviewing','contacting_salon','scheduling','scheduled','visit_confirmed','cancelled')),
  assigned_admin_id uuid references auth.users(id) on delete set null,
  scheduled_at timestamptz,
  visit_confirmed_at timestamptz,            -- 「実施確認」。見学料の対象になる（請求は 0062）
  stylist_intent text check (stylist_intent in ('undecided','interested','not_interested')),
  salon_intent text check (salon_intent in ('undecided','interested','not_interested')),
  hiring_decision text check (hiring_decision in ('undecided','offered','hired','declined','rejected')),
  hiring_process_id uuid references public.store_hiring_processes(id) on delete set null,  -- 既存の採用進行との対応（任意）
  internal_note text check (internal_note is null or char_length(internal_note) <= 2000),   -- 運営内部。相手側には返さない
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (status <> 'visit_confirmed' or visit_confirmed_at is not null)
);
-- 進行中の同じ「美容師×店舗」の案件は1つだけ（取消・実施済み後の再見学の扱いは未確定のため、DBでは決めない）
create unique index admin_visit_cases_one_open on public.admin_visit_cases (stylist_user_id, store_id) where status not in ('cancelled','visit_confirmed');

-- 3) 連絡スレッド（運営が開始し、相手が返信する）
create table public.admin_threads (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('salon','stylist')),
  recipient_user_id uuid references auth.users(id) on delete restrict,   -- stylist宛: 本人。salon宛: 窓口の担当者（任意）
  organization_id uuid references public.salon_organizations(id) on delete restrict,
  store_id uuid references public.salon_stores(id) on delete restrict,
  visit_case_id uuid references public.admin_visit_cases(id) on delete set null,
  subject text not null check (char_length(subject) between 1 and 120),
  status text not null default 'waiting_recipient' check (status in ('open_internal','waiting_recipient','waiting_admin','done')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  -- サロン宛は会社必須（閲覧・返信できる人を会社/店舗の権限で決めるため）。美容師宛は本人必須。
  check ((audience = 'salon' and organization_id is not null) or (audience = 'stylist' and recipient_user_id is not null)),
  -- 店舗を指定する場合は会社も指定
  check (store_id is null or organization_id is not null)
);
create index on public.admin_threads (status, updated_at desc);
create index on public.admin_threads (organization_id) where organization_id is not null;
create index on public.admin_threads (recipient_user_id) where recipient_user_id is not null;

-- 4) 連絡メッセージ。「相手に見せる本文」と「運営内部メモ」は kind で分ける（相手側の関数は to_recipient / from_recipient だけを返す）
create table public.admin_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.admin_threads(id) on delete cascade,
  kind text not null check (kind in ('to_recipient','from_recipient','internal_note','offline_log')),  -- offline_log=メール/電話で行った対応の記録（内部）
  author_user_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 4000),
  request_id uuid,                                   -- 送信ID（再送の冪等性）。RPC経由の書き込みでは必須
  request_hash text,                                 -- 送信内容の指紋。同じ送信IDで内容が違うと拒否するため
  created_at timestamptz not null default now(),
  check ((request_id is null) = (request_hash is null))
);
create index on public.admin_messages (thread_id, created_at);
create unique index admin_messages_one_request on public.admin_messages (author_user_id, request_id) where request_id is not null;
create index admin_messages_sender_recent on public.admin_messages (author_user_id, created_at) where kind = 'from_recipient';

-- 5) メール通知の結果（本文は保存しない）。通知に失敗しても連絡自体は残り、運営が失敗を把握できる
create table public.admin_message_deliveries (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.admin_messages(id) on delete cascade,
  channel text not null default 'email' check (channel in ('email')),
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  error_code text check (error_code is null or char_length(error_code) <= 80),
  attempts integer not null default 0, last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  unique (message_id)                                -- 1メッセージにつき通知は1件（再試行は attempts を増やす）
);

-- 6) アカウント招待（受取人がメールから自分でパスワードを設定する。初期パスワードは扱わない）
create table public.account_invitations (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('new_company','add_to_company')),   -- 新しい会社の作成 と 既存会社への担当者追加 を区別
  organization_id uuid references public.salon_organizations(id) on delete restrict,   -- add_to_company では必須
  email text not null check (email = lower(email) and char_length(email) <= 254),
  intended_company_role text check (intended_company_role in ('company_owner','company_admin','recruiting_admin','area_manager')),
  intended_store_roles jsonb not null default '[]'::jsonb,   -- [{store_id, role}]。付与は受取人の利用開始時に、この内容どおりだけ
  status text not null default 'invited' check (status in ('invited','accepted','expired','suspended')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  invited_at timestamptz not null default now(), expires_at timestamptz not null,
  accepted_user_id uuid references auth.users(id) on delete set null, accepted_at timestamptz,
  resend_count integer not null default 0,
  check (mode <> 'add_to_company' or organization_id is not null)
);
-- 同じ会社・同じメールへの有効な招待は1件だけ（招待の重複防止）
create unique index account_invitations_one_active on public.account_invitations (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), email) where status = 'invited';
create table public.account_invitation_events (   -- 再送履歴
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.account_invitations(id) on delete cascade,
  event text not null check (event in ('created','resent','accepted','expired','suspended')),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 7) 一般向け「サロン登録」を問い合わせ受付に（会社名・担当者名・電話・メール）。送信先メールは未確定のため、まずDBに保存するだけ
create table public.salon_inquiries (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (char_length(company_name) between 1 and 100),
  contact_name text not null check (char_length(contact_name) between 1 and 60),
  phone text not null check (char_length(phone) between 6 and 20),
  email text not null check (char_length(email) between 3 and 254),
  status text not null default 'new' check (status in ('new','in_progress','done')),
  created_at timestamptz not null default now()
);

alter table public.admin_audit_events enable row level security;
alter table public.admin_visit_cases enable row level security;
alter table public.admin_threads enable row level security;
alter table public.admin_messages enable row level security;
alter table public.admin_message_deliveries enable row level security;
alter table public.account_invitations enable row level security;
alter table public.account_invitation_events enable row level security;
alter table public.salon_inquiries enable row level security;
-- ポリシーは作らない（= anon/authenticated は直接読み書きできない）。
-- 新設の全テーブルの権限を、PUBLIC・anon・authenticated・service_role から明示的に外す（既定権限に依存しない）。
-- 付与するものは無い: 読み書きはすべて SECURITY DEFINER の関数（所有者の権限）で行う。service_role もRLSはバイパスするが表の権限は別なので、ここで外す。
revoke all on public.admin_audit_events, public.admin_visit_cases, public.admin_threads, public.admin_messages,
  public.admin_message_deliveries, public.account_invitations, public.account_invitation_events, public.salon_inquiries
  from public, anon, authenticated, service_role;

-- 8) 権限判定の中核
--    サロン宛て: 会社の company_owner / company_admin / recruiting_admin（会社宛て・全店舗宛て）、
--               または【対象店舗の】store_members で store_manager / recruiter の行がある人。
--               エリア担当は「担当店舗に store_manager / recruiter の行がある場合のみ」その店舗宛てを見られる。
--               viewer（店舗行が viewer だけの人を含む）・他店舗・他社は不可。会社宛て（店舗指定なし）は会社の3役のみ。
--    美容師宛て: 受信者本人だけ（サロン側のどの権限でも見えない）。
--    閲覧できる人と返信できる人は同じ（閲覧のみには本文も返信も与えない）。
create or replace function public._admin_salon_access(p_org uuid, p_store uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select p_user is not null and p_org is not null and (
    exists (select 1 from public.organization_members om where om.organization_id = p_org and om.user_id = p_user
            and om.role in ('company_owner','company_admin','recruiting_admin'))
    or (p_store is not null and exists (
          select 1 from public.store_members sm join public.salon_stores s on s.id = sm.store_id
          where sm.store_id = p_store and s.organization_id = p_org and sm.user_id = p_user and sm.role in ('store_manager','recruiter')))
  );
$$;

create or replace function public._admin_thread_visible_to(p_thread_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select p_user_id is not null and exists (
    select 1 from public.admin_threads t
    where t.id = p_thread_id and (
      (t.audience = 'stylist' and t.recipient_user_id = p_user_id)
      or (t.audience = 'salon' and public._admin_salon_access(t.organization_id, t.store_id, p_user_id))
    )
  );
$$;

-- 相手側の画面に出してよいスレッド: 権限があり、かつ「相手に見せる本文」が1件以上ある（運営の内部だけのスレッドは見せない）
create or replace function public._admin_inbox_can_see(p_thread_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public._admin_thread_visible_to(p_thread_id, p_user_id)
     and exists (select 1 from public.admin_messages m where m.thread_id = p_thread_id and m.kind = 'to_recipient');
$$;

-- 9) 整合の強制（連絡先の取り違え防止）
--    作成時（INSERT）: 店舗は同じ会社／窓口の担当者は実際に閲覧できる人／美容師宛ての受信者は美容師アカウント／案件と宛先が一致。
--    作成後（UPDATE）: 宛先（種別・受信者・会社・店舗）は変更不可。権限の変更（異動・退職）は検証しない（運営が状態を変えられるように）。
create or replace function public._admin_threads_consistency() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
declare v_case record; v_case_org uuid;
begin
  if tg_op = 'UPDATE' then
    if new.audience is distinct from old.audience or new.recipient_user_id is distinct from old.recipient_user_id
       or new.organization_id is distinct from old.organization_id or new.store_id is distinct from old.store_id then
      raise exception 'thread destination cannot be changed';
    end if;
    return new;
  end if;
  if new.store_id is not null and not exists (select 1 from public.salon_stores s where s.id = new.store_id and s.organization_id = new.organization_id) then
    raise exception 'store does not belong to organization';
  end if;
  if new.audience = 'stylist' and not public._admin_is_stylist_account(new.recipient_user_id) then
    raise exception 'recipient is not a stylist account';
  end if;
  if new.audience = 'salon' and new.recipient_user_id is not null and not public._admin_salon_access(new.organization_id, new.store_id, new.recipient_user_id) then
    raise exception 'recipient cannot access this thread';
  end if;
  if new.visit_case_id is not null then
    select c.stylist_user_id, c.store_id into v_case from public.admin_visit_cases c where c.id = new.visit_case_id;
    if not found then raise exception 'visit case not found'; end if;
    select s.organization_id into v_case_org from public.salon_stores s where s.id = v_case.store_id;
    if new.audience = 'stylist' and v_case.stylist_user_id <> new.recipient_user_id then raise exception 'visit case belongs to another stylist'; end if;
    if new.audience = 'salon' and (v_case_org is distinct from new.organization_id or (new.store_id is not null and new.store_id <> v_case.store_id)) then
      raise exception 'visit case belongs to another company or store';
    end if;
  end if;
  return new;
end $$;
create trigger trg_admin_threads_consistency before insert or update on public.admin_threads
  for each row execute function public._admin_threads_consistency();

-- メッセージ: 運営の種別は運営者だけが書ける／相手側の返信は【その時点で】閲覧権限のある人だけ。追記専用（更新・削除不可）
create or replace function public._admin_messages_rules() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then raise exception 'messages are append-only'; end if;
  if tg_op = 'DELETE' then
    if pg_trigger_depth() = 1 then raise exception 'messages are append-only'; end if;
    return old;
  end if;
  if new.kind in ('to_recipient','internal_note','offline_log') and not exists (select 1 from public.platform_admins pa where pa.user_id = new.author_user_id) then
    raise exception 'only admins can write this kind of message';
  end if;
  if new.kind = 'from_recipient' and not public._admin_thread_visible_to(new.thread_id, new.author_user_id) then
    raise exception 'author cannot access this thread';
  end if;
  return new;
end $$;
create trigger trg_admin_messages_rules before insert or update or delete on public.admin_messages
  for each row execute function public._admin_messages_rules();

-- 送信内容の指紋（同じ送信IDで内容が違うことを検出する）。操作名を含めるので、別の操作に同じIDを使っても不一致になる
create or replace function public._admin_request_hash(p_op text, variadic p_parts text[]) returns text
language sql immutable set search_path = public, pg_temp
as $$ select md5(to_jsonb(array[p_op] || p_parts)::text) $$;

-- ロック（全操作で共通の順序: ①送信者 → ②送信ID → ③スレッド行）
create or replace function public._admin_lock_sender(p_user uuid) returns void
language sql set search_path = public, pg_temp as $$ select pg_advisory_xact_lock(hashtextextended('admin_sender:' || p_user::text, 0)) $$;
create or replace function public._admin_lock_request(p_user uuid, p_request uuid) returns void
language sql set search_path = public, pg_temp as $$ select pg_advisory_xact_lock(hashtextextended('admin_request:' || p_user::text || ':' || p_request::text, 0)) $$;

-- 10) 運営側RPC（先頭で is_platform_admin() を確認）
create or replace function public.admin_create_thread(p_request_id uuid, p_audience text, p_recipient_user_id uuid, p_organization_id uuid, p_store_id uuid,
  p_visit_case_id uuid, p_subject text, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_thread uuid; v_msg uuid; v_hash text; v_prev record; v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_request_id is null then raise exception 'request id required'; end if;
  if char_length(v_body) = 0 then raise exception 'invalid body'; end if;
  v_hash := public._admin_request_hash('create_thread', coalesce(p_audience,''), coalesce(p_recipient_user_id::text,''), coalesce(p_organization_id::text,''),
              coalesce(p_store_id::text,''), coalesce(p_visit_case_id::text,''), btrim(coalesce(p_subject,'')), v_body);
  perform public._admin_lock_request(v_uid, p_request_id);                                   -- ②（運営の作成は送信者ロック不要）
  select m.thread_id, m.request_hash into v_prev from public.admin_messages m where m.author_user_id = v_uid and m.request_id = p_request_id;
  if found then
    if v_prev.request_hash <> v_hash then raise exception 'request id content mismatch'; end if;
    return v_prev.thread_id;                                                                  -- 同じ要求の再送: 同じ結果
  end if;
  insert into public.admin_threads (audience, recipient_user_id, organization_id, store_id, visit_case_id, subject, created_by)
    values (p_audience, p_recipient_user_id, p_organization_id, p_store_id, p_visit_case_id, btrim(coalesce(p_subject,'')), v_uid) returning id into v_thread;
  insert into public.admin_messages (thread_id, kind, author_user_id, body, request_id, request_hash) values (v_thread, 'to_recipient', v_uid, v_body, p_request_id, v_hash) returning id into v_msg;
  insert into public.admin_message_deliveries (message_id) values (v_msg);
  insert into public.admin_audit_events (actor_user_id, action, target_type, target_id, organization_id, store_id, after_value)
    values (v_uid, 'thread_created', 'thread', v_thread, p_organization_id, p_store_id, jsonb_build_object('audience', p_audience));
  return v_thread;
end $$;

create or replace function public.admin_post_message(p_request_id uuid, p_thread_id uuid, p_kind text, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_msg uuid; v_hash text; v_prev record; v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_request_id is null then raise exception 'request id required'; end if;
  if p_kind not in ('to_recipient','internal_note','offline_log') then raise exception 'invalid kind'; end if;
  if char_length(v_body) = 0 then raise exception 'invalid body'; end if;
  v_hash := public._admin_request_hash('post_message', coalesce(p_thread_id::text,''), p_kind, v_body);
  perform public._admin_lock_request(v_uid, p_request_id);                                   -- ②
  select m.id, m.request_hash into v_prev from public.admin_messages m where m.author_user_id = v_uid and m.request_id = p_request_id;
  if found then
    if v_prev.request_hash <> v_hash then raise exception 'request id content mismatch'; end if;
    return v_prev.id;
  end if;
  perform 1 from public.admin_threads where id = p_thread_id for update;                    -- ③
  if not found then raise exception 'thread not found'; end if;
  insert into public.admin_messages (thread_id, kind, author_user_id, body, request_id, request_hash) values (p_thread_id, p_kind, v_uid, v_body, p_request_id, v_hash) returning id into v_msg;
  if p_kind = 'to_recipient' then
    insert into public.admin_message_deliveries (message_id) values (v_msg);
    update public.admin_threads set status = 'waiting_recipient', updated_at = now() where id = p_thread_id;   -- 完了後の追記は再開になる
  else
    update public.admin_threads set updated_at = now() where id = p_thread_id;
  end if;
  return v_msg;
end $$;

-- 状態の変更（完了・再開を含む）。窓口担当者の権限の有無は問わない（運営は常に操作できる）
create or replace function public.admin_set_thread_status(p_thread_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_old text;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_status not in ('open_internal','waiting_recipient','waiting_admin','done') then raise exception 'invalid status'; end if;
  select status into v_old from public.admin_threads where id = p_thread_id for update;   -- ③
  if not found then raise exception 'thread not found'; end if;
  if v_old = p_status then return; end if;
  update public.admin_threads set status = p_status, updated_at = now() where id = p_thread_id;
  insert into public.admin_audit_events (actor_user_id, action, target_type, target_id, before_value, after_value)
    values (auth.uid(), 'thread_status_changed', 'thread', p_thread_id, jsonb_build_object('status', v_old), jsonb_build_object('status', p_status));
end $$;

-- 一覧: 会社・店舗・案件のどこから開いても同じスレッドと状態が出る
create or replace function public.admin_list_threads(p_organization_id uuid default null, p_store_id uuid default null, p_visit_case_id uuid default null,
  p_status text default null, p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100); v_offset int := greatest(coalesce(p_offset, 0), 0); v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_status is not null and p_status not in ('open_internal','waiting_recipient','waiting_admin','done') then raise exception 'invalid status'; end if;
  with m as (
    select t.* from public.admin_threads t
    where (p_organization_id is null or t.organization_id = p_organization_id)
      and (p_store_id is null or t.store_id = p_store_id)
      and (p_visit_case_id is null or t.visit_case_id = p_visit_case_id)
      and (p_status is null or t.status = p_status)
  ), page as (select * from m order by updated_at desc, id limit v_limit offset v_offset)
  select jsonb_build_object('total', (select count(*) from m),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'audience', p.audience, 'subject', p.subject, 'status', p.status, 'updated_at', p.updated_at,
        'organization_id', p.organization_id, 'organization_name', (select o.name from public.salon_organizations o where o.id = p.organization_id),
        'store_id', p.store_id, 'store_name', (select s.store_name from public.salon_stores s where s.id = p.store_id),
        'visit_case_id', p.visit_case_id, 'recipient_user_id', p.recipient_user_id,
        'recipient_access_lost', (p.audience = 'salon' and p.recipient_user_id is not null and not public._admin_salon_access(p.organization_id, p.store_id, p.recipient_user_id)),
        'delivery_failed', exists (select 1 from public.admin_message_deliveries d join public.admin_messages mm on mm.id = d.message_id
                                   where mm.thread_id = p.id and d.status = 'failed')
      ) order by p.updated_at desc, p.id) from page p), '[]'::jsonb)) into v_result;
  return v_result;
end $$;

create or replace function public.admin_get_thread(p_thread_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select jsonb_build_object(
    'thread', jsonb_build_object('id', t.id, 'audience', t.audience, 'subject', t.subject, 'status', t.status, 'organization_id', t.organization_id,
        'store_id', t.store_id, 'visit_case_id', t.visit_case_id, 'recipient_user_id', t.recipient_user_id, 'created_at', t.created_at,
        'recipient_access_lost', (t.audience = 'salon' and t.recipient_user_id is not null and not public._admin_salon_access(t.organization_id, t.store_id, t.recipient_user_id)),
        'salon_reader_count', case when t.audience = 'salon' then (select count(*) from public.organization_members om where om.organization_id = t.organization_id and om.role in ('company_owner','company_admin','recruiting_admin'))
           + (select count(*) from public.store_members sm where sm.store_id = t.store_id and sm.role in ('store_manager','recruiter')) end),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'author_user_id', m.author_user_id,
          'author_name', nullif(u.raw_user_meta_data->>'display_name',''), 'body', m.body, 'created_at', m.created_at,
          'delivery', (select jsonb_build_object('status', d.status, 'error_code', d.error_code, 'attempts', d.attempts) from public.admin_message_deliveries d where d.message_id = m.id))
          order by m.created_at, m.id)
        from public.admin_messages m left join auth.users u on u.id = m.author_user_id where m.thread_id = t.id), '[]'::jsonb)
  ) into v_result from public.admin_threads t where t.id = p_thread_id;
  if v_result is null then raise exception 'thread not found'; end if;
  return v_result;
end $$;

-- メール通知の結果を記録（失敗しても連絡は残る）。通知は1メッセージ1件で、再試行は attempts が増える
create or replace function public.admin_record_delivery(p_message_id uuid, p_status text, p_error_code text default null) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_status not in ('sent','failed','skipped') then raise exception 'invalid status'; end if;
  update public.admin_message_deliveries set status = p_status, error_code = case when p_status = 'failed' then left(p_error_code, 80) else null end,
    attempts = attempts + 1, last_attempt_at = now()
  where message_id = p_message_id;
  if not found then raise exception 'delivery not found'; end if;
end $$;

-- 11) 相手側RPC（サロン・美容師）。返すのは「相手に見せる本文」(to_recipient / from_recipient)だけ。
--     権限が無い・存在しない・内部だけのスレッドは、区別せず同じ 'thread not found'。権限は【現在のメンバーシップ】で判定する。
create or replace function public.inbox_list_threads(p_limit integer default 30, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100); v_offset int := greatest(coalesce(p_offset, 0), 0); v_result jsonb;
begin
  if v_uid is null then raise exception 'login required'; end if;
  with v as (
    select t.id, t.audience, t.subject, t.status, t.organization_id, t.store_id,
           (select max(m.created_at) from public.admin_messages m where m.thread_id = t.id and m.kind in ('to_recipient','from_recipient')) as last_message_at
    from public.admin_threads t where public._admin_inbox_can_see(t.id, v_uid)
  ), page as (select * from v order by last_message_at desc, id limit v_limit offset v_offset)
  select jsonb_build_object('total', (select count(*) from v),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'subject', p.subject, 'last_message_at', p.last_message_at,
        'needs_reply', p.status = 'waiting_recipient', 'closed', p.status = 'done',
        'organization_name', case when p.audience = 'salon' then (select o.name from public.salon_organizations o where o.id = p.organization_id) end,
        'store_name', case when p.audience = 'salon' then (select s.store_name from public.salon_stores s where s.id = p.store_id) end
      ) order by p.last_message_at desc, p.id) from page p), '[]'::jsonb)) into v_result;
  return v_result;
end $$;

create or replace function public.inbox_get_thread(p_thread_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_result jsonb;
begin
  if v_uid is null then raise exception 'login required'; end if;
  if not public._admin_inbox_can_see(p_thread_id, v_uid) then raise exception 'thread not found'; end if;
  select jsonb_build_object('id', t.id, 'subject', t.subject, 'closed', t.status = 'done', 'can_reply', t.status <> 'done',
    'needs_reply', t.status = 'waiting_recipient',
    'organization_name', case when t.audience = 'salon' then (select o.name from public.salon_organizations o where o.id = t.organization_id) end,
    'store_name', case when t.audience = 'salon' then (select s.store_name from public.salon_stores s where s.id = t.store_id) end,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'from_admin', m.kind = 'to_recipient', 'is_mine', m.author_user_id = v_uid,
          'author_label', case when m.kind = 'to_recipient' then '運営' when m.author_user_id = v_uid then 'あなた' else coalesce(nullif(u.raw_user_meta_data->>'display_name',''), 'ご担当者') end,
          'body', m.body, 'created_at', m.created_at) order by m.created_at, m.id)
        from public.admin_messages m left join auth.users u on u.id = m.author_user_id
        where m.thread_id = t.id and m.kind in ('to_recipient','from_recipient')), '[]'::jsonb))
  into v_result from public.admin_threads t where t.id = p_thread_id;
  return v_result;
end $$;

-- 返信: 送信者単位で30件/時（全スレッド合算）。ロック順序 ①送信者 → ②送信ID → ③スレッド行。再送は同じ結果
create or replace function public.inbox_reply(p_request_id uuid, p_thread_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_status text; v_msg uuid; v_hash text; v_prev record; v_body text := btrim(coalesce(p_body, ''));
begin
  if v_uid is null then raise exception 'login required'; end if;
  if p_request_id is null then raise exception 'request id required'; end if;
  if not public._admin_inbox_can_see(p_thread_id, v_uid) then raise exception 'thread not found'; end if;
  if char_length(v_body) = 0 or char_length(p_body) > 4000 then raise exception 'invalid body'; end if;
  v_hash := public._admin_request_hash('reply', p_thread_id::text, v_body);
  perform public._admin_lock_sender(v_uid);                                                  -- ①
  perform public._admin_lock_request(v_uid, p_request_id);                                   -- ②
  select m.id, m.request_hash into v_prev from public.admin_messages m where m.author_user_id = v_uid and m.request_id = p_request_id;
  if found then
    if v_prev.request_hash <> v_hash then raise exception 'request id content mismatch'; end if;
    return v_prev.id;                                                                         -- 再送: 同じ結果。件数にも数えない
  end if;
  select status into v_status from public.admin_threads where id = p_thread_id for update;   -- ③
  if not public._admin_inbox_can_see(p_thread_id, v_uid) then raise exception 'thread not found'; end if;   -- ロック後に権限を再確認
  if v_status = 'done' then raise exception 'thread is closed'; end if;
  if (select count(*) from public.admin_messages where author_user_id = v_uid and kind = 'from_recipient' and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too many replies';
  end if;
  insert into public.admin_messages (thread_id, kind, author_user_id, body, request_id, request_hash) values (p_thread_id, 'from_recipient', v_uid, v_body, p_request_id, v_hash) returning id into v_msg;
  update public.admin_threads set status = 'waiting_admin', updated_at = now() where id = p_thread_id;
  return v_msg;
end $$;

-- 12) 実行権限（既定の権限に依存しない）: 全員・全ロールから外し、公開RPCだけ authenticated に付与。内部関数は付与なし
revoke all on function public._admin_salon_access(uuid, uuid, uuid), public._admin_thread_visible_to(uuid, uuid), public._admin_inbox_can_see(uuid, uuid),
  public._admin_threads_consistency(), public._admin_messages_rules(), public._admin_request_hash(text, text[]), public._admin_lock_sender(uuid), public._admin_lock_request(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_create_thread(uuid, text, uuid, uuid, uuid, uuid, text, text), public.admin_post_message(uuid, uuid, text, text),
  public.admin_set_thread_status(uuid, text), public.admin_list_threads(uuid, uuid, uuid, text, integer, integer), public.admin_get_thread(uuid),
  public.admin_record_delivery(uuid, text, text), public.inbox_list_threads(integer, integer), public.inbox_get_thread(uuid), public.inbox_reply(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_create_thread(uuid, text, uuid, uuid, uuid, uuid, text, text), public.admin_post_message(uuid, uuid, text, text),
  public.admin_set_thread_status(uuid, text), public.admin_list_threads(uuid, uuid, uuid, text, integer, integer), public.admin_get_thread(uuid),
  public.admin_record_delivery(uuid, text, text), public.inbox_list_threads(integer, integer), public.inbox_get_thread(uuid), public.inbox_reply(uuid, uuid, text)
  to authenticated;

commit;
