-- 0105_admin_work_records.draft.sql（v2・草案・未適用・番号は提案）。依存: 0097v2（admin_operator_role 等）と見学受付(admin_visit_requests / admin_visit_request_events)。既存オブジェクトは変更しない。
-- v1の欠陥: 公開RPCが任意の domain/action で記録を作れ、業務の状態が変わらないまま「採用確定」等の記録だけ作れた。
-- v2の方針:
--  1) 正式な対応記録(admin_work_records)を作る公開RPCは無い。作れるのは (a) 見学受付の業務イベント表への追記トリガー（業務RPCと同一トランザクション・同一失敗）と
--     (b) 内部関数 _admin_record_work（どのロールにも実行権なし。業務RPCからのみ呼ぶ）。
--  2) (domain, action) は操作カタログ(admin_work_operation_catalog)に載ったものだけ。各操作に最小ロール(staff/responsible)を持たせる。
--     採用確定・決済などは責任者のみ。カタログ外は外部キーで拒否。
--  3) 対象の存在確認（entity_type ごと）と、業務イベント1件につき記録1件（source_ref 一意）で重複を防ぐ。
--  4) 代理（実際に対応した人が入力者と違う）は別表 admin_work_attributions に責任者だけが追記（記録1件につき1回・理由必須）。
--  5) 自由記述メモは別表 admin_work_notes（正式記録と混ぜない・別RPC・対象存在確認・再送で重複しない）。
-- 共有アカウント時代の操作は個人へ付け替えない（legacy_shared=true は performed_by/entered_by を持たない）。★バックフィルは本草案に含めない（別途レビュー）。
begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('beauty-reach-0105'));
do $guard$
begin
  if to_regclass('public.admin_work_records') is not null or to_regclass('public.admin_work_notes') is not null or to_regclass('public.admin_work_operation_catalog') is not null
     or to_regclass('public.admin_work_attributions') is not null or to_regprocedure('public.admin_work_records_immutable()') is not null then
    raise exception '0105 適用中止: 新規オブジェクトが既に存在します' using errcode = 'P0001'; end if;
  if to_regprocedure('public.admin_operator_role()') is null or to_regprocedure('public.is_admin_operator()') is null or to_regclass('public.admin_staff') is null
     or to_regclass('public.admin_visit_requests') is null or to_regclass('public.admin_visit_request_events') is null
     or to_regclass('public.store_hiring_processes') is null or to_regclass('public.admin_invoices') is null then
    raise exception '0105 適用中止: 依存(0097v2・見学受付・採用・請求)がありません' using errcode = 'P0001'; end if;
end $guard$;

-- 追記専用トリガー（表ごとに使う共通関数）
create function public.admin_work_records_immutable() returns trigger language plpgsql set search_path = public, pg_temp
as $$ begin raise exception '% is append-only', tg_table_name; end; $$;
revoke all on function public.admin_work_records_immutable() from public, anon, authenticated, service_role;

-- 操作カタログ: 記録できる操作の一覧（これ以外は記録できない）
create table public.admin_work_operation_catalog (
  domain text not null, action text not null, entity_type text not null check (entity_type in ('visit_request', 'store_hiring_process', 'admin_invoice')),
  min_role text not null check (min_role in ('staff', 'responsible')),
  primary key (domain, action)
);
insert into public.admin_work_operation_catalog (domain, action, entity_type, min_role) values
  ('visit_intake',     'claimed',              'visit_request', 'staff'),
  ('visit_intake',     'assignee_changed',     'visit_request', 'staff'),
  ('visit_intake',     'reviewing',            'visit_request', 'staff'),
  ('visit_intake',     'details_updated',      'visit_request', 'staff'),
  ('visit_schedule',   'scheduling',           'visit_request', 'staff'),
  ('visit_schedule',   'scheduled',            'visit_request', 'staff'),
  ('visit_schedule',   'schedule_updated',     'visit_request', 'staff'),
  ('visit_attendance', 'visit_check_started',  'visit_request', 'staff'),
  ('visit_attendance', 'confirmation_recorded','visit_request', 'staff'),
  ('visit_attendance', 'attended',             'visit_request', 'staff'),
  ('visit_attendance', 'closed',               'visit_request', 'staff'),
  ('visit_attendance', 'auto_closed_duplicate','visit_request', 'staff'),
  ('hire_confirmation','confirmed',            'store_hiring_process', 'responsible'),   -- 採用確定: 責任者のみ（記録を作る業務RPCは本草案の範囲外・0098以降）
  ('payment',          'recorded',             'admin_invoice', 'responsible');            -- 入金・決済: 責任者のみ
