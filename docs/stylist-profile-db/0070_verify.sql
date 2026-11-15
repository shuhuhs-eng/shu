-- 0070 ローカル検証（本番では実行しない）。0070_fixture.sql 投入後・0070本体適用後に実行。
-- psql -v pre_md5=<適用前のsave_stylist_profile定義md5> で渡す。全体をROLLBACKし、結果表は最後に1つ。
\set ON_ERROR_STOP on
\o /dev/null
begin;
create temp table _r(ord serial, name text, ok boolean, detail text);
grant all on _r to public;
grant all on sequence _r_ord_seq to public;

create function pg_temp.ck(n text, ok boolean, d text default '') returns void language sql as
$$ insert into _r(name, ok, detail) values (n, coalesce(ok,false), d) $$;
create function pg_temp.as_user(u text) returns void language plpgsql as
$$ begin
  perform set_config('request.jwt.claim.sub', u, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_anon() returns void language plpgsql as
$$ begin perform set_config('request.jwt.claim.sub','',true); execute 'set local role anon'; end $$;
create function pg_temp.as_pg() returns void language plpgsql as
$$ begin execute 'reset role'; perform set_config('request.jwt.claim.sub','',true); end $$;
create function pg_temp.cnt(q text) returns bigint language plpgsql as
$$ declare n bigint; begin execute q into n; return n; exception when others then return 0; end $$;
-- 例外が出るか（出れば true）
create function pg_temp.err(q text) returns text language plpgsql as
$$ begin execute q; return 'OK'; exception when others then return sqlerrm; end $$;
create function pg_temp.as_pg_sub(u text) returns void language plpgsql as
$$ begin execute 'reset role'; perform set_config('request.jwt.claim.sub', u, true); end $$;
-- 例外が出るか（出れば true）
create function pg_temp.fails(q text) returns boolean language plpgsql as
$$ begin execute q; return false; exception when others then return true; end $$;

\set s1 '00000000-0000-0000-0000-000000000001'
\set s2 '00000000-0000-0000-0000-000000000002'
\set s3 '00000000-0000-0000-0000-000000000003'
\set s4 '00000000-0000-0000-0000-000000000004'
\set s5 '00000000-0000-0000-0000-000000000005'
\set u6 '00000000-0000-0000-0000-000000000006'
\set a1 '00000000-0000-0000-0000-000000000010'
\set a2 '00000000-0000-0000-0000-000000000011'

-- ===== A. スカウト移行（適用直後の状態。ここでは postgres）=====
select pg_temp.ck('A1 美容師s4のscout_enabledがtrueになった', (select scout_enabled from user_settings where user_id=:'s4'));
select pg_temp.ck('A2 美容師+サロンs5もtrue（美容師ロールあり）', (select scout_enabled from user_settings where user_id=:'s5'));
select pg_temp.ck('A3 サロンのみu6はfalseのまま（対象外）', (select scout_enabled=false from user_settings where user_id=:'u6'));
select pg_temp.ck('A4 notify_email は変更されていない(s4,s5,u6=false)', (select count(*)=3 from user_settings where user_id in (:'s4',:'s5',:'u6') and notify_email=false));
select pg_temp.ck('A5 退避表はs4,s5のみ', (select array_agg(user_id::text order by user_id::text) = array[:'s4',:'s5'] from scout_optout_migration_0070));
select pg_temp.ck('A6 visibility不変(s1 PUBLIC,s2 PRIVATE,s3 LIMITED,s4 PUBLIC,s5 PRIVATE)',
  (select string_agg(visibility::text, ',' order by user_id) = 'PUBLIC,PRIVATE,LIMITED,PUBLIC,PRIVATE' from stylist_profiles));
select pg_temp.ck('A7 save_stylist_profileの定義は無変更', (select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.oid)) = :'pre_md5' from pg_proc p where p.proname='save_stylist_profile' and p.pronamespace='public'::regnamespace));

