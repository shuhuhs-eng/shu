-- 0070 年齢仕様（必須登録・表示方法・開示依頼）の検証（ローカル専用・全体をROLLBACK）。
-- 前提: 0070_fixture.sql 投入後・0070本体適用後のDB。結果表は最後に1つ。
\set ON_ERROR_STOP on
\o /dev/null
begin;
create temp table _r(ord serial, name text, ok boolean, detail text);
grant all on _r to public; grant all on sequence _r_ord_seq to public;
create function pg_temp.ck(n text, ok boolean, d text default '') returns void language sql as $$ insert into _r(name, ok, detail) values (n, coalesce(ok,false), d) $$;
create function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, true); execute 'set local role authenticated'; end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub','',true); execute 'set local role anon'; end $$;
create function pg_temp.as_pg() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claim.sub','',true); end $$;
create function pg_temp.err(q text) returns text language plpgsql as $$ begin execute q; return 'OK'; exception when others then return sqlerrm; end $$;
create function pg_temp.fails(q text) returns boolean language plpgsql as $$ begin execute q; return false; exception when others then return true; end $$;
-- 店舗の画面（get_public_stylists_for_scout）から見た、その美容師の1件
create function pg_temp.entry(p_store uuid, p_sty uuid) returns jsonb language sql as
$$ select e from jsonb_array_elements(public.get_public_stylists_for_scout(p_store)) e where e->>'stylist_user_id' = p_sty::text $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Asia/Tokyo')::date $$;
create function pg_temp.yrs(n int) returns date language sql as $$ select (pg_temp.today() - make_interval(years => n))::date $$;
create function pg_temp.age_of(d date) returns int language sql as $$ select extract(year from age(pg_temp.today(), d))::int $$;

\set a1 '00000000-0000-0000-0000-000000000010'
\set a2 '00000000-0000-0000-0000-000000000011'
\set u6 '00000000-0000-0000-0000-000000000006'
\set m1 '00000000-0000-0000-0000-000000000210'
\set b0 '00000000-0000-0000-0000-0000000000b0'
\set b1 '00000000-0000-0000-0000-0000000000b1'
\set c0 '00000000-0000-0000-0000-0000000000c0'
\set t1 '00000000-0000-0000-0000-000000000201'
\set t2 '00000000-0000-0000-0000-000000000202'
\set t3 '00000000-0000-0000-0000-000000000203'
\set t4 '00000000-0000-0000-0000-000000000204'
\set t5 '00000000-0000-0000-0000-000000000205'
\set t6 '00000000-0000-0000-0000-000000000206'
\set t7 '00000000-0000-0000-0000-000000000207'
\set t8 '00000000-0000-0000-0000-000000000208'
\set t9 '00000000-0000-0000-0000-000000000209'

-- ===== 準備（postgres）=====
insert into auth.users (id,email) select ('00000000-0000-0000-0000-000000000'||lpad(i::text,3,'0'))::uuid, 'age'||i||'@example.test' from unnest(array[201,202,203,204,205,206,207,208,209,210]) i on conflict do nothing;
insert into public.profiles (id) select ('00000000-0000-0000-0000-000000000'||lpad(i::text,3,'0'))::uuid from unnest(array[201,202,203,204,205,206,207,208,209,210]) i on conflict do nothing;
insert into public.user_settings (user_id) select ('00000000-0000-0000-0000-000000000'||lpad(i::text,3,'0'))::uuid from unnest(array[201,202,203,204,205,206,207,209,210]) i on conflict do nothing;
insert into public.user_roles (user_id, role) select ('00000000-0000-0000-0000-000000000'||lpad(i::text,3,'0'))::uuid, 'stylist' from unnest(array[201,202,203,204,205,206,207,209]) i on conflict do nothing;
insert into public.user_roles (user_id, role) values (:'m1','salon') on conflict do nothing;
-- 組織B・店舗: 会社Aに店舗b1を追加、会社B(a2)に店舗c0
insert into public.salon_organizations (id, name) values ('00000000-0000-0000-0000-0000000000a1','会社B');
insert into public.salon_stores (id, organization_id, store_name) values (:'b1','00000000-0000-0000-0000-0000000000a0','検証店舗2'),(:'c0','00000000-0000-0000-0000-0000000000a1','別会社の店舗');
insert into public.organization_members (organization_id, user_id, role) values ('00000000-0000-0000-0000-0000000000a1',:'a2','company_owner');
insert into public.store_members (store_id, user_id, role) values (:'b0',:'u6','viewer'),(:'b1',:'m1','store_manager');
-- 美容師: 生年月日・表示方法 → プロフィール行（生年月日が先）
insert into public.stylist_private (user_id, birth_date, age_display_mode) values
  (:'t1', pg_temp.yrs(45) - 100, 'decade'),    -- 満45歳（誕生日の100日後）
  (:'t2', pg_temp.yrs(28) - 100, 'exact'),
  (:'t3', pg_temp.yrs(33) - 100, 'decade'),
  (:'t4', pg_temp.yrs(16) - 100, 'decade'),
  (:'t6', pg_temp.yrs(30) - 100, null),
  (:'t7', pg_temp.yrs(40) - 100, 'decade'),
  (:'t9', pg_temp.yrs(25) - 100, 'decade');
