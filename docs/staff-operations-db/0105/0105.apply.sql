-- 0105 適用（草案・本番未適用・番号は提案）
-- ★単独実行形式（psql専用命令なし）。Supabase SQL Editor に全文を貼り付けて実行できる。不一致は例外で全体がロールバックされる。
-- ★失敗したら『rollback;』だけを単独で実行して状態を確認する。期待値は使い捨てDBでの実測（gen_staff_guards.py）。本番の実定義が検証DBと異なれば『適用前』で中止する（保守的）。
-- ★検査は2種類: 『変更対象』(このSQLが置き換える既存オブジェクトが想定の版か) と 『依存先』(このSQLが前提にするが変更しない関数・表・認証側の参照列・ロールが想定どおりか)。
begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtextextended('beauty-reach-staff-0105', 0));
do $guard$
declare v_cur jsonb; v_exp jsonb := '{"deprel:admin_visit_request_events": "67f07151ca0f842472638d1cb8dc2ca5", "rel:admin_visit_request_events": "0f33bb52d10854a136d401314ad0d3e0"}'::jsonb; v_bad text;
begin
  v_cur := (select coalesce(jsonb_object_agg(k, h), '{}'::jsonb) from (select 'fn:' || p.oid::regprocedure::text as k, md5(p.prosrc || '|' || pg_get_function_arguments(p.oid) || '|' || pg_get_function_result(p.oid) || '|' || p.prokind::text || p.prosecdef || p.provolatile::text || p.proparallel::text || p.proleakproof || p.proisstrict || p.proretset || '|' || (select l.lanname from pg_language l where l.oid = p.prolang) || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a),'') || '|' || coalesce(array_to_string(p.proconfig, ','), '')) as h from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') union all select 'rel:' || c.relname, md5(c.relkind::text || '|' || pg_get_userbyid(c.relowner) || '|' || c.relrowsecurity || c.relforcerowsecurity || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a),'') || '|' || coalesce((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ':' || a.attidentity::text || a.attgenerated::text, ',' order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '') || '|' || coalesce((select string_agg(k.conname || ':' || pg_get_constraintdef(k.oid) || ':' || k.convalidated, ',' order by k.conname) from pg_constraint k where k.conrelid = c.oid), '') || '|' || coalesce((select string_agg(i.indexdef, ',' order by i.indexname) from pg_indexes i where i.schemaname = 'public' and i.tablename = c.relname), '') || '|' || coalesce((select string_agg(o.polname || ':' || o.polcmd::text || ':' || o.polpermissive || ':' || coalesce(pg_get_expr(o.polqual, o.polrelid), '') || ':' || coalesce(pg_get_expr(o.polwithcheck, o.polrelid), '') || ':' || (select coalesce(string_agg(case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end, ',' order by case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end), '') from unnest(o.polroles) r), ',' order by o.polname) from pg_policy o where o.polrelid = c.oid), '') || '|' || coalesce((select string_agg(t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid), ',' order by t.tgname) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal), '')) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','S','f') union all select 'type:' || t.typname, md5(t.typtype::text || '|' || coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid), '')) from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype = 'e' union all select 'authtrg:' || t.tgname, md5(t.tgenabled::text || pg_get_triggerdef(t.oid)) from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal union all select 'deprel:' || c.relname, md5(c.relkind::text || '|' || c.relrowsecurity || c.relforcerowsecurity || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a),'') || '|' || coalesce((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attname) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '') || '|' || coalesce((select string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), ',' order by k.conname) from pg_constraint k where k.conrelid = c.oid), '') || '|' || coalesce((select string_agg(o.polname || ':' || o.polcmd::text || ':' || coalesce(pg_get_expr(o.polqual, o.polrelid), '') || ':' || coalesce(pg_get_expr(o.polwithcheck, o.polrelid), ''), ',' order by o.polname) from pg_policy o where o.polrelid = c.oid), '') || '|' || coalesce((select string_agg(t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid), ',' order by t.tgname) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal), '')) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m') union all select 'authcol:' || c.relname || '.' || a.attname, md5(format_type(a.atttypid, a.atttypmod)) from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped where c.relnamespace = 'auth'::regnamespace and c.relname in ('users', 'sessions') and c.relkind in ('r','p') union all select 'authfn:' || p.proname, md5(pg_get_function_identity_arguments(p.oid) || '->' || pg_get_function_result(p.oid)) from pg_proc p where p.pronamespace = 'auth'::regnamespace and p.proname in ('uid', 'jwt', 'role') union all select 'role:' || r.rolname, md5(r.rolname) from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role', 'postgres')) t(k, h));
  select string_agg(e.key, ', ' order by e.key) into v_bad from jsonb_each_text(v_exp) e where v_cur->>e.key is distinct from e.value;
  if v_bad is not null then raise exception 'staff guard [適用前:変更対象] 不一致のオブジェクト: %', v_bad using errcode = 'P0001'; end if;