-- ===== B. 生年月日 =====
select pg_temp.ck('B1 既存会員のbirth_dateは全員NULL（推測しない）', (select count(*)=0 from stylist_private where birth_date is not null));
select pg_temp.as_user(:'s1');
select pg_temp.ck('B2 本人は生年月日を保存できる', not pg_temp.fails($$select set_stylist_birth_date('1995-06-15')$$));
select pg_temp.ck('B3 本人は自分の生年月日を読める', (select birth_date='1995-06-15' from stylist_private where user_id=:'s1'));
select pg_temp.ck('B4 直接UPDATEは不可', pg_temp.fails($$update stylist_private set birth_date='1990-01-01'$$));
select pg_temp.ck('B5 未来日は拒否', pg_temp.fails($$select set_stylist_birth_date((now() at time zone 'Asia/Tokyo')::date + 1)$$));
select pg_temp.ck('B6 満14歳は拒否', pg_temp.fails($$select set_stylist_birth_date(((now() at time zone 'Asia/Tokyo')::date - interval '14 years')::date)$$));
select pg_temp.ck('B7 満101歳は拒否', pg_temp.fails($$select set_stylist_birth_date(((now() at time zone 'Asia/Tokyo')::date - interval '101 years 1 day')::date)$$));
select pg_temp.ck('B8 満15歳ちょうどは可', not pg_temp.fails($$select set_stylist_birth_date(((now() at time zone 'Asia/Tokyo')::date - interval '15 years')::date)$$));
select pg_temp.ck('B9 年齢の内部関数は直接呼べない', pg_temp.fails($$select stylist_age_years('1990-01-01')$$));
select pg_temp.as_user(:'s2');
select pg_temp.ck('B10 他人の生年月日は読めない(RLS)', (select count(*)=0 from stylist_private where user_id=:'s1'));
select pg_temp.ck('B11 s2も保存可（非公開でも本人は登録できる）', not pg_temp.fails($$select set_stylist_birth_date('1992-02-02')$$));
select pg_temp.as_anon();
select pg_temp.ck('B12 anonは実行不可', pg_temp.fails($$select set_stylist_birth_date('1990-01-01')$$));
select pg_temp.as_pg();
-- 誕生日の境界（年齢計算）
select pg_temp.ck('B13 今日が誕生日なら満年齢が上がる/明日なら上がらない',
  (select stylist_age_years(((now() at time zone 'Asia/Tokyo')::date - interval '30 years')::date) = 30
      and stylist_age_years(((now() at time zone 'Asia/Tokyo')::date - interval '30 years' + interval '1 day')::date) = 29));
-- s1を 1995-06-15 に戻す（B8で上書きしたため）
update stylist_private set birth_date='1995-06-15', age_display_mode='exact' where user_id=:'s1';
select pg_temp.ck('B14 save_stylist_profile実行後も生年月日が保持される', (
  select true from (select pg_temp.as_user(:'s1')) x where true) and
  not pg_temp.fails($$select save_stylist_profile('公開A','氏名01','30_34','female','神奈川県',null,5,'スタイリスト','{カット}','full_time','active',null,'[{"platform":"instagram","handle":"pub_a"}]','自己紹介A','PUBLIC',true,'00000000-0000-0000-0000-000000000001/avatar.webp','{work_life,growth,income}')$$));
select pg_temp.as_pg();
select pg_temp.ck('B15 保存後もbirth_date=1995-06-15', (select birth_date='1995-06-15' from stylist_private where user_id=:'s1'));

-- 本人が表示方法を選択（確定方針: 未選択の既存会員は非公開のまま。s1=実年齢 / s4=年代）
select pg_temp.ck('B16 既存会員の表示方法は全員未選択（勝手に設定しない）', (select count(*)=0 from stylist_private where age_display_mode is not null and user_id <> :'s1'));  -- s1だけは直前のB14で保存関数の前提として選択済み
select pg_temp.as_user(:'s1');
select pg_temp.ck('B17 s1: 実年齢表示を選択できる', not pg_temp.fails($$select set_stylist_age_display_mode('exact')$$));
select pg_temp.as_user(:'s4');
select pg_temp.ck('B18 s4: 生年月日(1990-03-03)を登録', not pg_temp.fails($$select set_stylist_birth_date('1990-03-03')$$));
select pg_temp.ck('B19 s4: 年代表示を選択できる', not pg_temp.fails($$select set_stylist_age_display_mode('decade')$$));
select pg_temp.as_pg();
select pg_temp.ck('B20 生年月日が未登録のs2,s3,s5は、表示方法の選択が無く公開判定は false', not stylist_salon_publishable(:'s3'::uuid) and not stylist_salon_publishable(:'s2'::uuid) and not stylist_salon_publishable(:'s5'::uuid));