select pg_temp.ck('P0 準備: t1の満年齢が45', public.stylist_age_years((select birth_date from stylist_private where user_id=:'t1')) = 45);
insert into public.stylist_profiles (user_id, public_name, visibility, prefecture, experience_years, current_position, specialties, employment_type, job_change_intent, bio) values
  (:'t1','年代A','PUBLIC','東京都',5,'スタイリスト','{カット}','full_time','active','b'),
  (:'t2','実年齢B','PUBLIC','東京都',5,'スタイリスト','{カット}','full_time','active','b'),
  (:'t3','年代C','PUBLIC','東京都',5,'スタイリスト','{カット}','full_time','active','b'),
  (:'t4','年代D未成年','PUBLIC','東京都',5,'スタイリスト','{カット}','full_time','active','b'),
  (:'t7','年代G非公開','PRIVATE','東京都',5,'スタイリスト','{カット}','full_time','active','b'),
  (:'t9','年代I','PUBLIC','東京都',5,'スタイリスト','{カット}','full_time','active','b');
-- t5 = 0070適用前から居る既存会員（生年月日未登録）、t6 = 同（生年月日のみ登録済み・表示方法未選択）。適用後は作れないので、トリガーを一時的に外して再現する。
alter table public.stylist_profiles disable trigger trg_stylist_profiles_birth_required;
insert into public.stylist_profiles (user_id, public_name, visibility, prefecture, experience_years, current_position, specialties, employment_type, job_change_intent, bio) values
  (:'t5','未登録の既存会員','PUBLIC','東京都',5,'スタイリスト','{カット}','full_time','active','b'),
  (:'t6','表示方法未選択','PUBLIC','東京都',5,'スタイリスト','{カット}','full_time','active','b');
alter table public.stylist_profiles enable trigger trg_stylist_profiles_birth_required;
update public.user_settings set scout_enabled=false where user_id=:'t3';
insert into public.stylist_salon_interests (stylist_user_id, store_id) values (:'t3',:'b0'),(:'t7',:'b0');

-- ===== A. 必須登録（未登録・未選択は公開されない）=====
select pg_temp.as_user(:'a1');
create temp table _l0 on commit drop as select jsonb_array_elements(get_public_stylists_for_scout(:'b0')) e;
grant all on _l0 to public;
select pg_temp.ck('A1 一覧は、登録・選択済みの公開中だけ（t1,t2,t9）。未登録t5・未選択t6・未成年t4・非公開t7・受信拒否t3は出ない',
  (select array_agg(e->>'stylist_user_id' order by e->>'stylist_user_id') = array[:'t1',:'t2',:'t9'] from _l0));
select pg_temp.as_pg();
select pg_temp.ck('A2 未登録(t5)・未選択(t6)は公開判定false', not stylist_salon_publishable(:'t5'::uuid) and not stylist_salon_publishable(:'t6'::uuid));
-- 既存会員t5の画像: 公開されない
insert into storage.objects (bucket_id, name, owner) values ('avatars', :'t5'||'/a.webp', :'t5'), ('avatars', :'t1'||'/a.webp', :'t1');
update public.profiles set avatar_path = id::text||'/a.webp' where id in (:'t5',:'t1');
select pg_temp.as_user(:'a1');
select pg_temp.ck('A3 サロンは、未登録t5の画像は読めず、登録済みt1の画像は読める', (select array_agg(name) = array[:'t1'||'/a.webp'] from storage.objects where bucket_id='avatars' and name like '%/a.webp'));
select pg_temp.as_pg();
-- ログインは妨げない: t5は自分のプロフィール・生年月日の状況を読める
select pg_temp.as_user(:'t5');
select pg_temp.ck('A4 未登録の既存会員も自分のプロフィールは読める（ログイン・閲覧は妨げない）', (select count(*)=1 from stylist_profiles where user_id=:'t5'));
select pg_temp.ck('A5 未登録のままプロフィール保存は拒否（birth_date_required）', pg_temp.err($$select save_stylist_profile('未登録の既存会員','氏名','30_34','female','東京都',null,5,'スタイリスト','{カット}','full_time','active',null,'[]','b','PUBLIC',true,null,'{work_life,growth,income}')$$) like '%birth_date_required%');
select pg_temp.ck('A6 保存拒否では何も変更されない（stylist_privateに行が増えない）', (select count(*)=0 from stylist_private where user_id=:'t5'));
select pg_temp.ck('A7 生年月日だけ登録しても、表示方法が未選択ならプロフィール保存は拒否（age_display_mode_required。旧保存関数を直接呼んでも同じ）', not pg_temp.fails($$select set_stylist_birth_date(pg_temp.yrs(27))$$) and pg_temp.err($$select save_stylist_profile('未登録の既存会員','氏名','30_34','female','東京都',null,5,'スタイリスト','{カット}','full_time','active',null,'[]','b','PUBLIC',true,null,'{work_life,growth,income}')$$) like '%age_display_mode_required%');
select pg_temp.as_pg();
select pg_temp.ck('A8 登録しただけでは、表示方法が未選択のため公開されない', not stylist_salon_publishable(:'t5'::uuid));
select pg_temp.as_user(:'t5');
select pg_temp.ck('A9 表示方法を選ぶと公開される', not pg_temp.fails($$select set_stylist_age_display_mode('decade')$$));
select pg_temp.ck('A9b 表示方法を選択済みなら、生年月日の登録後に通常どおり保存できる', not pg_temp.fails($$select save_stylist_profile('未登録の既存会員','氏名','30_34','female','東京都',null,5,'スタイリスト','{カット}','full_time','active',null,'[]','b','PUBLIC',true,null,'{work_life,growth,income}')$$));
select pg_temp.as_pg();
select pg_temp.ck('A10 登録・選択後は公開可', stylist_salon_publishable(:'t5'::uuid));
update public.stylist_profiles set visibility='PRIVATE' where user_id=:'t5';  -- 以降の件数を変えない

