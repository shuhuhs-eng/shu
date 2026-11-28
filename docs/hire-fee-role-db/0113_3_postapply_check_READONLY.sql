-- ============================================================================
-- 0113 本番適用【後】チェック（読み取り専用。何も変更しない）  ※Supabase SQL Editor に貼り付けて1回実行
-- 事前に: 下の 6か所の '<...>' を、適用前チェック（0113_1）で控えた基準値に置き換える（置き換えていない項目は「未入力＝未確認」でNG扱い）。
--   適用前チェックの 90〜95 の6つ（settings_digest_core / full / deps_digest / 行数 / core_excl_role_source / full_excl_role_source）
-- 「登録区分ルールの決定」を実行した後は hire_fee_role_source の1行だけが正当に変わる。その場合も、
--   行44・45（その行を除く全設定が適用前と同一）と、履歴が決定の1行だけ（60・62）であることで「他は変わっていない」を確認できる。
--   41・42 は、履歴がちょうど決定の1行で hire_fee_role_source が決定済みなら、決定による変化として許容する。
-- 判定: ok = true が合格 / false は NG / null は情報。「未確認」を合格として数えない。
-- ============================================================================
with
ph as (select
  '<settings_digest_core>'::text as core,
  '<settings_digest_full>'::text as full_,
  '<deps_digest>'::text as deps,
  '<billing_settings行数>'::text as n,
  '<settings_digest_core_excl_role_source>'::text as core_x,
  '<settings_digest_full_excl_role_source>'::text as full_x),
fx as (
  select t.sig, case when p.oid is null then null else md5(
           p.prosrc||'|'||pg_get_function_arguments(p.oid)||'|'||pg_get_function_result(p.oid)||'|'||p.prosecdef::text||'|'||p.provolatile::text
           ||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'')||'|'||coalesce(p.proconfig::text,'')) end as fp
  from (values ('public.admin_billing_setting_set(text,text,text)'),('public._billing_responsible_guard()'),('public._billing_setting(text)'),
               ('public.admin_billing_settings_list()'),('public.is_platform_admin()')) t(sig)
  left join pg_proc p on p.oid = to_regprocedure(t.sig)
),
bs as (
  select c.oid, c.relkind, pg_get_userbyid(c.relowner) as owner, c.relrowsecurity as rls, coalesce(c.relacl::text,'') as acl,
         (select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text,',' order by a.attnum)
            from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as cols,
         coalesce((select string_agg(pg_get_constraintdef(k.oid),',' order by k.conname) from pg_constraint k where k.conrelid=c.oid),'') as cons
  from pg_class c where c.oid = to_regclass('public.billing_settings')
),
st as (   -- 設定の中身（表が無くても失敗せず「設定なし」になる）
  select x.key, x.value, x.status, x.note, x.updated_by, x.updated_at
  from jsonb_to_recordset(case when to_regclass('public.billing_settings') is null then '[]'::jsonb else
         (xpath('/row/j/text()', query_to_xml('select coalesce(jsonb_agg(to_jsonb(b)), ''[]''::jsonb)::text as j from public.billing_settings b', false, true, '')))[1]::text::jsonb end)
       as x(key text, value text, status text, note text, updated_by uuid, updated_at timestamptz)
),
dg as (
  select
    md5(coalesce((select string_agg(key||'='||coalesce(value,'∅')||'|'||coalesce(status,'∅'), ';' order by key) from st where true),'')) as core,
    md5(coalesce((select string_agg(key||'='||coalesce(value,'∅')||'|'||coalesce(status,'∅')||'|'||coalesce(note,'∅')||'|'||coalesce(updated_by::text,'∅')||'|'||coalesce(updated_at::text,'∅'), ';' order by key) from st where true),'')) as full_,
    (select count(*) from st where true) as n,
    md5(coalesce((select string_agg(key||'='||coalesce(value,'∅')||'|'||coalesce(status,'∅'), ';' order by key) from st where key<>'hire_fee_role_source'),'')) as core_x,
    md5(coalesce((select string_agg(key||'='||coalesce(value,'∅')||'|'||coalesce(status,'∅')||'|'||coalesce(note,'∅')||'|'||coalesce(updated_by::text,'∅')||'|'||coalesce(updated_at::text,'∅'), ';' order by key) from st where key<>'hire_fee_role_source'),'')) as full_x,
    md5(coalesce((select string_agg(sig||'='||coalesce(fp,'∅'),';' order by sig) from fx),'')
        ||'#'||coalesce((select owner||'|'||relkind::text||'|'||rls::text||'|'||acl||'|'||cols||'|'||cons from bs),'∅')) as deps
),
hx as (   -- 履歴の表が無くても失敗しないよう、表があるときだけ読む
  select case when to_regclass('public.billing_setting_changes') is null then null else
    (xpath('/row/c/text()', query_to_xml('select count(*)::text as c from public.billing_setting_changes', false, true, '')))[1]::text::int end as n_all,
  case when to_regclass('public.billing_setting_changes') is null then null else
    (xpath('/row/c/text()', query_to_xml('select count(*)::text as c from public.billing_setting_changes where setting_key in (''auto_charge_enabled'',''salon_card_required'')', false, true, '')))[1]::text::int end as n_auto,
  case when to_regclass('public.billing_setting_changes') is null then null else
    (xpath('/row/c/text()', query_to_xml('select coalesce(string_agg(setting_key||'':''||coalesce(old_status,''-'')||''→''||new_status, '' , '' order by id),''(履歴なし)'')::text as c from public.billing_setting_changes where setting_key<>''hire_fee_role_source''', false, true, '')))[1]::text end as others
),
fn(sig, need_authenticated) as (values
  ('public.admin_billing_hire_role_rule_decide()', true), ('public.admin_billing_setting_changes_list(integer)', true),
  ('public._billing_setting_log_change()', false), ('public._billing_setting_changes_immutable()', false)),