-- ===== C. サロン向け一覧 =====
select pg_temp.as_user(:'a1');
create temp table _list on commit drop as select jsonb_array_elements(get_public_stylists_for_scout()) as j;
grant all on _list to public;
select pg_temp.ck('C1 返るのはPUBLICの2人(s1,s4)だけ', (select array_agg(j->>'public_name' order by j->>'public_name') = array['公開A','公開D'] from _list));
select pg_temp.ck('C2 s1: 年齢が満年齢', (select (j->>'age')::int = extract(year from age((now() at time zone 'Asia/Tokyo')::date, date '1995-06-15'))::int from _list where j->>'public_name'='公開A'));
select pg_temp.ck('C3 s1: 画像パス/雇用形態/Instagram/大切にしたいこと', (select j->>'avatar_path' = :'s1'||'/avatar.webp' and j->>'employment_type'='full_time' and j->>'instagram_handle'='pub_a' and j->'value_priorities'='["work_life","growth","income"]'::jsonb from _list where j->>'public_name'='公開A'));
select pg_temp.ck('C4 s4(年代表示): 年代だけ。ageのキーも生年月日も無い', (select (j->>'age_decade')::int = (extract(year from age((now() at time zone 'Asia/Tokyo')::date, date '1990-03-03'))::int/10)*10 and not (j ? 'age') and j->>'age_display_mode'='decade' and j->>'age_request_status'='none' and j::text not like '%1990%' from _list where j->>'public_name'='公開D'));
select pg_temp.ck('C4b s1(実年齢表示): age・年代・not_needed', (select (j->>'age_decade')::int = ((j->>'age')::int/10)*10 and j->>'age_display_mode'='exact' and j->>'age_request_status'='not_needed' from _list where j->>'public_name'='公開A'));
select pg_temp.ck('C5 氏名・性別・年代・生年月日・年収・SNS生データは返さない', (select count(*)=0 from _list, jsonb_object_keys(j) k where k in ('full_name','gender','age_band','birth_date','desired_salary_range','sns_links','email')));
select pg_temp.ck('C6 氏名の文字列自体も含まれない', (select count(*)=0 from _list where j::text like '%氏名0%'));
select pg_temp.as_pg();
-- 公開→非公開にしたら年齢ごと出ない
update stylist_profiles set visibility='PRIVATE' where user_id=:'s1';
select pg_temp.as_user(:'a1');
select pg_temp.ck('C7 s1を非公開にすると一覧から消える（年齢も出ない）', (select count(*)=1 and bool_and(j->>'public_name'='公開D') from (select jsonb_array_elements(get_public_stylists_for_scout()) j) q));
select pg_temp.as_user(:'s2');
select pg_temp.ck('C8 美容師は一覧を呼べない', pg_temp.fails($$select get_public_stylists_for_scout()$$));
select pg_temp.as_anon();
select pg_temp.ck('C9 anonは呼べない', pg_temp.fails($$select get_public_stylists_for_scout()$$));
select pg_temp.as_pg();
update stylist_profiles set visibility='PUBLIC' where user_id=:'s1';
-- 従来の受信拒否が残っていた場合の挙動（参考）: 退避表の人を false に戻すと一覧から消える＝移行しないと選択欄が無い人は届かない
update user_settings set scout_enabled=false where user_id=:'s4';
select pg_temp.as_user(:'a1');
select pg_temp.ck('C10 （参考）scout_enabled=falseなら一覧から出る＝移行が必要な理由', (select count(*)=1 from (select jsonb_array_elements(get_public_stylists_for_scout()) j) q));
select pg_temp.as_pg();
update user_settings set scout_enabled=true where user_id=:'s4';

-- ===== C2. 保存範囲と公開条件は別（未成年のサロン公開は保留フラグで止める） =====
select pg_temp.ck('C11 保留フラグ既定はpaused=true', (select paused from feature_pauses where feature='minor_salon_public'));
select pg_temp.as_pg();
insert into stylist_private (user_id, birth_date) values (:'s4', ((now() at time zone 'Asia/Tokyo')::date - interval '16 years')::date)
  on conflict (user_id) do update set birth_date = excluded.birth_date;