-- 登録の入力検査
select pg_temp.as_user(:'t6');
select pg_temp.ck('A11 生年月日にNULLは拒否', pg_temp.err($$select set_stylist_birth_date(null)$$) like '%birth date required%');
select pg_temp.ck('A12 表示方法にNULL・不正値は拒否', pg_temp.fails($$select set_stylist_age_display_mode(null)$$) and pg_temp.fails($$select set_stylist_age_display_mode('both')$$));
select pg_temp.ck('A13 満14歳・満101歳は拒否、満15歳は可（範囲15〜100は不変）', pg_temp.fails($$select set_stylist_birth_date(pg_temp.yrs(14))$$) and pg_temp.fails($$select set_stylist_birth_date(pg_temp.yrs(101) - 1)$$) and not pg_temp.fails($$select set_stylist_birth_date(pg_temp.yrs(15))$$) and not pg_temp.fails($$select set_stylist_birth_date(pg_temp.yrs(100))$$));
select pg_temp.ck('A14 登録済みの生年月日はNULLにできない（直接UPDATE不可）', pg_temp.fails($$update stylist_private set birth_date=null$$));
select pg_temp.as_pg();
select pg_temp.ck('A15 postgresでもNULLへ戻せない', pg_temp.err($$update stylist_private set birth_date=null where user_id='00000000-0000-0000-0000-000000000206'$$) like '%cannot be cleared%');
select pg_temp.ck('A16 他の列の更新（表示方法）は生年月日があれば可', not pg_temp.fails($$update stylist_private set age_display_mode='exact' where user_id='00000000-0000-0000-0000-000000000206'$$));
update stylist_private set age_display_mode=null, birth_date=pg_temp.yrs(30)-100 where user_id=:'t6';
-- サロン専用アカウント・美容師ロールなしは登録できない。ロール未作成の新規ユーザーは先に登録できる
select pg_temp.as_user(:'a1');
select pg_temp.ck('A17 サロン専用アカウントは生年月日・表示方法を登録できない', pg_temp.fails($$select set_stylist_birth_date(pg_temp.yrs(30))$$) and pg_temp.fails($$select set_stylist_age_display_mode('exact')$$));
select pg_temp.as_user(:'t8');
select pg_temp.ck('A18a ロール未作成の新規ユーザーが、表示方法だけ先に選べる', not pg_temp.fails($$select set_stylist_age_display_mode('exact')$$));
select pg_temp.as_pg();
select pg_temp.ck('A18b 表示方法だけ選んで生年月日が未登録の人は、公開判定false', not stylist_salon_publishable(:'t8'::uuid));
select pg_temp.as_user(:'t8');
select pg_temp.as_user(:'t8');
select pg_temp.ck('A18 ロール未作成の新規ユーザーは、プロフィール保存より前に生年月日を登録できる', not pg_temp.fails($$select set_stylist_birth_date(pg_temp.yrs(22))$$));
select pg_temp.as_pg();
select pg_temp.ck('A18c 登録後は公開可（生年月日と表示方法がそろった）', stylist_salon_publishable(:'t8'::uuid));
select pg_temp.as_anon();
select pg_temp.ck('A19 anonは登録関数・依頼関数を実行できない', pg_temp.fails($$select set_stylist_birth_date(pg_temp.yrs(30))$$) and pg_temp.fails($$select request_stylist_age_disclosure('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000201')$$) and pg_temp.fails($$select get_my_age_disclosure_requests()$$));
select pg_temp.as_pg();