end $guard$;
do $guard$
declare v_cur jsonb; v_exp jsonb := '{"authcol:users.created_at": "78a4814f9534f1fcc5c04078c5611170", "authcol:users.id": "ef7c876f00f3acddd00fa671f52d0b1f", "authfn:uid": "58627ab0dc7622a31c473a39e78ac4aa", "deprel:admin_invoices": "4040758b34b82b0fe772935a5e63c9f7", "deprel:admin_staff": "61aeae355319b94d91adabce30d68033", "deprel:admin_visit_requests": "c2dbc019d5c5220dba03ef1e605b49fa", "deprel:platform_admins": "6f50dd58e387003d7474ebbea5215ee0", "deprel:store_hiring_processes": "752dc73c404649ecc0f2d8cbfbd99539", "fn:admin_operator_role()": "36ceb5a9c8f964de76f506a5ee6e442b", "fn:is_admin_operator()": "6fb15c8e5089c734712b369b23bfb5d5", "fn:is_platform_admin()": "754f6e8b487bd2d97787a059af238def", "role:anon": "2ae66f90b7788ab8950e8f81b829c947", "role:authenticated": "700633a1b0f65fa8456a18bd6053193c", "role:service_role": "c56ec2e104f2c93fd656087be1e991a0"}'::jsonb; v_bad text;
begin
  v_cur := (select coalesce(jsonb_object_agg(k, h), '{}'::jsonb) from (select 'fn:' || p.oid::regprocedure::text as k, md5(p.prosrc || '|' || pg_get_function_arguments(p.oid) || '|' || pg_get_function_result(p.oid) || '|' || p.prokind::text || p.prosecdef || p.provolatile::text || p.proparallel::text || p.proleakproof || p.proisstrict || p.proretset || '|' || (select l.lanname from pg_language l where l.oid = p.prolang) || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a),'') || '|' || coalesce(array_to_string(p.proconfig, ','), '')) as h from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') union all select 'rel:' || c.relname, md5(c.relkind::text || '|' || pg_get_userbyid(c.relowner) || '|' || c.relrowsecurity || c.relforcerowsecurity || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a),'') || '|' || coalesce((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ':' || a.attidentity::text || a.attgenerated::text, ',' order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '') || '|' || coalesce((select string_agg(k.conname || ':' || pg_get_constraintdef(k.oid) || ':' || k.convalidated, ',' order by k.conname) from pg_constraint k where k.conrelid = c.oid), '') || '|' || coalesce((select string_agg(i.indexdef, ',' order by i.indexname) from pg_indexes i where i.schemaname = 'public' and i.tablename = c.relname), '') || '|' || coalesce((select string_agg(o.polname || ':' || o.polcmd::text || ':' || o.polpermissive || ':' || coalesce(pg_get_expr(o.polqual, o.polrelid), '') || ':' || coalesce(pg_get_expr(o.polwithcheck, o.polrelid), '') || ':' || (select coalesce(string_agg(case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end, ',' order by case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end), '') from unnest(o.polroles) r), ',' order by o.polname) from pg_policy o where o.polrelid = c.oid), '') || '|' || coalesce((select string_agg(t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid), ',' order by t.tgname) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal), '')) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','S','f') union all select 'type:' || t.typname, md5(t.typtype::text || '|' || coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid), '')) from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype = 'e' union all select 'authtrg:' || t.tgname, md5(t.tgenabled::text || pg_get_triggerdef(t.oid)) from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal union all select 'deprel:' || c.relname, md5(c.relkind::text || '|' || c.relrowsecurity || c.relforcerowsecurity || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a),'') || '|' || coalesce((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attname) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '') || '|' || coalesce((select string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), ',' order by k.conname) from pg_constraint k where k.conrelid = c.oid), '') || '|' || coalesce((select string_agg(o.polname || ':' || o.polcmd::text || ':' || coalesce(pg_get_expr(o.polqual, o.polrelid), '') || ':' || coalesce(pg_get_expr(o.polwithcheck, o.polrelid), ''), ',' order by o.polname) from pg_policy o where o.polrelid = c.oid), '') || '|' || coalesce((select string_agg(t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid), ',' order by t.tgname) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal), '')) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m') union all select 'authcol:' || c.relname || '.' || a.attname, md5(format_type(a.atttypid, a.atttypmod)) from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped where c.relnamespace = 'auth'::regnamespace and c.relname in ('users', 'sessions') and c.relkind in ('r','p') union all select 'authfn:' || p.proname, md5(pg_get_function_identity_arguments(p.oid) || '->' || pg_get_function_result(p.oid)) from pg_proc p where p.pronamespace = 'auth'::regnamespace and p.proname in ('uid', 'jwt', 'role') union all select 'role:' || r.rolname, md5(r.rolname) from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role', 'postgres')) t(k, h));
  select string_agg(e.key, ', ' order by e.key) into v_bad from jsonb_each_text(v_exp) e where v_cur->>e.key is distinct from e.value;
  if v_bad is not null then raise exception 'staff guard [適用前:依存先] 不一致のオブジェクト: %', v_bad using errcode = 'P0001'; end if;
  if exists (select 1 from jsonb_object_keys(v_cur) k where k = any(array['deprel:admin_work_attributions','deprel:admin_work_notes','deprel:admin_work_operation_catalog','deprel:admin_work_records','fn:_admin_record_work(text,text,uuid,text,timestamp with time zone,jsonb)','fn:_admin_visit_event_op(text,jsonb,jsonb)','fn:_admin_visit_event_to_work()','fn:admin_work_attribution_add(uuid,uuid,text)','fn:admin_work_note_add(text,uuid,uuid,text)','fn:admin_work_notes_for(text,uuid,integer)','fn:admin_work_records_for(text,uuid,integer)','fn:admin_work_records_immutable()','rel:admin_work_attributions','rel:admin_work_notes','rel:admin_work_operation_catalog','rel:admin_work_records']::text[])) then raise exception 'staff guard [適用前] 新規オブジェクトが既に存在する(二重適用・名前衝突)' using errcode = 'P0001'; end if;
  perform set_config('staff.pre_map', v_cur::text, true);
