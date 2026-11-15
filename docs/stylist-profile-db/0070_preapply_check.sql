-- 0070 適用前チェック（SELECT1文のみ・読み取り専用・結果表が1つだけ出る）。
select ord, item, value from (values
 (1,'stylist_private.birth_date が未存在(=未適用)', (not exists (select 1 from information_schema.columns where table_schema='public' and table_name='stylist_private' and column_name='birth_date'))::text),
 (2,'feature_pauses が未存在', (to_regclass('public.feature_pauses') is null)::text),
 (3,'scout_optout_migration_0070 が未存在', (to_regclass('public.scout_optout_migration_0070') is null)::text),
 (4,'【対象件数】scout_enabled=false の美容師ロール', (select count(*)::text from public.user_settings us where us.scout_enabled=false and exists (select 1 from public.user_roles ur where ur.user_id=us.user_id and ur.role='stylist'))),
 (5,'  うち 美容師＋サロンの両ロール', (select count(*)::text from public.user_settings us where us.scout_enabled=false and exists (select 1 from public.user_roles ur where ur.user_id=us.user_id and ur.role='stylist') and exists (select 1 from public.user_roles ur where ur.user_id=us.user_id and ur.role='salon'))),
 (6,'scout_enabled=false の全体（美容師以外は変更しない）', (select count(*)::text from public.user_settings where scout_enabled=false)),
 (7,'  うち 美容師ロールなし（変更対象外）', (select count(*)::text from public.user_settings us where us.scout_enabled=false and not exists (select 1 from public.user_roles ur where ur.user_id=us.user_id and ur.role='stylist'))),
 (8,'visibility 内訳 PUBLIC', (select count(*)::text from public.stylist_profiles where visibility='PUBLIC')),
 (9,'visibility 内訳 LIMITED（変更しない）', (select count(*)::text from public.stylist_profiles where visibility='LIMITED')),
 (10,'visibility 内訳 PRIVATE', (select count(*)::text from public.stylist_profiles where visibility='PRIVATE')),
 (11,'stylist_private 行数（birth_dateは全員未登録になる）', (select count(*)::text from public.stylist_private)),
 (12,'既存の給与提示 件数（保持される）', (select count(*)::text from public.salary_offers)),
 (13,'salary_offers の既存trigger', (select coalesce(string_agg(tgname, ', ' order by tgname),'(なし)') from pg_trigger where tgrelid='public.salary_offers'::regclass and not tgisinternal)),
 (14,'save_stylist_profile の定義md5（0070で変わらないこと）', (select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.oid)) from pg_proc p where p.proname='save_stylist_profile' and p.pronamespace='public'::regnamespace)),
 (15,'get_public_stylists_for_scout 現在の定義に avatar_path が無い', (select (pg_get_functiondef(p.oid) not like '%avatar_path%')::text from pg_proc p where p.proname='get_public_stylists_for_scout' and p.pronamespace='public'::regnamespace)),
 (16,'age_disclosure_requests が未存在（=未適用）', (to_regclass('public.age_disclosure_requests') is null)::text),
 (17,'【適用後の影響】いま公開中（PUBLIC）で受信可の美容師数 → 適用直後は全員、生年月日の登録と表示方法の選択が済むまでサロン向け一覧・画像・スカウト送信先から保留になる', (select count(*)::text from public.stylist_profiles sp join public.user_roles ur on ur.user_id=sp.user_id and ur.role='stylist' left join public.user_settings us on us.user_id=sp.user_id where sp.visibility='PUBLIC' and coalesce(us.scout_enabled,true))),
 (18,'notifications の種類制約に開示依頼の種類が未追加（=未適用）', (select (pg_get_constraintdef(oid) not like '%age_disclosure_requested%')::text from pg_constraint where conname='notifications_type_check'))

) as v(ord, item, value) order by ord;
