-- 0060 適用後の確認 v2（何も変更しない。最後にROLLBACK）。実行者は SQLエディタ(postgres)。
-- 出力は PASS / FAIL / SKIP の表。FAIL が1つでもあれば最後にエラーで止まる。
-- 判定ルール:
--   ・「想定した拒否」だけを PASS とする。拒否されなかった／別のエラーだった場合は FAIL。
--   ・ログイン済みの一般利用者: メッセージが 'admin access required'（関数内の運営者確認で拒否）であること。
--   ・未ログイン(anon): SQLSTATE 42501（実行権限が無い）であること。
--   ・権限エラー(42501)と、関数内部の実装エラー(例: 列が無い 42703)は区別する。
begin;
create temp table post_log (n serial, name text, result text, info text);
grant all on post_log to public; grant all on sequence post_log_n_seq to public;
do $$
declare
  f text; st text; msg text; v text; r jsonb; adm uuid; org uuid; sty uuid;
  fns text[] := array[
    'select public.admin_list_organizations()', 'select public.admin_list_stylists()',
    'select public.admin_list_salon_registrants_without_company()',
    'select public.admin_get_organization(gen_random_uuid())', 'select public.admin_get_stylist(gen_random_uuid())'];
  pub text[] := array['admin_list_organizations','admin_get_organization','admin_list_stylists','admin_get_stylist','admin_list_salon_registrants_without_company'];
  internal text[] := array['_admin_known_prefectures','_admin_is_stylist_account'];
  p record;