chk(ord, name, ok, detail) as (
  select 10, '新規: 関数 '||sig||'（SECURITY DEFINER・search_path 固定）',
         to_regprocedure(sig) is not null and (select prosecdef and coalesce(proconfig::text,'') like '%search_path=public, pg_temp%' from pg_proc where oid=to_regprocedure(sig)),
         case when to_regprocedure(sig) is null then '無い → 適用されていない' else 'あり' end from fn
  union all
  select 11, '新規: 権限 '||sig||'（authenticated='||need_authenticated::text||'・anon/service_role/public は不可）',
         to_regprocedure(sig) is not null
         and has_function_privilege('authenticated', to_regprocedure(sig), 'execute') = need_authenticated
         and not has_function_privilege('anon', to_regprocedure(sig), 'execute')
         and not has_function_privilege('service_role', to_regprocedure(sig), 'execute')
         and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid=to_regprocedure(sig) and a.grantee=0),
         (select coalesce(proacl::text,'(既定)') from pg_proc where oid=to_regprocedure(sig)) from fn
  union all
  select 12, '新規: 決定関数が 実行前・実行後 の両方で自動請求/カード必須 false を要求する',
         (select prosrc like '%must be off before this decision%' and prosrc like '%must be off after this decision%' from pg_proc where oid=to_regprocedure('public.admin_billing_hire_role_rule_decide()')),
         '関数本体に前後の検査文言があること'
  union all
  select 13, '新規: 決定関数は固定の1設定（hire_fee_role_source）だけを決定し、auto_charge_enabled / salon_card_required を設定する文を持たない',
         (select prosrc like '%''hire_fee_role_source''%' and prosrc !~ 'admin_billing_setting_set\(\s*''(auto_charge_enabled|salon_card_required)''' from pg_proc where oid=to_regprocedure('public.admin_billing_hire_role_rule_decide()')),
         '設定を書く呼び出しは hire_fee_role_source のみ'
  union all
  select 20, '新規: 履歴の表 billing_setting_changes（RLS有効・anon/authenticated/service_role に権限なし）',
         to_regclass('public.billing_setting_changes') is not null
         and (select relrowsecurity from pg_class where oid=to_regclass('public.billing_setting_changes'))
         and not has_table_privilege('anon','public.billing_setting_changes','select,insert,update,delete')
         and not has_table_privilege('authenticated','public.billing_setting_changes','select,insert,update,delete')
         and not has_table_privilege('service_role','public.billing_setting_changes','select,insert,update,delete'),
         coalesce((select coalesce(relacl::text,'(既定)') from pg_class where oid=to_regclass('public.billing_setting_changes')),'表が無い')
  union all
  select 21, '新規: 履歴の追記専用トリガー（更新・削除を拒否）', exists(select 1 from pg_trigger where tgrelid=to_regclass('public.billing_setting_changes') and tgname='trg_billing_setting_changes_immutable' and not tgisinternal and tgenabled='O'), '有効（enabled=O）であること'
  union all
  select 22, '新規: 変更履歴トリガー trg_billing_settings_log_change が billing_settings にあり有効', exists(select 1 from pg_trigger where tgrelid=to_regclass('public.billing_settings') and tgname='trg_billing_settings_log_change' and not tgisinternal and tgenabled='O'), 'AFTER UPDATE・有効'
  union all
  select 23, 'billing_settings 上のトリガーは 0113 の1つだけ（他に増えていない）', (select count(*) from pg_trigger where tgrelid=to_regclass('public.billing_settings') and not tgisinternal)=1, (select count(*)::text from pg_trigger where tgrelid=to_regclass('public.billing_settings') and not tgisinternal)
  union all
  select 30, '課金設定（必須）: auto_charge_enabled が 設定あり・値が NULL でなく・false', coalesce((select value is not null and value='false' from st where key='auto_charge_enabled'), false),
         coalesce((select coalesce(value,'(値NULL)')||' / '||coalesce(status,'(状態NULL)') from st where key='auto_charge_enabled'),'設定行なし')
  union all
  select 31, '課金設定（必須）: salon_card_required が 設定あり・値が NULL でなく・false', coalesce((select value is not null and value='false' from st where key='salon_card_required'), false),
         coalesce((select coalesce(value,'(値NULL)')||' / '||coalesce(status,'(状態NULL)') from st where key='salon_card_required'),'設定行なし')
  union all
  select 40, '既存への影響なし: 依存関数5つ＋billing_settings の表の形が適用前と同一（deps_digest）',
         case when (select deps from ph) like '<%' then null else (select deps from dg)=(select deps from ph) end,
         case when (select deps from ph) like '<%' then '未入力＝未確認（適用前の値を貼る）' else '現在 '||(select deps from dg) end
  union all
  select 41, '課金設定に変更なし: settings_digest_core（key=value|status 全行）が適用前と同一',
         case when (select core from ph) like '<%' then null else (select core from dg)=(select core from ph) or (select n_all=1 and others like '(履歴なし)' and (select value||'/'||status from st where key='hire_fee_role_source')='operator_confirmed_registration_class/decided' from hx) end,
         case when (select core from ph) like '<%' then '未入力＝未確認（適用前の値を貼る）' else '現在 '||(select core from dg) end
  union all
  select 42, '課金設定に変更なし: settings_digest_full（note・updated_at まで）が適用前と同一',
         case when (select full_ from ph) like '<%' then null else (select full_ from dg)=(select full_ from ph) or (select n_all=1 and others like '(履歴なし)' and (select value||'/'||status from st where key='hire_fee_role_source')='operator_confirmed_registration_class/decided' from hx) end,
         case when (select full_ from ph) like '<%' then '未入力＝未確認（適用前の値を貼る）' else '現在 '||(select full_ from dg) end
  union all
  select 43, '課金設定に変更なし: billing_settings の行数が適用前と同一',
         case when (select n from ph) like '<%' then null else (select n from dg)::text=(select n from ph) end,
         case when (select n from ph) like '<%' then '未入力＝未確認' else '現在 '||(select n from dg)::text end
  union all
  select 44, '課金設定に変更なし（hire_fee_role_source の行を除く全行）: core が適用前と同一。決定の実行後もここは一致する',
         case when (select core_x from ph) like '<%' then null else (select core_x from dg)=(select core_x from ph) end,
         case when (select core_x from ph) like '<%' then '未入力＝未確認（適用前の94の値）' else '現在 '||(select core_x from dg) end
  union all
  select 45, '課金設定に変更なし（hire_fee_role_source の行を除く全行）: full（note・updated_at まで）が適用前と同一',
         case when (select full_x from ph) like '<%' then null else (select full_x from dg)=(select full_x from ph) end,
         case when (select full_x from ph) like '<%' then '未入力＝未確認（適用前の95の値）' else '現在 '||(select full_x from dg) end
  union all
  select 60, '履歴の行数（適用直後は 0。決定を実行した後は 1）', null, coalesce((select n_all::text from hx),'表が無い')
  union all
  select 61, '履歴に auto_charge_enabled / salon_card_required の変更が無い', (select n_auto=0 from hx), coalesce((select n_auto::text||' 件' from hx),'表が無い')
  union all
  select 62, '履歴は hire_fee_role_source の決定以外に無い', (select others like '(履歴なし)' from hx), coalesce((select others from hx),'表が無い')
  union all
  select 70, '参考: hire_fee_role_source の現在値（決定前は 値なし / undecided）', null, coalesce((select coalesce(value,'(値なし)')||' / '||status from st where key='hire_fee_role_source'),'設定なし')
)
select ord, name, case when ok is true then 'OK' when ok is false then 'NG' else '未確認/情報' end as result, detail from chk
union all
select 999, 'VERDICT',
  case when (select count(*) from chk where ok is false)>0 then '不合格'
       when (select count(*) from chk where ord between 40 and 45 and ok is null)>0 then '未確認あり（基準値を貼って再実行）'
       else '合格' end,
  (select count(*) from chk where ok is false)::text||' 件のNG / 基準値未入力 '||(select count(*) from chk where ord between 40 and 45 and ok is null)::text||' 件'
order by 1, 2;
