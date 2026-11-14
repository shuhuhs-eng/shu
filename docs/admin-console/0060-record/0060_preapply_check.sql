-- 0060 適用前の確認 v2（読み取り専用。何も変更しない）。承認後、適用の直前に実行する。
-- 出力は PASS / FAIL の表。FAIL が1つでもあれば最後にエラーで止まる。FAIL のまま適用しない。
begin;
create temp table pre_log (n serial, name text, result text, info text);
do $$
declare
  t record; v text;
begin
  -- 1) 運営者判定の関数が存在し SECURITY DEFINER
  insert into pre_log(name, result, info)
  select '1 is_platform_admin が存在しSECURITY DEFINER', case when count(*) = 1 and bool_and(prosecdef) then 'PASS' else 'FAIL' end, count(*)::text
  from pg_proc where proname = 'is_platform_admin' and pronamespace = 'public'::regnamespace;
  -- 2) 0060 の関数がまだ存在しない
  insert into pre_log(name, result, info)
  select '2 0060の関数が未作成', case when count(*) = 0 then 'PASS' else 'FAIL' end, string_agg(proname, ',')
  from pg_proc where pronamespace = 'public'::regnamespace
   and proname in ('admin_list_organizations','admin_get_organization','admin_list_stylists','admin_get_stylist','admin_list_salon_registrants_without_company','_admin_known_prefectures','_admin_is_stylist_account');
  -- 3) 読む表・列がすべて存在（auth.users の email / raw_user_meta_data / email_confirmed_at を含む）
  for t in select * from (values
    ('public','salon_organizations','name'),('public','salon_organizations','status'),('public','salon_organizations','created_at'),
    ('public','salon_stores','prefecture'),('public','salon_stores','city'),('public','salon_stores','usage_status'),('public','salon_stores','status'),('public','salon_stores','store_name'),
    ('public','salon_store_profiles','prefecture'),('public','salon_store_profiles','city'),('public','salon_store_profiles','visibility'),
    ('public','organization_members','role'),('public','store_members','role'),
    ('public','profiles','role'),('public','profiles','onboarding_step'),('public','user_roles','role'),
    ('public','stylist_profiles','prefecture'),('public','stylist_profiles','desired_work_location'),('public','stylist_profiles','public_name'),('public','stylist_profiles','visibility'),
    ('public','stylist_private','full_name'),('public','diagnosis_results','mode'),('public','diagnosis_results','type_name'),('public','diagnosis_results','type_id'),
    ('public','stylist_evidence_documents','review_status'),('public','store_hiring_processes','status'),('public','salon_profiles','user_id'),
    ('public','salon_onboarding_assignments','user_id'),('public','platform_admins','user_id'),
    ('auth','users','email'),('auth','users','raw_user_meta_data'),('auth','users','email_confirmed_at')
  ) as x(sch, tbl, col) loop
    insert into pre_log(name, result, info)
    select '3 列が存在: ' || t.sch || '.' || t.tbl || '.' || t.col,
      case when exists (select 1 from information_schema.columns c where c.table_schema = t.sch and c.table_name = t.tbl and c.column_name = t.col) then 'PASS' else 'FAIL' end, '';
  end loop;
  -- 4) 運営者が1人以上登録されている（0件だと適用後も誰も使えない）
  insert into pre_log(name, result, info) select '4 platform_admins が1件以上', case when count(*) >= 1 then 'PASS' else 'FAIL' end, count(*)::text from public.platform_admins;
  -- 5) 既存の表の権限・行数のスナップショット（目視比較用のハッシュ。適用後の確認と同じ値になること）
  select md5(string_agg(x, '|' order by x)) into v from (
    select 'rows:salon_organizations:' || count(*) as x from public.salon_organizations
    union all select 'rows:salon_stores:' || count(*) from public.salon_stores
    union all select 'rows:stylist_profiles:' || count(*) from public.stylist_profiles
    union all select 'acl:' || c.relname || ':' || coalesce(c.relacl::text, '') from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relname in ('salon_organizations','salon_stores','salon_store_profiles','organization_members','store_members','stylist_profiles','stylist_private','diagnosis_results','platform_admins','profiles','user_roles')
  ) s;
  insert into pre_log(name, result, info) values ('5 スナップショットのハッシュ（適用後と一致すること）', 'INFO', v);
end $$;
select n, name, result, info from pre_log order by n;
do $$ begin
  if exists (select 1 from pre_log where result = 'FAIL') then raise exception '適用前チェックに FAIL があります。適用しないでください。'; end if;
end $$;
rollback;