select pg_temp.ck('C13 満16歳は保存できる範囲（15〜100）にいる', (select stylist_age_years(birth_date)=16 from stylist_private where user_id=:'s4'));
select pg_temp.ck('C14 満16歳は「公開不可」判定（保留中）', not stylist_salon_publishable(:'s4'::uuid));
select pg_temp.as_user(:'a1');
select pg_temp.ck('C15 満16歳のs4は一覧に出ない（s1だけ）', (select count(*)=1 and bool_and(j->>'public_name'='公開A') from (select jsonb_array_elements(get_public_stylists_for_scout()) j) q));
select pg_temp.as_pg();
update stylist_private set birth_date = ((now() at time zone 'Asia/Tokyo')::date - interval '18 years')::date where user_id=:'s4';
select pg_temp.ck('C16 満18歳は公開可', stylist_salon_publishable(:'s4'::uuid));
update stylist_private set birth_date = ((now() at time zone 'Asia/Tokyo')::date - interval '18 years' + interval '1 day')::date where user_id=:'s4';
select pg_temp.ck('C17 18歳の誕生日の前日までは未成年（公開不可）', not stylist_salon_publishable(:'s4'::uuid));
update stylist_private set birth_date = ((now() at time zone 'Asia/Tokyo')::date - interval '16 years')::date where user_id=:'s4';
update feature_pauses set paused=false where feature='minor_salon_public';
select pg_temp.ck('C18 フラグ解除で満16歳も公開可（解除は別承認の運営操作）', stylist_salon_publishable(:'s4'::uuid));
delete from feature_pauses where feature='minor_salon_public';
select pg_temp.ck('C19 フラグ行が無い場合も保留（安全側）', not stylist_salon_publishable(:'s4'::uuid));
insert into feature_pauses (feature, paused, reason) values ('minor_salon_public', true, '復元');
select pg_temp.ck('C20 登録済みの生年月日をNULLへ戻す更新は拒否（postgresでも）', pg_temp.err($$update stylist_private set birth_date = null where user_id='00000000-0000-0000-0000-000000000004'$$) like '%cannot be cleared%');
update stylist_private set birth_date = '1990-03-03' where user_id=:'s4';
select pg_temp.ck('C20b 成人に戻すと公開可', stylist_salon_publishable(:'s4'::uuid));
select pg_temp.ck('C21 公開判定の補助関数は誰にも直接実行させない', not has_function_privilege('authenticated','public.stylist_salon_publishable(uuid)','execute') and not has_function_privilege('anon','public.stylist_salon_publishable(uuid)','execute') and not has_function_privilege('service_role','public.stylist_salon_publishable(uuid)','execute'));

-- ===== D. 画像の閲覧権限 =====
select pg_temp.as_user(:'a1');
select pg_temp.ck('D1 サロンは公開美容師の現在の画像だけ読める(s1,s4)', (select array_agg(name order by name) = array[:'s1'||'/avatar.webp', :'s4'||'/avatar.webp'] from storage.objects where bucket_id='avatars'));
select pg_temp.as_pg();
update stylist_profiles set visibility='PRIVATE' where user_id=:'s1';
select pg_temp.as_user(:'a1');
select pg_temp.ck('D2 非公開にするとその画像は読めない', (select count(*)=1 and min(name)=:'s4'||'/avatar.webp' from storage.objects where bucket_id='avatars'));
select pg_temp.as_pg();
update stylist_profiles set visibility='PUBLIC' where user_id=:'s1';
select pg_temp.as_user(:'s1');
select pg_temp.ck('D3 美容師は他の美容師の画像を読めない（自分の2枚のみ）', (select array_agg(name order by name) = array[:'s1'||'/avatar.webp', :'s1'||'/old.webp'] from storage.objects where bucket_id='avatars'));
select pg_temp.as_anon();
select pg_temp.ck('D4 anonは読めない', pg_temp.cnt($$select count(*) from storage.objects where bucket_id='avatars'$$)=0, 'anonは既存ポリシーでも権限エラー or 0件');
select pg_temp.as_user(:'a1');
select pg_temp.ck('D5 サロンから見て「古い画像(old.webp)」は読めない', (select count(*)=0 from storage.objects where name like '%old.webp'));
select pg_temp.ck('D6 補助関数はサロンのみ・公開のみtrue', salon_can_view_stylist_avatar(:'s1'||'/avatar.webp') and not salon_can_view_stylist_avatar(:'s2'||'/avatar.webp') and not salon_can_view_stylist_avatar(:'s1'||'/old.webp'));
select pg_temp.as_pg();