alter table public.admin_work_operation_catalog enable row level security;
revoke all on table public.admin_work_operation_catalog from public, anon, authenticated, service_role;
create trigger admin_work_operation_catalog_no_change before update or delete on public.admin_work_operation_catalog for each row execute function public.admin_work_records_immutable();
create trigger admin_work_operation_catalog_no_truncate before truncate on public.admin_work_operation_catalog for each statement execute function public.admin_work_records_immutable();

-- 正式な対応記録
create table public.admin_work_records (
  id uuid primary key default gen_random_uuid(),
  source_ref text not null unique check (char_length(source_ref) between 3 and 120),   -- 元になった業務イベント（例 admin_visit_request_events:<uuid>）。1件につき記録1件
  domain text not null, action text not null,
  entity_type text not null, entity_id uuid not null,
  assignee_at_time uuid references auth.users(id) on delete restrict,       -- その時点の現在の担当（スナップショット）
  performed_by uuid references auth.users(id) on delete restrict,           -- 操作した人（=サーバー側の auth.uid()。画面から指定させない）
  entered_by uuid references auth.users(id) on delete restrict,             -- 入力した人（現状は performed_by と同じ。代理は admin_work_attributions）
  occurred_at timestamptz not null,
  entered_at timestamptz not null default now(),
  legacy_shared boolean not null default false,
  detail jsonb check (detail is null or pg_column_size(detail) <= 2000),
  foreign key (domain, action) references public.admin_work_operation_catalog (domain, action),
  constraint admin_work_records_actors check (
    (legacy_shared and performed_by is null and entered_by is null) or (not legacy_shared and performed_by is not null and entered_by is not null and performed_by = entered_by))
);
create index admin_work_records_entity_idx on public.admin_work_records (entity_type, entity_id, occurred_at desc);
create index admin_work_records_performed_idx on public.admin_work_records (performed_by, occurred_at desc);
alter table public.admin_work_records enable row level security;
revoke all on table public.admin_work_records from public, anon, authenticated, service_role;
create trigger admin_work_records_no_change before update or delete on public.admin_work_records for each row execute function public.admin_work_records_immutable();
create trigger admin_work_records_no_truncate before truncate on public.admin_work_records for each statement execute function public.admin_work_records_immutable();

-- 代理の付記（実際に対応した人が操作した人と違うとき。責任者のみ・理由必須・1記録につき1回）
create table public.admin_work_attributions (
  record_id uuid primary key references public.admin_work_records(id) on delete restrict,
  performed_by uuid not null references auth.users(id) on delete restrict,
  entered_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  entered_at timestamptz not null default now()
);
alter table public.admin_work_attributions enable row level security;
revoke all on table public.admin_work_attributions from public, anon, authenticated, service_role;
create trigger admin_work_attributions_no_change before update or delete on public.admin_work_attributions for each row execute function public.admin_work_records_immutable();
create trigger admin_work_attributions_no_truncate before truncate on public.admin_work_attributions for each statement execute function public.admin_work_records_immutable();

-- 自由記述メモ（正式な対応記録ではない）
create table public.admin_work_notes (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('visit_request')),
  entity_id uuid not null,
  author uuid not null references auth.users(id) on delete restrict,
  client_request_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  unique (author, client_request_id)
);
create index admin_work_notes_entity_idx on public.admin_work_notes (entity_type, entity_id, created_at desc);
alter table public.admin_work_notes enable row level security;
revoke all on table public.admin_work_notes from public, anon, authenticated, service_role;
create trigger admin_work_notes_no_change before update or delete on public.admin_work_notes for each row execute function public.admin_work_records_immutable();
create trigger admin_work_notes_no_truncate before truncate on public.admin_work_notes for each statement execute function public.admin_work_records_immutable();