-- ===== B. 実年齢表示・年代表示（サロン向けレスポンスのデータそのもの）=====
select pg_temp.as_user(:'a1');
select pg_temp.ck('B1 年代表示(t1・未承認): 年代45→40代。ageのキーも生年月日も無い',
  (select (e->>'age_decade')::int = 40 and not (e ? 'age') and e->>'age_display_mode'='decade' and e->>'age_request_status'='none' and e::text !~ '(birth|19[0-9]{2}|20[0-2][0-9]-)' from (select pg_temp.entry(:'b0',:'t1') e) q));
select pg_temp.ck('B2 実年齢表示(t2): age=28・年代20・not_needed', (select (e->>'age')::int = 28 and (e->>'age_decade')::int = 20 and e->>'age_request_status'='not_needed' and e->>'age_display_mode'='exact' from (select pg_temp.entry(:'b0',:'t2') e) q));
select pg_temp.ck('B3 店舗を指定しない呼び出しでも、年代表示の実年齢は含まれない', (select not (e ? 'age') from (select pg_temp.entry(null,:'t1') e) q));
select pg_temp.ck('B4 どの項目にも生年月日が無い（全レスポンスの文字列検査）', (select count(*)=0 from _l0 where e::text ~ 'birth'));
select pg_temp.ck('B5 一覧の返却キーに birth_date / age_band / full_name が無い', (select count(*)=0 from _l0, jsonb_object_keys(e) k where k in ('birth_date','age_band','full_name','gender')));
select pg_temp.ck('B6 実年齢の取得先が他に無い: 他人のstylist_private・依頼表は読めない', (select count(*)=0 from stylist_private) and pg_temp.fails($$select * from age_disclosure_requests$$));
select pg_temp.as_user(:'a2');
select pg_temp.ck('B7 年代表示のt1を他店舗(別会社a2・店舗c0)から見ても実年齢は無い', not (pg_temp.entry(:'c0',:'t1') ? 'age') and pg_temp.entry(:'c0',:'t1') is not null);
select pg_temp.as_user(:'a1');
select pg_temp.as_user(:'a2');
select pg_temp.ck('B8 アクセスできない店舗を指定すると拒否', pg_temp.err($$select get_public_stylists_for_scout('00000000-0000-0000-0000-0000000000b0')$$) like '%store not found or not accessible%');
select pg_temp.as_user(:'t1');
select pg_temp.ck('B9 美容師は一覧を呼べない（他の美容師の年齢も見えない）', pg_temp.fails($$select get_public_stylists_for_scout(null)$$) and pg_temp.fails($$select get_store_stylist_age_infos('00000000-0000-0000-0000-0000000000b0', array['00000000-0000-0000-0000-000000000202']::uuid[])$$));
select pg_temp.as_pg();

-- ===== C. 依頼（権限・対象・重複）=====
select pg_temp.as_user(:'t1');
select pg_temp.ck('C1 美容師は依頼を送れない', pg_temp.err($$select request_stylist_age_disclosure('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000201')$$) like '%caller is not a salon%');
select pg_temp.as_user(:'u6');
select pg_temp.ck('C2 閲覧専用メンバー(u6)は依頼できない', pg_temp.err($$select request_stylist_age_disclosure('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000201')$$) like '%not allowed to request%');
select pg_temp.as_user(:'a2');
select pg_temp.ck('C3 他社(a2)は別会社の店舗b0へ依頼できない', pg_temp.err($$select request_stylist_age_disclosure('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000201')$$) like '%not allowed to request%');
select pg_temp.as_user(:'m1');
select pg_temp.ck('C4 店長m1は担当外の店舗b0には依頼できない（同じ会社でも店舗単位）', pg_temp.err($$select request_stylist_age_disclosure('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000201')$$) like '%not allowed to request%');
select pg_temp.as_user(:'a1');
select pg_temp.ck('C5 対象外: 実年齢表示(t2)・未選択(t6)・未登録(t5)・未成年(t4)・存在しない人・サロンは依頼できない',
  pg_temp.err($$select request_stylist_age_disclosure('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000202')$$) like '%not needed%'
  and pg_temp.err($$select request_stylist_age_disclosure('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000206')$$) like '%not available%'
  and pg_temp.err($$select request_stylist_age_disclosure('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000205')$$) like '%not available%'
  and pg_temp.err($$select request_stylist_age_disclosure('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000204')$$) like '%not available%'
  and pg_temp.err($$select request_stylist_age_disclosure('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000099')$$) like '%not available%'
  and pg_temp.err($$select request_stylist_age_disclosure('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000011')$$) like '%not available%');
select pg_temp.as_pg();
update public.stylist_profiles set visibility='PRIVATE' where user_id=:'t9';
select pg_temp.as_user(:'a1');
select pg_temp.ck('C8 PRIVATEで興味ありも無い(t9)は依頼できない', pg_temp.err($$select request_stylist_age_disclosure('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000209')$$) like '%not available%', pg_temp.err($$select request_stylist_age_disclosure('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000209')$$));
select pg_temp.as_pg();
update public.stylist_profiles set visibility='PUBLIC' where user_id=:'t9';
select pg_temp.as_user(:'a1');