-- ===== E. 給与提示の停止 =====
select pg_temp.ck('E1 既存の提示(1件)は残っている', (select count(*)=1 from salary_offers));
select pg_temp.ck('E2 直接INSERTは停止中で拒否', pg_temp.fails($$insert into salary_offers (salon_user_id, stylist_user_id, monthly_guarantee, performance_addition, guarantee_months) values ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000004',300000,0,3)$$));
select pg_temp.as_user(:'a1');
select pg_temp.as_pg();
select pg_temp.ck('E4 既存の提示は更新できる（応答・履歴は止めない）', not pg_temp.fails($$update salary_offers set status='declined', responded_at=now()$$));
select pg_temp.as_user(:'s1');
select pg_temp.ck('E5 美容師は自分宛の既存提示を読める', (select count(*)=1 from salary_offers));
select pg_temp.as_pg();
update feature_pauses set paused=false where feature='salary_offer_presentation';
select pg_temp.ck('E6 停止フラグをfalseにするとINSERTできる（再開）', not pg_temp.fails($$insert into salary_offers (salon_user_id, stylist_user_id, monthly_guarantee, performance_addition, guarantee_months) values ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000004',300000,0,3)$$));
delete from feature_pauses where feature='salary_offer_presentation';
select pg_temp.ck('E7 フラグ行が無い場合も停止（安全側）', pg_temp.fails($$insert into salary_offers (salon_user_id, stylist_user_id, monthly_guarantee, performance_addition, guarantee_months) values ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001',300000,0,3)$$));
select pg_temp.as_user(:'a1');
select pg_temp.ck('E8 feature_pausesは利用者から読み書き不可', pg_temp.fails($$select * from feature_pauses$$) and pg_temp.fails($$update feature_pauses set paused=false$$));
select pg_temp.as_pg();


-- ===== G. 給与提示RPC（新旧）: 前提を満たした呼び出しが「今回の停止」を理由に拒否されること =====
-- 前提: サロンa1は会社の所有者(店舗b0にアクセス可)・Interest済み(s4→a1/b0)・s4は検証済みの実績プロフィール。
-- 停止フラグを一時的に解除すると成功する（＝前提は満たしている）ことを先に示し、停止中は停止メッセージで拒否されることを確認する。
-- 店舗なし等の別エラーは「拒否」とは数えない（メッセージが停止のものと完全一致したときだけPASS）。
\set v2call '$$select create_salary_offer_v2(''00000000-0000-0000-0000-0000000000b0'',''00000000-0000-0000-0000-000000000004'',300000,0,3,null,null)$$'
\set legacycall '$$select create_salary_offer(''00000000-0000-0000-0000-000000000004'',300000,0,3,null,null)$$'
select pg_temp.as_pg();
insert into feature_pauses (feature, paused) values ('salary_offer_presentation', false) on conflict (feature) do update set paused=false; -- (E7で行を消したため作り直す)
savepoint g1;
select pg_temp.as_user(:'a1');
select pg_temp.err(:v2call) as g1 \gset
rollback to savepoint g1;
select pg_temp.as_pg();
select pg_temp.ck('G1 前提確認(新): 停止解除なら create_salary_offer_v2 が成功する', :'g1'='OK', :'g1');
select pg_temp.as_pg();
savepoint g2;
select pg_temp.as_pg_sub(:'a1');
select pg_temp.err(:legacycall) as g2 \gset
rollback to savepoint g2;
select pg_temp.as_pg();
select pg_temp.ck('G2 前提確認(旧): 停止解除なら create_salary_offer が成功する', :'g2'='OK', :'g2');
select pg_temp.as_pg();
update feature_pauses set paused=true where feature='salary_offer_presentation';
select count(*) as before_n from salary_offers \gset
select pg_temp.as_user(:'a1');
select pg_temp.ck('G3 停止中(新): create_salary_offer_v2 が「停止」を理由に拒否', pg_temp.err(:v2call)='salary offer presentation is currently paused', pg_temp.err(:v2call));
select pg_temp.as_pg();
select pg_temp.as_pg_sub(:'a1');
select pg_temp.ck('G4 停止中(旧): create_salary_offer が「停止」を理由に拒否', pg_temp.err(:legacycall)='salary offer presentation is currently paused', pg_temp.err(:legacycall));
select pg_temp.as_pg();
select pg_temp.ck('G5 拒否された提示は保存されていない', (select count(*)=:before_n from salary_offers));
-- 対照: 前提を欠く呼び出し（店舗なし）は停止メッセージではなく別エラー＝この検証では「拒否」に数えない
select pg_temp.as_user(:'a1');
select pg_temp.ck('G6 対照: 店舗未登録の呼び出しは別のエラー（停止理由ではない）', pg_temp.err($$select create_salary_offer_v2('00000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000004',300000,0,3,null,null)$$) <> 'salary offer presentation is currently paused');
select pg_temp.as_pg();

-- ===== H. 公開プロフィールの追加表示フラグ（停止＝サロンにも本人プレビューにも出ない） =====
select pg_temp.as_user(:'s1');
select pg_temp.ck('H1 有効時: 本人プレビュー用の判定が true', get_stylist_public_extended_enabled());
select pg_temp.as_pg();
update feature_pauses set paused=true where feature='stylist_public_extended';
select pg_temp.as_user(:'s1');
select pg_temp.ck('H2 停止時: 本人プレビュー用の判定が false（生年月日の列は残っていても）', not get_stylist_public_extended_enabled() and (select count(*)=1 from information_schema.columns where table_name='stylist_private' and column_name='birth_date'));
select pg_temp.as_user(:'a1');
select pg_temp.ck('H3 停止時: サロン向け一覧に追加項目が無い（従来の項目だけ）', (select count(*)>0 and bool_and(not (j ? 'age') and not (j ? 'age_display_mode') and not (j ? 'age_decade') and not (j ? 'avatar_path') and not (j ? 'employment_type') and not (j ? 'instagram_handle') and not (j ? 'value_priorities') and (j ? 'public_name') and (j ? 'bio')) from (select jsonb_array_elements(get_public_stylists_for_scout()) j) q));
select pg_temp.ck('H4 停止時: サロンは画像を読めない', (select count(*)=0 from storage.objects where bucket_id='avatars'));
select pg_temp.as_anon();
select pg_temp.ck('H5 anonは判定関数を呼べない', pg_temp.fails($$select get_stylist_public_extended_enabled()$$));
select pg_temp.as_pg();
delete from feature_pauses where feature='stylist_public_extended';
select pg_temp.ck('H6 フラグ行が無い場合も無効（安全側）', not stylist_public_extended_enabled());
insert into feature_pauses (feature, paused) values ('stylist_public_extended', false);
select pg_temp.as_user(:'a1');
select pg_temp.ck('H7 再開後: 追加項目が戻る', (select count(*)>0 and bool_and((j ? 'age_display_mode') and (j ? 'avatar_path')) from (select jsonb_array_elements(get_public_stylists_for_scout()) j) q));
select pg_temp.as_pg();

-- ===== F. 権限 =====
select pg_temp.as_user(:'a1');
select pg_temp.ck('F1 退避表は利用者から読めない', pg_temp.fails($$select * from scout_optout_migration_0070$$));
select pg_temp.as_pg();
select pg_temp.ck('F2 service_roleもfeature_pauses/退避表に触れない', not has_table_privilege('service_role','public.feature_pauses','select') and not has_table_privilege('service_role','public.scout_optout_migration_0070','select'));
select pg_temp.ck('F3 新設関数の実行権限: anon・service_role・PUBLICから外れ、必要な関数だけauthenticated（既定権限に依存しない）', coalesce((select bool_and(coalesce(g.grants, '{}'::text[]) = e.expected::text[] and to_regprocedure(e.sig) is not null) from (values
 ('public.set_stylist_birth_date(date)','{authenticated}'),
 ('public.get_public_stylists_for_scout(uuid)','{authenticated}'),
 ('public.set_stylist_age_display_mode(text)','{authenticated}'),
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
 ('public.block_salary_offer_insert_when_paused()','{}')
) as e(sig, expected)
 left join lateral (select array_agg(x.gr order by x.gr) as grants from (select distinct case when a.grantee = 0 then 'PUBLIC' else r.rolname::text end as gr
   from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a left join pg_roles r on r.oid = a.grantee
   where p.oid = to_regprocedure(e.sig) and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or r.rolname in ('anon','authenticated','service_role'))) x) g on true), false));
select pg_temp.ck('F4 authenticatedは生年月日・表を直接書けない', not has_table_privilege('authenticated','public.stylist_private','update') and not has_table_privilege('authenticated','public.stylist_private','insert'));
select pg_temp.ck('F5 既存のavatarポリシー(本人4本+サロンロゴ1本)＋新規1本', (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'avatars_%') = 6);

\o
select ord, name, case when ok then 'PASS' else 'FAIL' end as result, detail from _r order by ord;
rollback;
