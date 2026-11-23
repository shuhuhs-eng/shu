-- 読み取り専用: 認証側の実定義・ロール属性・セッション表の完全な形(第7回追加)。何も変更しない。
-- 出力列: kind, object, item, detail (query-37 の追加37項目と同じ形式)
with fn as (
  select p.oid, 'auth.' || p.proname || '()' as obj from pg_proc p where p.pronamespace = 'auth'::regnamespace and p.proname in ('jwt','uid','role') and p.pronargs = 0
), a as (
  select 'auth' as kind, obj as object, 'full_definition' as item, pg_get_functiondef(oid) as detail from fn
  union all
  select 'auth', obj, 'owner_language_settings_acl', jsonb_build_object('owner', pg_get_userbyid(p.proowner), 'language', l.lanname, 'settings', p.proconfig, 'security_definer', p.prosecdef,
      'acl', coalesce((select jsonb_agg(jsonb_build_object('grantee', case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end, 'grantor', pg_get_userbyid(x.grantor), 'privilege', x.privilege_type, 'grant_option', x.is_grantable)) from aclexplode(p.proacl) x), '[]'::jsonb))::text
    from fn join pg_proc p on p.oid = fn.oid join pg_language l on l.oid = p.prolang
  union all
  select 'auth', 'auth.sessions', 'column_full:' || lpad(att.attnum::text, 3, '0') || ':' || att.attname,
    jsonb_build_object('type', format_type(att.atttypid, att.atttypmod), 'default', pg_get_expr(d.adbin, d.adrelid), 'identity', att.attidentity::text, 'not_null', att.attnotnull, 'generated', att.attgenerated::text)::text
    from pg_attribute att left join pg_attrdef d on d.adrelid = att.attrelid and d.adnum = att.attnum
    where att.attrelid = 'auth.sessions'::regclass and att.attnum > 0 and not att.attisdropped
  union all
  select 'auth', 'auth.sessions', 'constraint_full:' || conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'auth.sessions'::regclass
  union all
  select 'auth', 'auth.sessions', 'index_full:' || (select relname from pg_class where oid = indexrelid), pg_get_indexdef(indexrelid) from pg_index where indrelid = 'auth.sessions'::regclass
  union all
  select 'auth', 'auth.sessions', 'owner_rls_acl', jsonb_build_object('rls', c.relrowsecurity, 'owner', pg_get_userbyid(c.relowner), 'force_rls', c.relforcerowsecurity,
      'acl', coalesce((select jsonb_agg(jsonb_build_object('grantee', case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end, 'grantor', pg_get_userbyid(x.grantor), 'privilege', x.privilege_type, 'grant_option', x.is_grantable)) from aclexplode(c.relacl) x), '[]'::jsonb))::text
    from pg_class c where c.oid = 'auth.sessions'::regclass
  union all
  select 'role', r.rolname, 'attributes', jsonb_build_object('login', r.rolcanlogin, 'inherit', r.rolinherit, 'create_db', r.rolcreatedb, 'superuser', r.rolsuper, 'bypass_rls', r.rolbypassrls, 'create_role', r.rolcreaterole, 'replication', r.rolreplication)::text
    from pg_roles r where r.rolname in ('anon','authenticated','postgres','service_role','supabase_admin')
  union all
  select 'check', 'public._cancel_interest_notifications(uuid,uuid,uuid,text)', 'exists', (to_regprocedure('public._cancel_interest_notifications(uuid,uuid,uuid,text)') is not null)::text
)
select kind, object, item, detail from a order by kind, object, item;