-- ===== D. 依頼 → 承認（依頼元の店舗だけに開示）=====
select pg_temp.as_user(:'a1');
create temp table _q1 on commit drop as select request_stylist_age_disclosure(:'b0', :'t1') r;
grant all on _q1 to public;
select pg_temp.ck('D1 店舗b0からt1へ依頼: pending・新規作成', (select r->>'status'='pending' and (r->>'created')::boolean from _q1));
select pg_temp.ck('D2 同じ依頼の連打は同じ依頼を返す（新規でない）', (select (request_stylist_age_disclosure(:'b0',:'t1')->>'created')::boolean = false and (request_stylist_age_disclosure(:'b0',:'t1')->>'status')='pending'));
select pg_temp.as_pg();
select pg_temp.ck('D3 依頼は1件・通知も1件（美容師t1宛・アプリ内）', (select count(*)=1 from age_disclosure_requests where store_id=:'b0' and stylist_user_id=:'t1') and (select count(*)=1 from notifications where user_id=:'t1' and type='age_disclosure_requested' and link_path='/stylist/age-requests'));
select pg_temp.as_user(:'a1');
select pg_temp.ck('D4 依頼しただけでは開示されない（依頼中は年代のまま）', (select not (e ? 'age') and e->>'age_request_status'='pending' from (select pg_temp.entry(:'b0',:'t1') e) q));
select pg_temp.as_pg();
select pg_temp.as_user(:'t2');
select pg_temp.as_pg();
select id as rid from age_disclosure_requests where store_id=:'b0' and stylist_user_id=:'t1' \gset
select pg_temp.as_user(:'t2');
select pg_temp.ck('D5b 他の美容師(t2)が、t1宛の依頼IDを承認しようとすると「見つからない」', pg_temp.err(format($$select respond_age_disclosure_request(%L, true)$$, :'rid')) like '%request not found%');
select pg_temp.as_user(:'a1');
select pg_temp.ck('D6 サロン(a1)は承認できない', pg_temp.err(format($$select respond_age_disclosure_request(%L, true)$$, :'rid')) like '%caller is not a stylist%');
select pg_temp.as_pg();
select pg_temp.ck('D7 不正な操作後も依頼は pending のまま', (select status='pending' and decided_at is null from age_disclosure_requests where id=:'rid'));
select pg_temp.as_user(:'t1');
select pg_temp.ck('D8 t1は自分宛の依頼と依頼元の店舗を確認できる', (select jsonb_array_length(r)=1 and r->0->>'store_name'='検証店舗' and r->0->>'status'='pending' from (select get_my_age_disclosure_requests() r) q));
select pg_temp.ck('D9 t1が承認 → approved', respond_age_disclosure_request(:'rid'::uuid, true)->>'status'='approved');
select pg_temp.ck('D10 承認の二重処理は同じ結果・状態は壊れない', respond_age_disclosure_request(:'rid'::uuid, true)->>'status'='approved');
select pg_temp.ck('D11 承認後の「辞退」は拒否され、承認のまま', pg_temp.err(format($$select respond_age_disclosure_request(%L, false)$$, :'rid')) like '%age_disclosure_already_decided%');
select pg_temp.as_pg();
select pg_temp.ck('D12 通知: 依頼元(a1)へ承認通知が1件のみ（二重承認でも増えない）', (select count(*)=1 from notifications where user_id=:'a1' and type='age_disclosure_approved' and related_entity_id=:'rid'::uuid));
select pg_temp.ck('D13 承認記録は approved・decided_at あり', (select status='approved' and decided_at is not null from age_disclosure_requests where id=:'rid'));
-- 開示の範囲
select pg_temp.as_user(:'a1');
create temp table _e1 on commit drop as select pg_temp.entry(:'b0',:'t1') e;
grant all on _e1 to public;
select pg_temp.ck('D14 承認後: 依頼元の店舗b0には現在の満年齢45が出る（年代も併記）', (select (e->>'age')::int = 45 and (e->>'age_decade')::int = 40 and e->>'age_request_status'='approved' from _e1));
select pg_temp.ck('D15 承認後も生年月日は返さない', (select e::text !~ 'birth' and e::text !~ '19[0-9]{2}-|20[0-2][0-9]-' from _e1));
select pg_temp.ck('D16 同じ会社の別店舗b1には流用されない', (select not (e ? 'age') and e->>'age_request_status'='none' from (select pg_temp.entry(:'b1',:'t1') e) q));
select pg_temp.ck('D17 店舗を指定しない呼び出しにも流用されない', (select not (e ? 'age') from (select pg_temp.entry(null,:'t1') e) q));
select pg_temp.ck('D18 get_store_stylist_age_infos も同じ規則（b0:あり / b1:なし）',
  (select (x->>'age')::int=45 from jsonb_array_elements(get_store_stylist_age_infos(:'b0', array[:'t1']::uuid[])) x where x->>'stylist_user_id'=:'t1')
  and (select not (x ? 'age') from jsonb_array_elements(get_store_stylist_age_infos(:'b1', array[:'t1']::uuid[])) x where x->>'stylist_user_id'=:'t1'));
