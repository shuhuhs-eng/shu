-- 0060（草案）の検証。0060適用済みのローカルDBで実行し、最後にROLLBACKする。
\set ON_ERROR_STOP on
begin;
create temp table t_log (n serial, name text, ok boolean, info text);
grant all on t_log to public; grant all on sequence t_log_n_seq to public;
create or replace function pg_temp.chk(p_name text, p_ok boolean, p_info text default '') returns void language plpgsql as
$$ begin insert into t_log(name, ok, info) values (p_name, coalesce(p_ok,false), p_info); if not coalesce(p_ok,false) then raise notice 'FAIL % : %', p_name, p_info; end if; end $$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'OK'; exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.chk(text,boolean,text), pg_temp.try(text) to public;

-- fixtures
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000e001','admin-x@t','{}'),
 ('00000000-0000-0000-0000-00000000e101','owner-a@t','{"display_name":"アルファ太郎"}'),
 ('00000000-0000-0000-0000-00000000e102','mgr-a@t','{"display_name":"店長花子"}'),
 ('00000000-0000-0000-0000-00000000e103','owner-b@t','{"display_name":"ベータ次郎"}'),
 ('00000000-0000-0000-0000-00000000e201','st1@t','{}'),('00000000-0000-0000-0000-00000000e202','st2@t','{}'),('00000000-0000-0000-0000-00000000e203','st3@t','{}');
update public.profiles set role='salon' where id in ('00000000-0000-0000-0000-00000000e101','00000000-0000-0000-0000-00000000e102','00000000-0000-0000-0000-00000000e103');
insert into public.user_roles (user_id, role) select id, 'salon' from public.profiles where id in ('00000000-0000-0000-0000-00000000e101','00000000-0000-0000-0000-00000000e102','00000000-0000-0000-0000-00000000e103') on conflict do nothing;
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000e201','stylist'),('00000000-0000-0000-0000-00000000e202','stylist'),('00000000-0000-0000-0000-00000000e203','stylist') on conflict do nothing;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-00000000e001');
insert into public.salon_organizations (id, name) values ('00000000-0000-0000-0000-0000000e0a01','アルファ美容室'),('00000000-0000-0000-0000-0000000e0b01','ベータ株式会社');
insert into public.salon_stores (id, organization_id, store_name, prefecture, city) values
 ('00000000-0000-0000-0000-0000000e0a11','00000000-0000-0000-0000-0000000e0a01','アルファ渋谷店',null,null),
 ('00000000-0000-0000-0000-0000000e0a12','00000000-0000-0000-0000-0000000e0a01','アルファ札幌店','北海道','札幌市'),
 ('00000000-0000-0000-0000-0000000e0a13','00000000-0000-0000-0000-0000000e0a01','アルファ不明店',null,null),
 ('00000000-0000-0000-0000-0000000e0b11','00000000-0000-0000-0000-0000000e0b01','ベータ大阪店','大阪府','大阪市');
insert into public.salon_store_profiles (store_id, salon_name, visibility, prefecture, city) values
 ('00000000-0000-0000-0000-0000000e0a11','アルファ渋谷店','PUBLIC','東京都','渋谷区');
insert into public.organization_members (organization_id, user_id, role) values
 ('00000000-0000-0000-0000-0000000e0a01','00000000-0000-0000-0000-00000000e101','company_owner'),
 ('00000000-0000-0000-0000-0000000e0b01','00000000-0000-0000-0000-00000000e103','company_owner');
insert into public.store_members (store_id, user_id, role) values ('00000000-0000-0000-0000-0000000e0a11','00000000-0000-0000-0000-00000000e102','store_manager');
insert into public.stylist_profiles (user_id, public_name, visibility, prefecture, desired_work_location) values
 ('00000000-0000-0000-0000-00000000e201','さくら','PUBLIC','神奈川県','東京都で働きたい'),
 ('00000000-0000-0000-0000-00000000e202','みどり','PRIVATE',null,null),
 ('00000000-0000-0000-0000-00000000e203','あおい','PRIVATE','大阪府','神奈川県・東京都どちらも可');
