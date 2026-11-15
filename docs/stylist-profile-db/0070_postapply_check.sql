-- 0070 適用後チェック（SELECT1文・読み取り専用）。結果表は1つ。level = PASS / FAIL / INFO、最終行が総合判定。
--  PASS/FAIL: SQLだけで正誤が決まる項目。INFO: 値を「適用前チェック」と人が比較する項目（成功扱いにしない）。
with r(ord, level, item, detail) as (values
 (1,  case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='stylist_private' and column_name='birth_date') then 'PASS' else 'FAIL' end, 'birth_date列が存在する', ''),
 (2,  'INFO', '生年月日の登録件数（適用直後は0のはず）', coalesce((select count(*)::text from public.stylist_private s where to_jsonb(s)->>'birth_date' is not null), '0')),
 (3,  case when (select count(*) from public.user_settings us where us.scout_enabled=false and exists (select 1 from public.user_roles ur where ur.user_id=us.user_id and ur.role='stylist'))=0 then 'PASS' else 'FAIL' end, '美容師ロールで scout_enabled=false が残っていない', ''),
 (4,  case when to_regclass('public.scout_optout_migration_0070') is not null and ((xpath('/row/c/text()', query_to_xml('select count(*) as c from public.scout_optout_migration_0070 m join public.user_settings us on us.user_id=m.user_id where us.scout_enabled is distinct from true', false, true, '')))[1]::text)::int = 0 then 'PASS' else 'FAIL' end, '退避表の全員が scout_enabled=true', ''),
 (5,  'INFO', '退避表の件数 → 適用前チェック 行4 と一致すること', case when to_regclass('public.scout_optout_migration_0070') is null then '退避表なし' else ((xpath('/row/c/text()', query_to_xml('select count(*) as c from public.scout_optout_migration_0070', false, true, '')))[1]::text) end),
 (6,  'INFO', '美容師ロールなしの scout_enabled=false（変更しない）→ 適用前チェック 行7 と一致', (select count(*)::text from public.user_settings us where us.scout_enabled=false and not exists (select 1 from public.user_roles ur where ur.user_id=us.user_id and ur.role='stylist'))),
 (7,  'INFO', 'visibility内訳 → 適用前チェック 行8〜10 と一致', (select coalesce(string_agg(visibility::text||'='||c, ' ' order by visibility::text),'(なし)') from (select visibility, count(*)::text c from public.stylist_profiles group by 1) q)),
 (8,  'INFO', '給与提示の既存件数 → 適用前チェック 行12 と一致', (select count(*)::text from public.salary_offers)),
 (9,  'INFO', 'save_stylist_profile 定義md5 → 適用前チェック 行14 と一致', (select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.oid)) from pg_proc p where p.proname='save_stylist_profile' and p.pronamespace='public'::regnamespace)),
 (10, case when to_regclass('public.feature_pauses') is not null and coalesce(((xpath('/row/c/text()', query_to_xml('select paused::int as c from public.feature_pauses where feature=''salary_offer_presentation''', false, true, '')))[1]::text)::int,0)=1 then 'PASS' else 'FAIL' end, '給与提示の停止フラグが「停止」', ''),
 (11, case when exists (select 1 from pg_trigger where tgrelid='public.salary_offers'::regclass and tgname='trg_salary_offers_00_pause' and tgenabled='O' and tgtype & 4 = 4 and tgtype & 2 = 2) then 'PASS' else 'FAIL' end, '給与提示の停止トリガーが有効（BEFORE INSERT）', ''),
 (12, case when (select pg_get_functiondef(p.oid) like '%avatar_path%' and pg_get_functiondef(p.oid) like '%_stylist_age_info%' and pg_get_functiondef(p.oid) like '%instagram_handle%' and pg_get_functiondef(p.oid) like '%value_priorities%' and pg_get_functiondef(p.oid) like '%employment_type%' from pg_proc p where p.proname='get_public_stylists_for_scout' and p.pronamespace='public'::regnamespace) then 'PASS' else 'FAIL' end, '一覧関数に 画像・年齢・Instagram・大切にしたいこと・雇用形態 が追加されている', ''),
 (13, case when (select pg_get_functiondef(p.oid) !~ $q$'(full_name|age_band|gender|birth_date|desired_salary_range|sns_links|email)'$q$ from pg_proc p where p.proname='get_public_stylists_for_scout' and p.pronamespace='public'::regnamespace) then 'PASS' else 'FAIL' end, '一覧関数の返却キーに 氏名・性別・年代・生年月日・年収・SNS生データ が無い', ''),
 (14, case when (select pg_get_functiondef(p.oid) ~ $q$visibility = 'PUBLIC'$q$ from pg_proc p where p.proname='get_public_stylists_for_scout' and p.pronamespace='public'::regnamespace) then 'PASS' else 'FAIL' end, '一覧関数が PUBLIC のみを対象にしている', ''),
 (15, case when exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='avatars_select_public_stylist_for_salon') then 'PASS' else 'FAIL' end, '画像の閲覧ポリシーが存在する', ''),
 (16, case when coalesce((select bool_and(coalesce(g.grants, '{}'::text[]) = e.expected::text[] and to_regprocedure(e.sig) is not null) from (values
 ('public.set_stylist_birth_date(date)','{authenticated}'),
 ('public.get_public_stylists_for_scout(uuid)','{authenticated}'),
 ('public.set_stylist_age_display_mode(text)','{authenticated}'),
 ('public.save_stylist_profile_v2(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text)','{authenticated}'),
 ('public.request_stylist_age_disclosure(uuid,uuid)','{authenticated}'),
 ('public.respond_age_disclosure_request(uuid,boolean)','{authenticated}'),
 ('public.get_my_age_disclosure_requests()','{authenticated}'),
 ('public.get_store_stylist_age_infos(uuid,uuid[])','{authenticated}'),
 ('public._stylist_age_info(uuid,uuid)','{}'),
 ('public._trg_stylist_private_birth_guard()','{}'),
 ('public._trg_stylist_profiles_birth_required()','{}'),
 ('public._trg_scouts_publishable_guard()','{}'),
 ('public.salon_can_view_stylist_avatar(text)','{authenticated}'),
 ('public.get_stylist_public_extended_enabled()','{authenticated}'),
 ('public.stylist_public_extended_enabled()','{}'),
 ('public.stylist_age_years(date)','{}'),
 ('public.stylist_salon_publishable(uuid)','{}'),
 ('public.block_salary_offer_insert_when_paused()','{}')
) as e(sig, expected)
 left join lateral (select array_agg(x.gr order by x.gr) as grants from (select distinct case when a.grantee = 0 then 'PUBLIC' else r.rolname::text end as gr
   from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a left join pg_roles r on r.oid = a.grantee
   where p.oid = to_regprocedure(e.sig) and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or r.rolname in ('anon','authenticated','service_role'))) x) g on true), false) then 'PASS' else 'FAIL' end, '新設関数の実行権限（anon・service_role・PUBLICからは全て外れ、必要な関数だけ authenticated。内部関数は誰にも付かない）', ''),
 (17, case when to_regclass('public.feature_pauses') is not null and to_regclass('public.scout_optout_migration_0070') is not null and not has_table_privilege('authenticated',to_regclass('public.feature_pauses'),'select') and not has_table_privilege('service_role',to_regclass('public.feature_pauses'),'select') and not has_table_privilege('authenticated',to_regclass('public.scout_optout_migration_0070'),'select') and not has_table_privilege('service_role',to_regclass('public.scout_optout_migration_0070'),'select') and not has_table_privilege('authenticated','public.stylist_private','update') and not has_table_privilege('authenticated','public.stylist_private','insert') then 'PASS' else 'FAIL' end, '表の権限（停止フラグ・退避表は誰も読めない／stylist_privateは直接書けない）', ''),
 (18, case when to_regclass('public.feature_pauses') is not null and coalesce(((xpath('/row/c/text()', query_to_xml('select (not paused)::int as c from public.feature_pauses where feature=''stylist_public_extended''', false, true, '')))[1]::text)::int,0)=1 then 'PASS' else 'FAIL' end, '公開プロフィールの追加表示フラグが「有効」', ''),
 (19, case when to_regclass('public.feature_pauses') is not null and coalesce(((xpath('/row/c/text()', query_to_xml('select paused::int as c from public.feature_pauses where feature=''minor_salon_public''', false, true, '')))[1])::text, '0') = '1' then 'PASS' else 'FAIL' end, '未成年のサロン公開フラグ minor_salon_public が「保留」（paused=true）で存在する（行が無い・解除されている場合はFAIL）', ''),
 (20, case when (select pg_get_functiondef(p.oid) like '%stylist_salon_publishable%' from pg_proc p where p.proname='get_public_stylists_for_scout' and p.pronamespace='public'::regnamespace) and (select pg_get_functiondef(p.oid) like '%stylist_salon_publishable%' from pg_proc p where p.proname='salon_can_view_stylist_avatar' and p.pronamespace='public'::regnamespace) then 'PASS' else 'FAIL' end, '一覧関数と画像の閲覧権限の両方が、公開判定 stylist_salon_publishable を参照している', ''),
 (21, 'INFO', '生年月日が未登録の既存会員（登録と表示方法の選択が済むまで、サロン向け一覧・画像・スカウト送信先から保留）', (select count(*)::text from public.stylist_profiles sp where not exists (select 1 from public.stylist_private s where s.user_id=sp.user_id and to_jsonb(s)->>'birth_date' is not null))),
 (22, 'INFO', '生年月日は登録済みだが表示方法が未選択の会員（選択まで保留）', (select count(*)::text from public.stylist_private s where to_jsonb(s)->>'birth_date' is not null and to_jsonb(s)->>'age_display_mode' is null)),
 (23, case when exists (select 1 from pg_trigger where tgname='trg_stylist_profiles_birth_required' and tgrelid='public.stylist_profiles'::regclass and tgenabled='O')
       and exists (select 1 from pg_trigger where tgname='trg_stylist_private_birth_guard' and tgrelid='public.stylist_private'::regclass and tgenabled='O')
       and exists (select 1 from pg_trigger where tgname='trg_scouts_publishable_guard' and tgrelid='public.scouts'::regclass and tgenabled='O') then 'PASS' else 'FAIL' end, '必須登録・NULL戻し禁止・スカウト送信先のトリガーが有効', ''),
 (24, case when to_regclass('public.age_disclosure_requests') is not null
       and coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.age_disclosure_requests')),false)
       and not has_table_privilege('authenticated',to_regclass('public.age_disclosure_requests'),'select') and not has_table_privilege('authenticated',to_regclass('public.age_disclosure_requests'),'insert') and not has_table_privilege('authenticated',to_regclass('public.age_disclosure_requests'),'update')
       and not has_table_privilege('anon',to_regclass('public.age_disclosure_requests'),'select') and not has_table_privilege('service_role',to_regclass('public.age_disclosure_requests'),'select') then 'PASS' else 'FAIL' end, '開示依頼の表はRLS有効・直接の読み書き権限なし（RPCのみ）', ''),
 (25, case when (select pg_get_constraintdef(oid) like '%age_disclosure_requested%' and pg_get_constraintdef(oid) like '%age_disclosure_approved%' and pg_get_constraintdef(oid) like '%hiring_declined_by_stylist%' and pg_get_constraintdef(oid) like '%scout_received%' from pg_constraint where conname='notifications_type_check') then 'PASS' else 'FAIL' end, '通知の種類に開示依頼の2種が追加され、既存の種類が残っている', ''),
 (26, case when (select pg_get_functiondef(oid) like '%age_display_mode%' and pg_get_functiondef(oid) like '%birth_date%' from pg_proc where oid=to_regprocedure('public.stylist_salon_publishable(uuid)')) then 'PASS' else 'FAIL' end, '公開判定が 生年月日・表示方法・満年齢 で行われる', '')
)
select ord, level, item, detail from (
select ord::text as ord, level, item, detail from r
union all
select '99', case when (select count(*) from r where level='FAIL') = 0 then 'PASS' else 'FAIL' end,
       '総合判定（INFO '||(select count(*) from r where level='INFO')||'件は適用前チェックと人が比較）',
       'FAIL '||(select count(*) from r where level='FAIL')||'件 / PASS '||(select count(*) from r where level='PASS')||'件'
) t order by ord::int;