select pg_temp.as_user(:'u6');
select pg_temp.ck('D19 店舗b0にアクセスできる閲覧専用メンバー(u6)も承認済みの年齢を見られる（依頼はできない）', (select (e->>'age')::int = 45 from (select pg_temp.entry(:'b0',:'t1') e) q));
select pg_temp.as_user(:'m1');
select pg_temp.ck('D20 b1の店長m1はb0を指定できず、b1では実年齢が出ない', pg_temp.fails($$select get_public_stylists_for_scout('00000000-0000-0000-0000-0000000000b0')$$) and (select not (e ? 'age') from (select pg_temp.entry(:'b1',:'t1') e) q));
select pg_temp.as_user(:'a2');
select pg_temp.ck('D21 他社(a2・店舗c0)は承認の影響を受けない', (select not (e ? 'age') and e->>'age_request_status'='none' from (select pg_temp.entry(:'c0',:'t1') e) q));
select pg_temp.ck('D22 他社は、依頼元でない店舗の年齢を問い合わせても拒否', pg_temp.fails($$select get_store_stylist_age_infos('00000000-0000-0000-0000-0000000000b0', array['00000000-0000-0000-0000-000000000201']::uuid[])$$));
select pg_temp.as_pg();
-- 誕生日: 承認済みの店舗には、誕生日を迎えたあとも最新の満年齢
update stylist_private set birth_date = pg_temp.yrs(46) where user_id=:'t1';
select pg_temp.as_user(:'a1');
select pg_temp.ck('D23 誕生日を迎えた（満46）→ 承認済みの店舗には46が出る', (select (e->>'age')::int = 46 from (select pg_temp.entry(:'b0',:'t1') e) q));
select pg_temp.as_pg();
update stylist_private set birth_date = pg_temp.yrs(46) + 1 where user_id=:'t1';
select pg_temp.as_user(:'a1');
select pg_temp.ck('D24 誕生日の前日までは45のまま（日本時間の今日基準）', (select (e->>'age')::int = 45 from (select pg_temp.entry(:'b0',:'t1') e) q));
select pg_temp.as_pg();
update stylist_private set birth_date = pg_temp.yrs(45) - 100 where user_id=:'t1';

-- ===== E. 辞退・未回答 =====
select pg_temp.as_user(:'a2');
-- 別会社の店舗c0からt1へ（t1はPUBLICで受信可）
select pg_temp.ck('E1 別会社の店舗c0からも依頼できる（店舗ごとに別の依頼）', request_stylist_age_disclosure(:'c0',:'t1')->>'status'='pending');
select pg_temp.as_pg();
select id as rid2 from age_disclosure_requests where store_id=:'c0' and stylist_user_id=:'t1' \gset
select pg_temp.as_user(:'t1');
select pg_temp.ck('E2 辞退 → declined', respond_age_disclosure_request(:'rid2'::uuid, false)->>'status'='declined');
select pg_temp.ck('E3 辞退の二重処理は同じ結果', respond_age_disclosure_request(:'rid2'::uuid, false)->>'status'='declined');
select pg_temp.ck('E4 辞退後の「承認」は拒否（状態は変わらない）', pg_temp.err(format($$select respond_age_disclosure_request(%L, true)$$, :'rid2')) like '%age_disclosure_already_decided%');
select pg_temp.as_pg();
select pg_temp.ck('E5 辞退では承認通知は作られない', (select count(*)=0 from notifications where user_id=:'a2' and type='age_disclosure_approved'));
select pg_temp.as_user(:'a2');
select pg_temp.ck('E6 辞退後も年代表示のまま・状態declined', (select not (e ? 'age') and e->>'age_request_status'='declined' from (select pg_temp.entry(:'c0',:'t1') e) q));
select pg_temp.ck('E7 辞退した相手への再依頼は受け付けない（declinedのまま・新規作成なし）', (select r->>'status'='declined' and not (r->>'created')::boolean from (select request_stylist_age_disclosure(:'c0',:'t1') r) q));
select pg_temp.as_user(:'a1');
select pg_temp.ck('E8 辞退は他店舗の承認を取り消さない（b0は承認のまま）', (select (e->>'age')::int = 45 from (select pg_temp.entry(:'b0',:'t1') e) q));
-- 未回答
select pg_temp.ck('E9 t7（PRIVATE・興味あり済み）へ依頼できる／未回答は年代のまま', request_stylist_age_disclosure(:'b0',:'t7')->>'status'='pending');
select pg_temp.ck('E9b t7: 未回答は年代のまま（pending）', (select not (x ? 'age') and x->>'age_request_status'='pending' from jsonb_array_elements(get_store_stylist_age_infos(:'b0', array[:'t7']::uuid[])) x));
select pg_temp.ck('E10 受信拒否(t3)だが興味あり済みなら依頼でき、未回答は年代のまま', request_stylist_age_disclosure(:'b0',:'t3')->>'status'='pending');
select pg_temp.ck('E10b t3: 未回答は年代のまま', (select not (x ? 'age') and x->>'age_request_status'='pending' from jsonb_array_elements(get_store_stylist_age_infos(:'b0', array[:'t3']::uuid[])) x));
select pg_temp.as_pg();
select pg_temp.as_user(:'a1');
select pg_temp.ck('E11 非公開(PRIVATE)のt7は、承認前も一覧には出ない', (select count(*)=0 from jsonb_array_elements(get_public_stylists_for_scout(:'b0')) e where e->>'stylist_user_id'=:'t7'));
select pg_temp.as_pg();
-- t7が承認しても、一覧に出ない（非公開）。
select id as rid7 from age_disclosure_requests where store_id=:'b0' and stylist_user_id=:'t7' \gset
select pg_temp.as_user(:'t7');
select pg_temp.ck('E12 t7が承認', respond_age_disclosure_request(:'rid7'::uuid, true)->>'status'='approved');
select pg_temp.as_user(:'a1');
select pg_temp.ck('E13 承認後もPRIVATEのt7は一覧に出ない（承認は非公開設定を解除しない）', (select count(*)=0 from jsonb_array_elements(get_public_stylists_for_scout(:'b0')) e where e->>'stylist_user_id'=:'t7'));
select pg_temp.as_pg();