-- v2 fixtures: 条件分担の会社、登録途中の美容師、会社未作成のサロン登録者、診断
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000e301','g-owner@t','{"display_name":"ガンマ代表"}'),
 ('00000000-0000-0000-0000-00000000e302','d-owner@t','{"display_name":"デルタ代表"}'),
 ('00000000-0000-0000-0000-00000000e401','noprof@t','{}'),('00000000-0000-0000-0000-00000000e402','inprog@t','{}'),
 ('00000000-0000-0000-0000-00000000e501','salon-nocomp@t','{"display_name":"登録途中サロン"}'),
 ('00000000-0000-0000-0000-00000000e502','salon-nocomp2@t','{}');
update public.profiles set role='salon' where id in ('00000000-0000-0000-0000-00000000e301','00000000-0000-0000-0000-00000000e302','00000000-0000-0000-0000-00000000e501','00000000-0000-0000-0000-00000000e502');
update public.profiles set onboarding_step = 2 where id = '00000000-0000-0000-0000-00000000e402';
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000e301','salon'),('00000000-0000-0000-0000-00000000e302','salon') on conflict do nothing;
insert into public.salon_organizations (id, name) values ('00000000-0000-0000-0000-0000000e0c01','ガンマ分担社'),('00000000-0000-0000-0000-0000000e0d01','デルタ一致社');
insert into public.salon_stores (id, organization_id, store_name, prefecture, city, usage_status) values
 ('00000000-0000-0000-0000-0000000e0c11','00000000-0000-0000-0000-0000000e0c01','ガンマ北海道店','北海道','札幌市','inactive'),
 ('00000000-0000-0000-0000-0000000e0c12','00000000-0000-0000-0000-0000000e0c01','ガンマ東京店','東京都','港区','active'),
 ('00000000-0000-0000-0000-0000000e0d11','00000000-0000-0000-0000-0000000e0d01','デルタ北海道店',null,null,'active');
insert into public.salon_store_profiles (store_id, salon_name, visibility, prefecture, city) values
 ('00000000-0000-0000-0000-0000000e0c12','ガンマ東京店','PUBLIC','東京都','港区'),
 ('00000000-0000-0000-0000-0000000e0d11','デルタ北海道店','PUBLIC','北海道','函館市');
insert into public.organization_members (organization_id, user_id, role) values
 ('00000000-0000-0000-0000-0000000e0c01','00000000-0000-0000-0000-00000000e301','company_owner'),
 ('00000000-0000-0000-0000-0000000e0d01','00000000-0000-0000-0000-00000000e302','company_owner');
insert into public.stylist_profiles (user_id, public_name, visibility, prefecture) values ('00000000-0000-0000-0000-00000000e402','途中さん','PRIVATE','東京都');
insert into public.diagnosis_results (id, user_id, diagnosis_version, mode, answers, craft_score, sense_score, hospitality_score, brand_score, drive_score, mentor_score, type_id, type_name, created_at) values
 ('00000000-0000-0000-0000-000000d00001','00000000-0000-0000-0000-00000000e201','v','stylist','{}',1,1,1,1,1,1,'t1','タイプA','2026-01-01 00:00:00+00'),
 ('00000000-0000-0000-0000-000000d00002','00000000-0000-0000-0000-00000000e201','v','stylist','{}',1,1,1,1,1,1,'t2','タイプB','2026-01-01 00:00:00+00'),
 ('00000000-0000-0000-0000-000000d00003','00000000-0000-0000-0000-00000000e201','v','salon','{}',1,1,1,1,1,1,'s9','サロン用結果','2026-06-01 00:00:00+00');
insert into public.stylist_private (user_id, full_name) values ('00000000-0000-0000-0000-00000000e201','山田さくら') on conflict (user_id) do update set full_name = excluded.full_name;