begin
  -- 1) 関数の性質（公開5つ: SECURITY DEFINER・search_path固定・STABLE）
  for p in select proname, prosecdef, provolatile, proconfig::text as cfg from pg_proc where pronamespace = 'public'::regnamespace and proname = any (pub) loop
    insert into post_log(name, result, info) values ('1 性質: ' || p.proname,
      case when p.prosecdef and p.provolatile = 's' and coalesce(p.cfg like '%search_path%', false) then 'PASS' else 'FAIL' end, format('secdef=%s vol=%s cfg=%s', p.prosecdef, p.provolatile, p.cfg));
  end loop;
  insert into post_log(name, result, info) select '1 公開関数が5つ存在', case when count(*) = 5 then 'PASS' else 'FAIL' end, count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = any (pub);
  insert into post_log(name, result, info) select '1 内部関数が2つ存在', case when count(*) = 2 then 'PASS' else 'FAIL' end, count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = any (internal);
  -- 2) 実行権限（既定の権限に依存しない: 付与先を列挙し、期待と完全一致を見る）
  for p in select p2.oid, p2.proname, p2.proowner, (p2.proname = any (pub)) as is_pub from pg_proc p2 where p2.pronamespace = 'public'::regnamespace and p2.proname = any (pub || internal) loop
    select coalesce(string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ',' order by case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end), '')
      into v from aclexplode((select proacl from pg_proc where oid = p.oid)) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner;
    insert into post_log(name, result, info) values ('2 実行権限の付与先: ' || p.proname,
      case when p.is_pub and v = 'authenticated' then 'PASS' when not p.is_pub and v = '' then 'PASS' else 'FAIL' end,
      '付与先(所有者除く)=[' || v || '] 期待=[' || case when p.is_pub then 'authenticated' else '(なし)' end || ']');
  end loop;
  insert into post_log(name, result, info) select '2 service_role は公開関数を実行不可', case when not bool_or(has_function_privilege('service_role', oid, 'execute')) then 'PASS' else 'FAIL' end, ''
    from pg_proc where pronamespace = 'public'::regnamespace and proname = any (pub || internal);
  -- 3) 拒否の確認（想定した拒否だけをPASS）
  foreach f in array fns loop
    -- 3a) ログイン済みの一般利用者（運営者ではない乱数ID）→ 関数内の運営者確認で拒否
    perform set_config('request.jwt.claims', format('{"sub":"%s"}', gen_random_uuid()), true);
    set local role authenticated;
    begin execute f; msg := '拒否されなかった'; st := 'none';
    exception when others then get stacked diagnostics st = returned_sqlstate; msg := sqlerrm; end;
    reset role;
    insert into post_log(name, result, info) values ('3a 一般利用者は拒否: ' || f, case when st = 'P0001' and msg = 'admin access required' then 'PASS' else 'FAIL' end, 'sqlstate=' || st || ' msg=' || msg);
    -- 3b) 未ログイン(anon) → 実行権限が無い(42501)
    set local role anon;
    begin execute f; msg := '拒否されなかった'; st := 'none';
    exception when others then get stacked diagnostics st = returned_sqlstate; msg := sqlerrm; end;
    reset role;
    insert into post_log(name, result, info) values ('3b anonは実行権限なし: ' || f, case when st = '42501' then 'PASS' else 'FAIL' end, 'sqlstate=' || st || ' msg=' || msg);
    -- 3c) service_role（auth.uid無し）→ 実行権限が無い(42501)
    set local role service_role;
    begin execute f; msg := '拒否されなかった'; st := 'none';
    exception when others then get stacked diagnostics st = returned_sqlstate; msg := sqlerrm; end;
    reset role;
    insert into post_log(name, result, info) values ('3c service_roleは実行権限なし: ' || f, case when st = '42501' then 'PASS' else 'FAIL' end, 'sqlstate=' || st || ' msg=' || msg);
  end loop;
  -- 3d) 内部関数を一般利用者が直接呼べない（権限エラー42501）
  perform set_config('request.jwt.claims', format('{"sub":"%s"}', gen_random_uuid()), true);
  set local role authenticated;
  begin perform public._admin_is_stylist_account(gen_random_uuid()); msg := '拒否されなかった'; st := 'none';
  exception when others then get stacked diagnostics st = returned_sqlstate; msg := sqlerrm; end;
  reset role;
  insert into post_log(name, result, info) values ('3d 内部関数は直接呼べない', case when st = '42501' then 'PASS' else 'FAIL' end, 'sqlstate=' || st || ' msg=' || msg);
  -- 4) 運営者としての動作（登録済み運営者のIDを借りて実行。読み取りのみ。本番データの件数だけを出し、中身は出さない）
  select user_id into adm from public.platform_admins order by user_id limit 1;
  if adm is null then
    insert into post_log(name, result, info) values ('4 運営者での動作', 'SKIP', 'platform_admins が0件のため確認できない（FAILではないが、使えるようになる前に登録が必要）');
  else
    perform set_config('request.jwt.claims', format('{"sub":"%s"}', adm), true);
    set local role authenticated;
    begin
      r := public.admin_list_organizations(); v := 'org total=' || (r->>'total');
      insert into post_log(name, result, info) values ('4a 運営者: 会社一覧が返る', case when r ? 'total' and r ? 'rows' then 'PASS' else 'FAIL' end, v);
      org := (r->'rows'->0->>'id')::uuid;
      r := public.admin_list_stylists(); v := 'stylist total=' || (r->>'total');
      insert into post_log(name, result, info) values ('4b 運営者: 美容師一覧が返る', case when r ? 'total' and r ? 'rows' then 'PASS' else 'FAIL' end, v);
      sty := (r->'rows'->0->>'user_id')::uuid;
      r := public.admin_list_salon_registrants_without_company(); v := 'registrants total=' || (r->>'total');
      insert into post_log(name, result, info) values ('4c 運営者: 会社未作成のサロン登録者一覧が返る', case when r ? 'total' then 'PASS' else 'FAIL' end, v);
      if org is not null then r := public.admin_get_organization(org);
        insert into post_log(name, result, info) values ('4d 運営者: 会社詳細が返る', case when r ? 'stores' and r ? 'members' then 'PASS' else 'FAIL' end, ''); end if;
      if sty is not null then r := public.admin_get_stylist(sty);
        insert into post_log(name, result, info) values ('4e 運営者: 美容師詳細が返る', case when r ? 'registration_state' and not (r ? 'answers') then 'PASS' else 'FAIL' end, ''); end if;
    exception when others then
      get stacked diagnostics st = returned_sqlstate;
      insert into post_log(name, result, info) values ('4 運営者での動作', 'FAIL', 'sqlstate=' || st || ' ' || sqlerrm);
    end;
    reset role;
  end if;
  -- 5) 既存の表の権限・行数が適用前と同じ（ハッシュが適用前チェックの5)と一致すること）
  select md5(string_agg(x, '|' order by x)) into v from (
    select 'rows:salon_organizations:' || count(*) as x from public.salon_organizations
    union all select 'rows:salon_stores:' || count(*) from public.salon_stores
    union all select 'rows:stylist_profiles:' || count(*) from public.stylist_profiles
    union all select 'acl:' || c.relname || ':' || coalesce(c.relacl::text, '') from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relname in ('salon_organizations','salon_stores','salon_store_profiles','organization_members','store_members','stylist_profiles','stylist_private','diagnosis_results','platform_admins','profiles','user_roles')
  ) s;
  insert into post_log(name, result, info) values ('5 スナップショットのハッシュ（適用前チェックの値と一致すること。行数が動く環境では権限部分の差のみ確認）', 'INFO', v);
end $$;
select n, name, result, info from post_log order by n;
select result, count(*) from post_log group by result order by 1;
do $$ begin
  if exists (select 1 from post_log where result = 'FAIL') then raise exception '適用後チェックに FAIL があります。巻き戻しを検討してください。'; end if;
end $$;
rollback;