-- ===== F. 年齢の境界・未成年の保留（表示方法とは別の判定）=====
-- t4: 満16歳・年代表示 → 保留（年代表示でも回避できない）
select pg_temp.ck('F1 満16歳は年代表示でも公開不可', not stylist_salon_publishable(:'t4'::uuid));
update stylist_private set birth_date = pg_temp.yrs(18) where user_id=:'t4';
select pg_temp.ck('F2 今日が18歳の誕生日（満18歳ちょうど）→ 公開可', stylist_salon_publishable(:'t4'::uuid));
update stylist_private set birth_date = pg_temp.yrs(18) + 1 where user_id=:'t4';
select pg_temp.ck('F3 18歳の誕生日の前日まで（満17歳）→ 公開不可', not stylist_salon_publishable(:'t4'::uuid));
update stylist_private set birth_date = pg_temp.yrs(16) where user_id=:'t4';
insert into stylist_salon_interests (stylist_user_id, store_id) values (:'t4',:'b0');
-- 承認済みの依頼があっても、未成年の保留は解除されず、年齢も返さない
insert into age_disclosure_requests (store_id, stylist_user_id, requested_by, status, decided_at) values (:'b0', :'t4', :'a1', 'approved', now());
select pg_temp.as_user(:'a1');
select pg_temp.ck('F4 承認済み・興味あり済みでも、未成年(t4)は一覧に出ず、年齢情報は unavailable（age・年代なし）',
  (select count(*)=0 from jsonb_array_elements(get_public_stylists_for_scout(:'b0')) e where e->>'stylist_user_id'=:'t4')
  and (select x->>'age_request_status'='unavailable' and not (x ? 'age') and not (x ? 'age_decade') from jsonb_array_elements(get_store_stylist_age_infos(:'b0', array[:'t4']::uuid[])) x where x->>'stylist_user_id'=:'t4'));
select pg_temp.ck('F5 未成年(t4)への新規依頼・スカウトは不可', pg_temp.err($$select request_stylist_age_disclosure('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000204')$$) like '%not available%'
  and pg_temp.fails($$select send_scout_v2('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000204','はじめまして、ご連絡しました','casual')$$));