-- 内部関数: 正式記録の作成（どのロールにも実行権なし。業務RPC・トリガーからのみ）。
create function public._admin_record_work(p_domain text, p_action text, p_entity_id uuid, p_source_ref text, p_occurred_at timestamptz default null, p_detail jsonb default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_role text := public.admin_operator_role(); c public.admin_work_operation_catalog; v_assignee uuid; v_found boolean; v_when timestamptz := coalesce(p_occurred_at, now()); v_id uuid;
begin
  if v_uid is null or v_role is null then raise exception 'admin access required'; end if;
  select * into c from public.admin_work_operation_catalog where domain = p_domain and action = p_action;
  if not found then raise exception 'unknown work operation: %/%', p_domain, p_action; end if;
  if c.min_role = 'responsible' and v_role <> 'responsible' then raise exception 'operation % / % is responsible-only', p_domain, p_action; end if;
  if v_when > now() + interval '1 minute' then raise exception 'occurred_at is in the future'; end if;
  if c.entity_type = 'visit_request' then
    select true, assigned_admin_id into v_found, v_assignee from public.admin_visit_requests where id = p_entity_id for share;
  elsif c.entity_type = 'store_hiring_process' then
    select exists (select 1 from public.store_hiring_processes where id = p_entity_id) into v_found;
  elsif c.entity_type = 'admin_invoice' then
    select exists (select 1 from public.admin_invoices where id = p_entity_id) into v_found;
  end if;
  if v_found is not true then raise exception 'entity not found'; end if;
  insert into public.admin_work_records (source_ref, domain, action, entity_type, entity_id, assignee_at_time, performed_by, entered_by, occurred_at, detail)
    values (p_source_ref, p_domain, p_action, c.entity_type, p_entity_id, v_assignee, v_uid, v_uid, v_when, p_detail)
    on conflict (source_ref) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.admin_work_records where source_ref = p_source_ref;   -- 同じ業務イベントの再記録は既存を返す（重複を作らない）
    if (select (domain, action, entity_id) is distinct from (p_domain, p_action, p_entity_id) from public.admin_work_records where id = v_id) then raise exception 'source_ref already used by a different operation'; end if;
  end if;
  return v_id;
end; $$;

-- 見学受付の業務イベント → 操作の対応。未知のイベントは例外（記録されない操作を黙って通さない）。
create function public._admin_visit_event_op(p_action text, p_before jsonb, p_after jsonb) returns text[]
language plpgsql immutable set search_path = public, pg_temp
as $$
declare v_to text := p_after->>'status'; v_from text := p_before->>'status';
begin
  if p_action = 'claimed' then return array['visit_intake', 'claimed']; end if;
  if p_action = 'assigned' then return array['visit_intake', 'assignee_changed']; end if;
  if p_action = 'confirmation_recorded' then return array['visit_attendance', 'confirmation_recorded']; end if;
  if p_action = 'auto_closed_duplicate' then return array['visit_attendance', 'auto_closed_duplicate']; end if;
  if p_action = 'updated' then
    if v_to is null then raise exception 'visit event without status'; end if;
    if v_from is not distinct from v_to then
      return case when v_to in ('scheduling', 'scheduled') then array['visit_schedule', 'schedule_updated'] else array['visit_intake', 'details_updated'] end;
    end if;
    return case v_to when 'reviewing' then array['visit_intake', 'reviewing'] when 'received' then array['visit_intake', 'details_updated']
      when 'scheduling' then array['visit_schedule', 'scheduling'] when 'scheduled' then array['visit_schedule', 'scheduled']
      when 'post_visit_check' then array['visit_attendance', 'visit_check_started'] when 'attended' then array['visit_attendance', 'attended']
      when 'closed' then array['visit_attendance', 'closed'] else null end;
  end if;
  return null;
end; $$;
create function public._admin_visit_event_to_work() returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_op text[] := public._admin_visit_event_op(new.action, new.before_value, new.after_value);
begin
  if v_op is null then raise exception 'unmapped visit event action: %', new.action; end if;
  if new.actor_user_id is distinct from auth.uid() then raise exception 'visit event actor must be the signed-in operator'; end if;
  perform public._admin_record_work(v_op[1], v_op[2], new.request_id, 'admin_visit_request_events:' || new.id::text, new.created_at,
    jsonb_build_object('from', new.before_value->>'status', 'to', new.after_value->>'status'));
  return null;
end; $$;
create trigger admin_visit_request_events_to_work after insert on public.admin_visit_request_events for each row execute function public._admin_visit_event_to_work();
revoke all on function public._admin_record_work(text, text, uuid, text, timestamptz, jsonb), public._admin_visit_event_op(text, jsonb, jsonb), public._admin_visit_event_to_work() from public, anon, authenticated, service_role;

-- 代理の付記（責任者のみ）
create function public.admin_work_attribution_add(p_record_id uuid, p_performed_by uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); r public.admin_work_records; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_platform_admin() then raise exception 'only responsible admin may attribute'; end if;
  select * into r from public.admin_work_records where id = p_record_id for update;
  if not found then raise exception 'record not found'; end if;
  if r.legacy_shared then raise exception 'legacy shared record cannot be attributed to an individual'; end if;
  if p_performed_by is null or p_performed_by = r.performed_by then raise exception 'performed_by must differ from the recorded operator'; end if;
  if v_reason is null or char_length(v_reason) < 5 then raise exception 'reason required'; end if;
  if not (exists (select 1 from public.platform_admins where user_id = p_performed_by) or exists (select 1 from public.admin_staff where user_id = p_performed_by and status = 'active')) then
    raise exception 'performed_by must be an active operator'; end if;
  if exists (select 1 from public.admin_work_attributions where record_id = p_record_id) then raise exception 'record already attributed'; end if;
  insert into public.admin_work_attributions (record_id, performed_by, entered_by, reason) values (p_record_id, p_performed_by, v_uid, v_reason);
end; $$;

-- 自由記述メモ（運営）。同じ(作成者, client_request_id)の再送は同じ行を返す。
create function public.admin_work_note_add(p_entity_type text, p_entity_id uuid, p_client_request_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_body text := btrim(coalesce(p_body, '')); v_old public.admin_work_notes;
begin
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
  if p_entity_type is distinct from 'visit_request' then raise exception 'unsupported entity_type'; end if;
  if p_client_request_id is null then raise exception 'client_request_id required'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 1000 then raise exception 'note length invalid'; end if;
  perform 1 from public.admin_visit_requests where id = p_entity_id for share;
  if not found then raise exception 'entity not found'; end if;
  select * into v_old from public.admin_work_notes where author = v_uid and client_request_id = p_client_request_id;
  if found then
    if v_old.body <> v_body or v_old.entity_id <> p_entity_id then raise exception 'client_request_id reused with different content'; end if;
    return v_old.id;
  end if;
  if (select count(*) from public.admin_work_notes where entity_type = p_entity_type and entity_id = p_entity_id) >= 200 then raise exception 'too many notes'; end if;
  insert into public.admin_work_notes (entity_type, entity_id, author, client_request_id, body) values (p_entity_type, p_entity_id, v_uid, p_client_request_id, v_body)
    on conflict (author, client_request_id) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.admin_work_notes where author = v_uid and client_request_id = p_client_request_id; end if;
  return v_id;
end; $$;

-- 閲覧（運営のみ）。正式記録とメモは別々のRPC。氏名は admin_operator_directory で引く。
create function public.admin_work_records_for(p_entity_type text, p_entity_id uuid, p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('domain', r.domain, 'action', r.action, 'entity_type', r.entity_type, 'entity_id', r.entity_id,
      'assignee_at_time', r.assignee_at_time, 'performed_by', coalesce(a.performed_by, r.performed_by), 'entered_by', coalesce(a.entered_by, r.entered_by), 'operator', r.performed_by,
      'proxy_reason', a.reason, 'occurred_at', r.occurred_at, 'entered_at', r.entered_at, 'legacy_shared', r.legacy_shared, 'detail', r.detail) order by r.occurred_at desc)
    from (select * from public.admin_work_records where entity_type = p_entity_type and entity_id = p_entity_id order by occurred_at desc limit greatest(1, least(coalesce(p_limit, 100), 200))) r
    left join public.admin_work_attributions a on a.record_id = r.id), '[]'::jsonb);
end; $$;
create function public.admin_work_notes_for(p_entity_type text, p_entity_id uuid, p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('author', n.author, 'body', n.body, 'created_at', n.created_at) order by n.created_at desc)
    from (select * from public.admin_work_notes where entity_type = p_entity_type and entity_id = p_entity_id order by created_at desc limit greatest(1, least(coalesce(p_limit, 100), 200))) n), '[]'::jsonb);
end; $$;
revoke all on function public.admin_work_attribution_add(uuid, uuid, text), public.admin_work_note_add(text, uuid, uuid, text), public.admin_work_records_for(text, uuid, integer), public.admin_work_notes_for(text, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_work_attribution_add(uuid, uuid, text), public.admin_work_note_add(text, uuid, uuid, text), public.admin_work_records_for(text, uuid, integer), public.admin_work_notes_for(text, uuid, integer) to authenticated;
commit;