end $guard$;
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

do $guard$
declare v_cur jsonb; v_exp jsonb := '{"deprel:admin_visit_request_events": "6ee3ce544f321d87611cf31cac3a0439", "deprel:admin_work_attributions": "c6a2e8da272dcb0800cf33cb5dc51961", "deprel:admin_work_notes": "d459e48e5486f2aceb1262ff88ba9671", "deprel:admin_work_operation_catalog": "3ff3b1cac1c641eb6cf03291ef647a66", "deprel:admin_work_records": "e0144cc8309faaf81a64f8be92c271e7", "fn:_admin_record_work(text,text,uuid,text,timestamp with time zone,jsonb)": "894f961593df65569d6f59b7942a1c0e", "fn:_admin_visit_event_op(text,jsonb,jsonb)": "868be06f9f7466568ecf07dfe7df39a2", "fn:_admin_visit_event_to_work()": "f3916a842d39474dfba876cf87196a9c", "fn:admin_work_attribution_add(uuid,uuid,text)": "5d329d8e49f17b933428ece5fcf2a586", "fn:admin_work_note_add(text,uuid,uuid,text)": "eea36ce147e1b0ed31cd9f86e13c0ef4", "fn:admin_work_notes_for(text,uuid,integer)": "5248be305ea002b521f16d5286e6bf8a", "fn:admin_work_records_for(text,uuid,integer)": "ecd8504ec84ee237dbd8cd4df2342bfc", "fn:admin_work_records_immutable()": "670a150ceef4d9f1eb2bed1fe83a4a09", "rel:admin_visit_request_events": "c7ad548729d322f7f5b618d7a007078a", "rel:admin_work_attributions": "650ee0c392851d3e712e73c574cdd114", "rel:admin_work_notes": "d003511afe4d924258aec3e9ef0e5c0f", "rel:admin_work_operation_catalog": "6e9094eabaa18dd82582b540f0d84421", "rel:admin_work_records": "04157656d5d6ca415ad90e40379f28c8"}'::jsonb; v_bad text;
begin
  v_cur := (select coalesce(jsonb_object_agg(k, h), '{}'::jsonb) from (select 'fn:' || p.oid::regprocedure::text as k, md5(p.prosrc || '|' || pg_get_function_arguments(p.oid) || '|' || pg_get_function_result(p.oid) || '|' || p.prokind::text || p.prosecdef || p.provolatile::text || p.proparallel::text || p.proleakproof || p.proisstrict || p.proretset || '|' || (select l.lanname from pg_language l where l.oid = p.prolang) || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a),'') || '|' || coalesce(array_to_string(p.proconfig, ','), '')) as h from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') union all select 'rel:' || c.relname, md5(c.relkind::text || '|' || pg_get_userbyid(c.relowner) || '|' || c.relrowsecurity || c.relforcerowsecurity || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a),'') || '|' || coalesce((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ':' || a.attidentity::text || a.attgenerated::text, ',' order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '') || '|' || coalesce((select string_agg(k.conname || ':' || pg_get_constraintdef(k.oid) || ':' || k.convalidated, ',' order by k.conname) from pg_constraint k where k.conrelid = c.oid), '') || '|' || coalesce((select string_agg(i.indexdef, ',' order by i.indexname) from pg_indexes i where i.schemaname = 'public' and i.tablename = c.relname), '') || '|' || coalesce((select string_agg(o.polname || ':' || o.polcmd::text || ':' || o.polpermissive || ':' || coalesce(pg_get_expr(o.polqual, o.polrelid), '') || ':' || coalesce(pg_get_expr(o.polwithcheck, o.polrelid), '') || ':' || (select coalesce(string_agg(case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end, ',' order by case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end), '') from unnest(o.polroles) r), ',' order by o.polname) from pg_policy o where o.polrelid = c.oid), '') || '|' || coalesce((select string_agg(t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid), ',' order by t.tgname) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal), '')) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','S','f') union all select 'type:' || t.typname, md5(t.typtype::text || '|' || coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid), '')) from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype = 'e' union all select 'authtrg:' || t.tgname, md5(t.tgenabled::text || pg_get_triggerdef(t.oid)) from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal union all select 'deprel:' || c.relname, md5(c.relkind::text || '|' || c.relrowsecurity || c.relforcerowsecurity || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a),'') || '|' || coalesce((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attname) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '') || '|' || coalesce((select string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), ',' order by k.conname) from pg_constraint k where k.conrelid = c.oid), '') || '|' || coalesce((select string_agg(o.polname || ':' || o.polcmd::text || ':' || coalesce(pg_get_expr(o.polqual, o.polrelid), '') || ':' || coalesce(pg_get_expr(o.polwithcheck, o.polrelid), ''), ',' order by o.polname) from pg_policy o where o.polrelid = c.oid), '') || '|' || coalesce((select string_agg(t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid), ',' order by t.tgname) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal), '')) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m') union all select 'authcol:' || c.relname || '.' || a.attname, md5(format_type(a.atttypid, a.atttypmod)) from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped where c.relnamespace = 'auth'::regnamespace and c.relname in ('users', 'sessions') and c.relkind in ('r','p') union all select 'authfn:' || p.proname, md5(pg_get_function_identity_arguments(p.oid) || '->' || pg_get_function_result(p.oid)) from pg_proc p where p.pronamespace = 'auth'::regnamespace and p.proname in ('uid', 'jwt', 'role') union all select 'role:' || r.rolname, md5(r.rolname) from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role', 'postgres')) t(k, h));
  select string_agg(e.key, ', ' order by e.key) into v_bad from jsonb_each_text(v_exp) e where v_cur->>e.key is distinct from e.value;
  if v_bad is not null then raise exception 'staff guard [適用後] 不一致のオブジェクト: %', v_bad using errcode = 'P0001'; end if;
  if (select coalesce(string_agg(k, ',' order by k), '') from jsonb_object_keys(v_cur) k where not ((current_setting('staff.pre_map')::jsonb) ? k)) is distinct from 'deprel:admin_work_attributions,deprel:admin_work_notes,deprel:admin_work_operation_catalog,deprel:admin_work_records,fn:_admin_record_work(text,text,uuid,text,timestamp with time zone,jsonb),fn:_admin_visit_event_op(text,jsonb,jsonb),fn:_admin_visit_event_to_work(),fn:admin_work_attribution_add(uuid,uuid,text),fn:admin_work_note_add(text,uuid,uuid,text),fn:admin_work_notes_for(text,uuid,integer),fn:admin_work_records_for(text,uuid,integer),fn:admin_work_records_immutable(),rel:admin_work_attributions,rel:admin_work_notes,rel:admin_work_operation_catalog,rel:admin_work_records' then
    raise exception 'staff guard [適用後] 新規オブジェクトの集合が期待と違う' using errcode = 'P0001'; end if;
  select string_agg(e.key, ', ' order by e.key) into v_bad from jsonb_each_text(current_setting('staff.pre_map')::jsonb) e
    where e.key <> all(array['deprel:admin_visit_request_events','rel:admin_visit_request_events']::text[]) and v_cur->>e.key is distinct from e.value and e.key <> all(array[]::text[]);
  if v_bad is not null then raise exception 'staff guard [適用後] 変更対象外の既存オブジェクト(依存先を含む)が変化した: %', v_bad using errcode = 'P0001'; end if;
end $guard$;
commit;