select pg_temp.as_pg();
-- フラグ解除（別承認の運営操作）でのみ公開可になる。解除後は承認済みなので年齢が出る
update feature_pauses set paused=false where feature='minor_salon_public';
insert into auth.users (id,email) values ('00000000-0000-0000-0000-000000000211','age211@example.test') on conflict do nothing;
insert into stylist_private (user_id, age_display_mode) values ('00000000-0000-0000-0000-000000000211','decade');
select pg_temp.ck('F5b フラグ解除中でも、生年月日が未登録なら（表示方法を選んでいても）公開不可', not stylist_salon_publishable('00000000-0000-0000-0000-000000000211'::uuid));
select pg_temp.as_user(:'a1');
select pg_temp.ck('F6 フラグ解除後は公開可・承認済みの店舗にだけ満16が出る', (select (e->>'age')::int=16 from (select pg_temp.entry(:'b0',:'t4') e) q) and (select not (e ? 'age') from (select pg_temp.entry(:'b1',:'t4') e) q));
select pg_temp.as_pg();
update feature_pauses set paused=true where feature='minor_salon_public';
-- 表示方法の切替: exact→decade でサロン向けの年齢が消える／decade→exact で全サロンに出る
select pg_temp.as_user(:'t2');
select pg_temp.ck('F7 t2が年代表示へ切替', not pg_temp.fails($$select set_stylist_age_display_mode('decade')$$));
select pg_temp.as_user(:'a1');
select pg_temp.ck('F8 切替後: 実年齢は消え、年代になる（未承認）', (select not (e ? 'age') and (e->>'age_decade')::int=20 and e->>'age_request_status'='none' from (select pg_temp.entry(:'b0',:'t2') e) q));
select pg_temp.as_user(:'t1');
select pg_temp.ck('F9 t1が実年齢表示へ切替', not pg_temp.fails($$select set_stylist_age_display_mode('exact')$$));
select pg_temp.as_user(:'a2');
select pg_temp.ck('F10 切替後: 他社にも実年齢が出る（本人が選んだ）', (select (e->>'age')::int=45 and e->>'age_request_status'='not_needed' from (select pg_temp.entry(:'c0',:'t1') e) q));
select pg_temp.as_pg();
select pg_temp.as_user(:'t1');
select pg_temp.ck('F12 再び年代表示へ戻すと、承認済みの店舗だけに実年齢が残る', not pg_temp.fails($$select set_stylist_age_display_mode('decade')$$));
select pg_temp.as_user(:'a1');
select pg_temp.ck('F13 戻した後: b0は承認済み(45)・b1は年代のみ', (select (e->>'age')::int=45 from (select pg_temp.entry(:'b0',:'t1') e) q) and (select not (e ? 'age') from (select pg_temp.entry(:'b1',:'t1') e) q));
select pg_temp.as_pg();

-- ===== G. スカウト・興味あり・既存機能 =====
select pg_temp.as_user(:'a1');
select pg_temp.ck('G1 公開してよい美容師(t1)へのスカウトは従来どおり送れる', not pg_temp.fails($$select send_scout_v2('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000201','はじめまして、ご連絡しました','casual')$$));
select pg_temp.ck('G2 未選択(t6)・未登録(t5は非公開に戻したので別)への直接スカウトは拒否', pg_temp.fails($$select send_scout_v2('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000206','はじめまして、ご連絡しました','casual')$$));
select pg_temp.as_pg();
select pg_temp.ck('G3 scoutsへ直接INSERT（postgres）でも、公開不可の美容師宛は拒否（旧画面・直接呼び出し対策）', pg_temp.err(format($$insert into scouts (salon_user_id, stylist_user_id, message) values (%L,%L,'x')$$, :'a1', :'t6')) like '%not publishable%');
select pg_temp.ck('G4 興味あり（stylist_salon_interests）は従来どおり（依頼・承認の有無と無関係に既存行が残る）', (select count(*)=2 from stylist_salon_interests where store_id=:'b0' and stylist_user_id in (:'t3',:'t7')));
select pg_temp.ck('G5 通知: 依頼の通知は同じ依頼で重複しない（unique制約）', (select count(*)=count(distinct related_entity_id) from notifications where type='age_disclosure_requested'));
-- 通知の種類制約に新種が通り、既存の種類も通る
select pg_temp.ck('G6 通知の種類: 既存(scout_received)も新規(age_disclosure_requested)も作成可', not pg_temp.fails(format($$insert into notifications(user_id,type,title,message) values (%L,'scout_received','t','m')$$, :'t1')) and (select count(*)>=1 from notifications where type='age_disclosure_requested'));
select pg_temp.ck('G7 通知の種類: 未知の種類は拒否', pg_temp.fails(format($$insert into notifications(user_id,type,title,message) values (%L,'unknown_type','t','m')$$, :'t1')));
-- 権限
select pg_temp.as_user(:'a1');
select pg_temp.ck('G8 直接のテーブル操作は不可（依頼表）', pg_temp.fails($$insert into age_disclosure_requests(store_id,stylist_user_id) values ('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000202')$$) and pg_temp.fails($$update age_disclosure_requests set status='approved'$$) and pg_temp.fails($$delete from age_disclosure_requests$$));
select pg_temp.ck('G9 内部関数は直接呼べない', pg_temp.fails($$select _stylist_age_info('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-000000000201')$$));
select pg_temp.as_pg();
select pg_temp.ck('G10 依頼表は利用者・service_roleに直接権限なし／RLS有効', not has_table_privilege('authenticated','public.age_disclosure_requests','select') and not has_table_privilege('service_role','public.age_disclosure_requests','insert') and (select relrowsecurity from pg_class where oid='public.age_disclosure_requests'::regclass));

\o
select ord, name, case when ok then 'PASS' else 'FAIL' end as result, detail from _r order by ord;
rollback;