do $$
declare
  adm text := '{"sub":"00000000-0000-0000-0000-00000000e001"}';
  r jsonb; msg text; n int;
  fns text[] := array[
    $q$select public.admin_list_organizations()$q$,
    $q$select public.admin_get_organization('00000000-0000-0000-0000-0000000e0a01')$q$,
    $q$select public.admin_list_stylists()$q$,
    $q$select public.admin_get_stylist('00000000-0000-0000-0000-00000000e201')$q$,
    $q$select public.admin_list_salon_registrants_without_company()$q$];
  f text;
begin
  ---- 権限: 未ログイン(anon)・一般サロン・店舗担当者・美容師・他社は、4関数すべて拒否 ----
  foreach f in array fns loop
    set local role anon;
    msg := pg_temp.try(f);
    reset role;
    perform pg_temp.chk('A1 anonは実行できない: ' || left(f, 40), msg like 'permission denied%', msg);
    for n in 1..4 loop
      set local role authenticated;
      perform set_config('request.jwt.claims', format('{"sub":"%s"}', (array['00000000-0000-0000-0000-00000000e101','00000000-0000-0000-0000-00000000e102','00000000-0000-0000-0000-00000000e103','00000000-0000-0000-0000-00000000e201'])[n]), true);
      msg := pg_temp.try(f);
      reset role;
      perform pg_temp.chk('A2 一般利用者'||n||'は拒否: ' || left(f, 40), msg = 'admin access required', msg);
    end loop;
  end loop;
  set local role authenticated; perform set_config('request.jwt.claims', '{}', true);
  perform pg_temp.chk('A3 sub無し(未ログイン相当)は拒否', pg_temp.try($q$select public.admin_list_organizations()$q$) = 'admin access required');
  reset role;

  set local role authenticated; perform set_config('request.jwt.claims', adm, true);
  ---- 会社一覧 ----
  r := public.admin_list_organizations(p_q => 'アルファ');
  perform pg_temp.chk('B1 会社名で検索', (r->>'total')::int = 1 and r->'rows'->0->>'name' = 'アルファ美容室', r::text);
  r := public.admin_list_organizations(p_q => 'アルファ札幌');
  perform pg_temp.chk('B2 店舗名で検索→該当会社と、その店舗が行に含まれる', (r->>'total')::int = 1 and r->'rows'->0->'stores' @> '[{"name":"アルファ札幌店"}]', r::text);
  r := public.admin_list_organizations(p_q => 'OWNER-A@T');
  perform pg_temp.chk('B3 登録メール（大文字小文字を区別しない）で検索', (r->>'total')::int = 1, r::text);
  r := public.admin_list_organizations(p_q => '店長花子');
  perform pg_temp.chk('B4 店舗担当者名で検索→その店舗の会社', (r->>'total')::int = 1 and r->'rows'->0->>'name' = 'アルファ美容室', r::text);
  r := public.admin_list_organizations(p_q => '%');
  perform pg_temp.chk('B5 % は特殊文字として働かない（全件にならない）', (r->>'total')::int = 0, r::text);
  r := public.admin_list_organizations(p_prefectures => array['北海道'], p_q => 'アルファ');
  perform pg_temp.chk('B6 都道府県(店舗の所在地)で絞り込み', (r->>'total')::int = 1 and r->'rows'->0->>'name' = 'アルファ美容室', r::text);
  r := public.admin_list_organizations(p_prefectures => array['東京都'], p_q => 'アルファ');
  perform pg_temp.chk('B7 店舗プロフィールの所在地(東京都)が店舗側の値(null)より優先されて当たる', (r->>'total')::int = 1, r::text);
  perform pg_temp.chk('B8 大阪府の絞り込み（アルファは当たらず、ベータは当たる）', (public.admin_list_organizations(p_prefectures => array['大阪府'], p_q => 'アルファ')->>'total')::int = 0 and (public.admin_list_organizations(p_prefectures => array['大阪府'], p_q => 'ベータ')->>'total')::int = 1);
  r := public.admin_list_organizations(p_include_unset => true, p_q => 'アルファ');
  perform pg_temp.chk('B9 所在地が未設定の店舗がある会社を「未設定」で絞り込める', (r->>'total')::int = 1 and r->'rows'->0->'stores' @> '[{"name":"アルファ不明店","prefecture":null}]', r::text);
  r := public.admin_list_organizations(p_include_unset => true, p_q => 'ベータ');
  perform pg_temp.chk('B10 全店舗の所在地が設定済みの会社は「未設定」に出ない', (r->>'total')::int = 0, r::text);
  r := public.admin_list_organizations(p_visibility => 'PUBLIC', p_q => 'アルファ');
  perform pg_temp.chk('B11 公開状態で絞り込み', (r->>'total')::int = 1, r::text);
  r := public.admin_list_organizations(p_visibility => 'PUBLIC', p_q => 'ベータ');
  perform pg_temp.chk('B12 公開店が無い会社は公開で当たらない', (r->>'total')::int = 0, r::text);
  perform pg_temp.chk('B13 不正な絞り込み値は拒否', pg_temp.try($q$select public.admin_list_organizations(p_visibility => 'x')$q$) = 'invalid visibility');
  r := public.admin_list_organizations(p_limit => 100000);
  perform pg_temp.chk('B14 件数は100に丸める', jsonb_array_length(r->'rows') <= 100);
  r := public.admin_list_organizations(p_limit => 1, p_offset => 0);
  perform pg_temp.chk('B15 limit=1 でも total は全体件数', jsonb_array_length(r->'rows') = 1 and (r->>'total')::int >= 2, r->>'total');
  ---- 会社詳細 ----
  r := public.admin_get_organization('00000000-0000-0000-0000-0000000e0a01');
  perform pg_temp.chk('C1 会社詳細: 全店舗(3)', jsonb_array_length(r->'stores') = 3, (r->'stores')::text);
  perform pg_temp.chk('C2 会社詳細: 店舗所在地の出どころ(profile/store/未設定)を区別', r->'stores' @> '[{"name":"アルファ渋谷店","prefecture":"東京都","address_source":"profile"},{"name":"アルファ札幌店","prefecture":"北海道","address_source":"store"},{"name":"アルファ不明店","prefecture":null,"address_source":null}]', (r->'stores')::text);
  perform pg_temp.chk('C3 会社詳細: 登録担当者(会社権限)と店舗担当者(店舗権限)を分けて返す', r->'members' @> '[{"role":"company_owner","email":"owner-a@t","name":"アルファ太郎"}]' and r->'stores'->0->'members' is not null and (r::text like '%店長花子%'), (r->'members')::text);
  perform pg_temp.chk('C4 会社詳細: 他社(ベータ)の担当者は混ざらない', r::text not like '%owner-b@t%' and r::text not like '%ベータ%');
  perform pg_temp.chk('C5 存在しない会社は not found', pg_temp.try($q$select public.admin_get_organization(gen_random_uuid())$q$) = 'organization not found');
  ---- 美容師一覧 ----
  r := public.admin_list_stylists(p_q => 'さくら');
  perform pg_temp.chk('D1 美容師を名前で検索（公開名・本名）', (r->>'total')::int = 1 and r->'rows'->0->>'full_name' = '山田さくら', r::text);
  r := public.admin_list_stylists(p_q => 'st3@T');
  perform pg_temp.chk('D2 美容師をメールで検索', (r->>'total')::int = 1 and r->'rows'->0->>'public_name' = 'あおい');
  r := public.admin_list_stylists(p_residence_prefectures => array['神奈川県']);
  perform pg_temp.chk('D3 居住地で絞り込み（勤務希望は無関係）', (r->>'total')::int = 1 and r->'rows'->0->>'public_name' = 'さくら', r::text);
  r := public.admin_list_stylists(p_desired_prefectures => array['神奈川県']);
  perform pg_temp.chk('D4 勤務希望地で絞り込み（居住地が神奈川の さくら は当たらない）', (r->>'total')::int = 1 and r->'rows'->0->>'public_name' = 'あおい', r::text);
  r := public.admin_list_stylists(p_desired_prefectures => array['東京都']);
  perform pg_temp.chk('D5 勤務希望: 東京都は さくら・あおい', (r->>'total')::int = 2, r::text);
  r := public.admin_list_stylists(p_residence_unset => true, p_state => 'completed');
  perform pg_temp.chk('D6 居住地「未設定」で絞り込み', r->'rows' @> '[{"public_name":"みどり"}]', r::text);
  r := public.admin_list_stylists(p_q => 'みどり');
  perform pg_temp.chk('D7 居住地・勤務希望が空でも行は出て、値はnull（画面で「未設定」）', r->'rows'->0->'residence_prefecture' = 'null'::jsonb and r->'rows'->0->'desired_work_location' = 'null'::jsonb, r::text);
  r := public.admin_list_stylists(p_visibility => 'PUBLIC', p_q => 'st1@t');
  perform pg_temp.chk('D8 公開状態で絞り込み', (r->>'total')::int = 1, r::text);
  ---- 美容師詳細 ----
  r := public.admin_get_stylist('00000000-0000-0000-0000-00000000e201');
  perform pg_temp.chk('E1 美容師詳細: 居住地と勤務希望を別項目で返す', r->>'residence_prefecture' = '神奈川県' and r->>'desired_work_location' = '東京都で働きたい', r::text);
  perform pg_temp.chk('E2 美容師詳細: 診断の回答・スコアの本文は返さない（タイプ名と日時のみ）', not (r ? 'answers') and (r->'diagnosis' is null or not (r->'diagnosis' ? 'answers')));
  perform pg_temp.chk('E3 美容師詳細: 年代・性別などは返さない', not (r ? 'age_band') and not (r ? 'gender'));
  perform pg_temp.chk('E4 運営者でも、サロン用アカウントのIDは美容師として引けない', pg_temp.try($q$select public.admin_get_stylist('00000000-0000-0000-0000-00000000e101')$q$) = 'stylist not found');
  ---- v2: 同一店舗の条件 ----
  r := public.admin_list_organizations(p_prefectures => array['北海道'], p_visibility => 'PUBLIC', p_q => 'ガンマ');
  perform pg_temp.chk('G1 別々の店舗が条件を分担（北海道は非公開店/公開は東京店）しても「北海道かつ公開」に当たらない', (r->>'total')::int = 0, r::text);
  r := public.admin_list_organizations(p_prefectures => array['北海道'], p_usage => 'active', p_q => 'ガンマ');
  perform pg_temp.chk('G2 利用状態でも同様（北海道店は inactive、東京店が active）→当たらない', (r->>'total')::int = 0, r::text);
  r := public.admin_list_organizations(p_prefectures => array['北海道'], p_q => 'ガンマ');
  perform pg_temp.chk('G3 所在地だけなら当たり、該当店舗は北海道店のみ matches_filter', (r->>'total')::int = 1 and r->'rows'->0->'stores' @> '[{"name":"ガンマ北海道店","matches_filter":true},{"name":"ガンマ東京店","matches_filter":false}]' and (r->'rows'->0->>'matched_store_count')::int = 1, r::text);
  r := public.admin_list_organizations(p_prefectures => array['北海道'], p_visibility => 'PUBLIC', p_usage => 'active', p_q => 'デルタ');
  perform pg_temp.chk('G4 1店舗が全条件を満たす会社は当たり、その店舗が matches_filter（店舗プロフィールの所在地が優先）', (r->>'total')::int = 1 and r->'rows'->0->'stores' @> '[{"name":"デルタ北海道店","matches_filter":true,"city":"函館市"}]', r::text);
  r := public.admin_list_organizations(p_q => 'ガンマ東京');
  perform pg_temp.chk('G5 店舗名の検索では、検索語に一致した店舗が matches_query で分かる', r->'rows'->0->'stores' @> '[{"name":"ガンマ東京店","matches_query":true},{"name":"ガンマ北海道店","matches_query":false}]', r::text);
  r := public.admin_list_organizations(p_q => 'ガンマ');
  perform pg_temp.chk('G6 絞り込み無しなら matches_filter は全店舗 false（絞り込みが無いことを区別）', not (r->'rows'->0->'stores' @> '[{"matches_filter":true}]'), r::text);
  r := public.admin_list_organizations(p_include_unset => true, p_visibility => 'PUBLIC', p_q => 'アルファ');
  perform pg_temp.chk('G7 「未設定」＋公開の同一店舗条件: 未設定店(不明店)は公開でないため当たらない店と、公開(渋谷)は所在地設定済のため、どの店も両方を満たさず当たらない', (r->>'total')::int = 0, r::text);
  ---- v2: 美容師の登録状態 ----
  r := public.admin_list_stylists(p_q => 'noprof@t');
  perform pg_temp.chk('H1 アカウントのみ(プロフィール未作成)の美容師も一覧に残り no_profile', (r->>'total')::int = 1 and r->'rows'->0->>'registration_state' = 'no_profile', r::text);
  r := public.admin_list_stylists(p_q => 'inprog@t');
  perform pg_temp.chk('H2 登録途中(プロフィール有・未完了)は in_progress とステップ番号', (r->>'total')::int = 1 and r->'rows'->0->>'registration_state' = 'in_progress' and (r->'rows'->0->>'onboarding_step')::int = 2, r::text);
  r := public.admin_list_stylists(p_q => 'st1@t');
  perform pg_temp.chk('H3 完了者は completed', r->'rows'->0->>'registration_state' = 'completed', r::text);
  perform pg_temp.chk('H4 状態で絞り込める', (public.admin_list_stylists(p_state => 'no_profile', p_q => 'noprof@t')->>'total')::int = 1 and (public.admin_list_stylists(p_state => 'completed', p_q => 'noprof@t')->>'total')::int = 0);
  perform pg_temp.chk('H5 不正な状態値は拒否', pg_temp.try($q$select public.admin_list_stylists(p_state => 'x')$q$) = 'invalid state');
  r := public.admin_list_stylists(p_limit => 100);
  perform pg_temp.chk('H6 サロン・運営者のアカウントは美容師一覧に混ざらない', r::text not like '%owner-a@t%' and r::text not like '%mgr-a@t%' and r::text not like '%admin-x@t%' and r::text not like '%g-owner@t%' and r::text not like '%salon-nocomp@t%', (select count(*) from jsonb_array_elements(r->'rows'))::text);
  perform pg_temp.chk('H7 プロフィールの無い美容師の詳細も引け、状態は no_profile', public.admin_get_stylist('00000000-0000-0000-0000-00000000e401')->>'registration_state' = 'no_profile');
  perform pg_temp.chk('H8 運営者・サロン登録者のIDは美容師詳細で not found', pg_temp.try($q$select public.admin_get_stylist('00000000-0000-0000-0000-00000000e001')$q$) = 'stylist not found' and pg_temp.try($q$select public.admin_get_stylist('00000000-0000-0000-0000-00000000e501')$q$) = 'stylist not found');
  ---- v2: 診断の取得条件 ----
  r := public.admin_list_stylists(p_q => 'st1@t');
  perform pg_temp.chk('I1 一覧の診断は mode=stylist のみ（新しいサロン用結果を拾わない）かつ同時刻は id 降順で固定（タイプB）', r->'rows'->0->>'diagnosis_type' = 'タイプB', r::text);
  r := public.admin_get_stylist('00000000-0000-0000-0000-00000000e201');
  perform pg_temp.chk('I2 詳細の診断も同じ（タイプB・サロン用は拾わない）', r->'diagnosis'->>'type_name' = 'タイプB', (r->'diagnosis')::text);
  perform pg_temp.chk('I3 繰り返しても結果が同じ（順序が安定）', (select count(distinct public.admin_get_stylist('00000000-0000-0000-0000-00000000e201')->'diagnosis'->>'type_name') from generate_series(1,5)) = 1);
  ---- v2: 会社未作成のサロン登録者 ----
  r := public.admin_list_salon_registrants_without_company();
  perform pg_temp.chk('J1 会社未作成のサロン登録者が出る（メール確認状態・ステップ付き）', r->'rows' @> '[{"email":"salon-nocomp@t","name":"登録途中サロン"}]' and r->'rows' @> '[{"email":"salon-nocomp2@t"}]' and r->'rows'->0 ? 'email_confirmed' and r->'rows'->0 ? 'onboarding_step', r::text);
  perform pg_temp.chk('J2 会社に所属済みのサロン・運営者・美容師は含まれない', r::text not like '%owner-a@t%' and r::text not like '%mgr-a@t%' and r::text not like '%g-owner@t%' and r::text not like '%admin-x@t%' and r::text not like '%st1@t%' and r::text not like '%noprof@t%', r::text);
  perform pg_temp.chk('J3 total が行数と一致', (r->>'total')::int = jsonb_array_length(r->'rows'), r->>'total');
  reset role;
  ---- 書き込みが起きていない ----
  perform pg_temp.chk('F1 5関数は読み取りのみ（STABLE）', (select count(*) from pg_proc where proname in ('admin_list_organizations','admin_get_organization','admin_list_stylists','admin_get_stylist','admin_list_salon_registrants_without_company') and provolatile = 's') = 5);
  perform pg_temp.chk('F2 5関数とも SECURITY DEFINER・search_path固定', (select count(*) from pg_proc where proname in ('admin_list_organizations','admin_get_organization','admin_list_stylists','admin_get_stylist','admin_list_salon_registrants_without_company') and prosecdef and proconfig::text like '%search_path%') = 5);
  perform pg_temp.chk('F3 内部関数 _admin_known_prefectures は一般利用者が呼べない', not has_function_privilege('authenticated', 'public._admin_known_prefectures()', 'execute'));
  ---- v2: 実行権限を明示（デフォルト権限に依存しない） ----
  perform pg_temp.chk('K1 公開RPC5つは authenticated のみ実行可（anon/service_role/PUBLICは不可）',
    (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('admin_list_organizations','admin_get_organization','admin_list_stylists','admin_get_stylist','admin_list_salon_registrants_without_company')
       and (select coalesce(array_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end order by 1), '{}') from aclexplode(p.proacl) a where a.privilege_type='EXECUTE' and a.grantee <> p.proowner) = array['authenticated']::text[]) = 5);
  perform pg_temp.chk('K2 内部補助関数は誰にも実行権限が無い（所有者以外）',
    (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('_admin_known_prefectures','_admin_is_stylist_account')
       and not exists (select 1 from aclexplode(p.proacl) a where a.privilege_type='EXECUTE' and (a.grantee = 0 or a.grantee::regrole::text in ('anon','authenticated','service_role')))) = 2);
  perform pg_temp.chk('K3 service_role は公開RPCも内部関数も実行不可', not has_function_privilege('service_role','public.admin_list_organizations(text,text[],boolean,text,text,integer,integer)','execute') and not has_function_privilege('service_role','public._admin_is_stylist_account(uuid)','execute'));
  set local role authenticated; perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e101"}', true);
  msg := pg_temp.try($q$select public._admin_is_stylist_account(gen_random_uuid())$q$);
  reset role;
  perform pg_temp.chk('K4 一般ユーザーは内部関数を直接呼べない（権限エラー）', msg like 'permission denied%', msg);
end $$;

select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from t_log;
rollback;
