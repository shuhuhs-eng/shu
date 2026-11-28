-- ============================================================================
-- 0113 本番適用【前】チェック（読み取り専用。何も変更しない）  ※Supabase SQL Editor に貼り付けて1回実行
-- 目的: ① 本番の既存DBが 0113 の前提（0109）と整合している ② 0113 の対象がまだ無い ③ 課金設定の「適用前の基準値」を控える
-- 使い方: 結果は1つの表で出ます。最後の行 VERDICT が「適用可」で、NG の行が無いことを確認 →
--         「基準値」の行（90〜95）を控える。
--         適用後チェック（0113_3_postapply_check_READONLY.sql）の冒頭へ、その値を貼る。
-- 注意: このSQLは select のみ（insert/update/delete/DDL/set_config なし）。billing_settings の中身は「値と状態」を表示します（秘密情報ではありません）。
-- 判定: 情報行（32,33,42,43,90〜95）以外は、結果が true でなければすべて NG（必須項目の未設定・NULL・行なしも NG。null を合格や情報に流さない）。「未確認」を合格として数えない。
-- ============================================================================
with
fx as (   -- 依存する既存関数の指紋（0109 キットの照合式と同じ要素: 本体・引数・戻り・属性・所有者・権限・設定）
  select t.sig, p.oid is not null as present,
         case when p.oid is null then null else md5(
           p.prosrc||'|'||pg_get_function_arguments(p.oid)||'|'||pg_get_function_result(p.oid)||'|'||p.prosecdef::text||'|'||p.provolatile::text
           ||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'')||'|'||coalesce(p.proconfig::text,'')) end as fp
  from (values ('public.admin_billing_setting_set(text,text,text)'),('public._billing_responsible_guard()'),('public._billing_setting(text)'),
               ('public.admin_billing_settings_list()'),('public.is_platform_admin()')) t(sig)
  left join pg_proc p on p.oid = to_regprocedure(t.sig)
),
bs as (   -- billing_settings の表の形（列・制約・RLS・権限）
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
chk(ord, name, ok, detail) as (
  select 10, '依存: 0109 の関数（'||sig||'）', present, case when present then 'あり' else '無い → 0109 未適用の可能性。適用しない' end from fx
  union all
  select 20, '依存: billing_settings の表', coalesce((select count(*) from bs)=1,false), case when exists(select 1 from bs) then 'あり' else '無い → 0109 未適用の可能性。適用しない' end
  union all
  select 21, '依存: billing_settings の列が想定どおり（key,value,status,note,updated_by,updated_at を含む）',
         coalesce((select cols like '%key:text%' and cols like '%value:text%' and cols like '%status:text%' and cols like '%note:text%' and cols like '%updated_by:uuid%' and cols like '%updated_at:timestamp with time zone%' from bs),false),
         (select cols from bs)
  union all
  select 22, '依存: billing_settings は RLS 有効・anon/authenticated/service_role に権限なし（0109の設計どおり）',
         coalesce((select rls from bs),false) and not has_table_privilege('anon','public.billing_settings','select,insert,update,delete')
           and not has_table_privilege('authenticated','public.billing_settings','select,insert,update,delete')
           and not has_table_privilege('service_role','public.billing_settings','select,insert,update,delete'),
         (select 'rls='||rls::text||' owner='||owner||' acl='||acl from bs)
  union all
  select 30, '0113 の対象がまだ無い: 関数 '||s, to_regprocedure(s) is null, case when to_regprocedure(s) is null then '無い（適用前として正常）' else 'すでにある → 適用済みの可能性。適用しない' end
  from (values ('public.admin_billing_hire_role_rule_decide()'),('public.admin_billing_setting_changes_list(integer)'),('public._billing_setting_log_change()')) v(s)
  union all
  select 31, '0113 の対象がまだ無い: トリガー trg_billing_settings_log_change', not exists(select 1 from pg_trigger where tgname='trg_billing_settings_log_change' and not tgisinternal), '無ければ正常'
  union all
  select 32, '履歴の表 billing_setting_changes', null, case when to_regclass('public.billing_setting_changes') is null then '無い（初回適用。正常）' else 'ある（巻き戻し後の再適用の形。適用SQLが列を検査する。心当たりが無ければ適用しない）' end
  union all
  select 33, 'billing_settings 上の既存トリガー数（0113 のトリガー以外）', null, (select count(*)::text from pg_trigger where tgrelid=to_regclass('public.billing_settings') and not tgisinternal)
  union all
  select 40, '課金設定（必須）: auto_charge_enabled が 設定あり・値が NULL でなく・false（未設定・NULLは適用不可）',
         coalesce((select value is not null and value='false' from st where key='auto_charge_enabled'), false),
         coalesce((select coalesce(value,'(値NULL)')||' / '||coalesce(status,'(状態NULL)') from st where key='auto_charge_enabled'),'設定行なし → 適用しない')
  union all
  select 41, '課金設定（必須）: salon_card_required が 設定あり・値が NULL でなく・false（未設定・NULLは適用不可）',
         coalesce((select value is not null and value='false' from st where key='salon_card_required'), false),
         coalesce((select coalesce(value,'(値NULL)')||' / '||coalesce(status,'(状態NULL)') from st where key='salon_card_required'),'設定行なし → 適用しない')
  union all
  select 44, '課金設定（必須）: 採用料(stylist/assistant)・税率・自動請求の方針設定が 設定あり・値NULLでない（無い・NULLは適用不可）',
         (select count(*) from st where key in ('hire_fee_stylist_excl_tax','hire_fee_assistant_excl_tax','tax_percent','auto_charge_retry_policy','auto_charge_retry_interval_days','auto_charge_retry_extra_attempts','auto_charge_card_missing_policy') and value is not null and status is not null)=7,
         coalesce((select string_agg(k,' , ') from unnest(array['hire_fee_stylist_excl_tax','hire_fee_assistant_excl_tax','tax_percent','auto_charge_retry_policy','auto_charge_retry_interval_days','auto_charge_retry_extra_attempts','auto_charge_card_missing_policy']) k where not exists(select 1 from st where st.key=k and st.value is not null and st.status is not null)),'7件とも揃っている')
  union all
  select 45, '課金設定（必須）: hire_fee_role_source の行がある（値は未決定で NULL でも可。行が無いと決定操作が失敗する）',
         exists(select 1 from st where key='hire_fee_role_source'), coalesce((select coalesce(value,'(値NULL)')||' / '||status from st where key='hire_fee_role_source'),'設定行なし')
  union all
  select 42, '参考: hire_fee_role_source（0113 適用では変わらない。決定は別操作）', null, coalesce((select coalesce(value,'(値なし)')||' / '||status from st where key='hire_fee_role_source'),'設定なし')
  union all
  select 43, '参考: 採用料（stylist/assistant）・税率', null, coalesce((select string_agg(key||'='||coalesce(value,'∅'),' , ' order by key) from st where key in ('hire_fee_stylist_excl_tax','hire_fee_assistant_excl_tax','tax_percent')),'設定なし')
  union all
  select 50, '準備: 長時間のトランザクションが無い（ロック待ちの原因）', not exists(select 1 from pg_stat_activity where state like 'idle in transaction%' and xact_start < now() - interval '1 minute' and pid<>pg_backend_pid()),
         (select count(*)::text||' 件の 1分超 idle in transaction' from pg_stat_activity where state like 'idle in transaction%' and xact_start < now() - interval '1 minute' and pid<>pg_backend_pid())
  union all
  select 90, '【基準値】settings_digest_core（key=value|status の全行 md5）', null, (select core from dg)
  union all
  select 91, '【基準値】settings_digest_full（note・updated_by・updated_at まで含む md5）', null, (select full_ from dg)
  union all
  select 92, '【基準値】deps_digest（依存関数5つ＋billing_settings の表の形 md5）', null, (select deps from dg)
  union all
  select 93, '【基準値】billing_settings 行数', null, (select n::text from dg)
  union all
  select 94, '【基準値】settings_digest_core_excl_role_source（hire_fee_role_source の行を除く。決定の後も一致するはずの値）', null, (select core_x from dg)
  union all
  select 95, '【基準値】settings_digest_full_excl_role_source（同上・note/updated_at まで）', null, (select full_x from dg)
)
select ord, name, case when ok is true then 'OK' when ok is false or ord not in (32,33,42,43,90,91,92,93,94,95) then 'NG' else '情報' end as result, detail from chk
union all
select 999, 'VERDICT', case when (select count(*) from chk where ok is not true and ord not in (32,33,42,43,90,91,92,93,94,95))=0 then '適用可' else '適用不可' end,
       (select count(*) from chk where ok is not true and ord not in (32,33,42,43,90,91,92,93,94,95))::text||' 件のNG。「適用可」でも、基準値（90〜95）を控えてから適用する'
order by 1, 2;
