-- ローカル検証用の仮データ（本番では実行しない）。
\set ON_ERROR_STOP on
-- Supabase と同様に、public スキーマの新しい関数へ anon / authenticated / service_role の実行権が既定で付く状態にする
-- （本体が既定権限に頼らず明示的に外していることを検証するため）。
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
do $$
declare i int; u uuid;
begin
  for i in 1..11 loop
    u := ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid;
    insert into auth.users (id, email) values (u, 'u'||i||'@example.test') on conflict do nothing;
    insert into public.profiles (id) values (u) on conflict do nothing;
    insert into public.user_settings (user_id) values (u) on conflict do nothing;
  end loop;
end $$;
-- roles: 1-5 stylist, 5 も salon, 6,10,11 salon のみ
insert into public.user_roles (user_id, role) select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid, 'stylist' from generate_series(1,5) i on conflict do nothing;
insert into public.user_roles (user_id, role) select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid, 'salon' from unnest(array[5,6,10,11]) i on conflict do nothing;
-- stylist profiles
insert into public.stylist_profiles (user_id, public_name, visibility, prefecture, experience_years, current_position, specialties, employment_type, job_change_intent, desired_salary_range, sns_links, bio, value_priorities) values
 ('00000000-0000-0000-0000-000000000001','公開A','PUBLIC','神奈川県',5,'スタイリスト','{カット}','full_time','active', null, '[{"platform":"instagram","handle":"pub_a"}]','自己紹介A','{work_life,growth,income}'),
 ('00000000-0000-0000-0000-000000000002','非公開B','PRIVATE','東京都',3,'アシスタント','{カラー}','full_time','passive', null, '[{"platform":"instagram","handle":"priv_b"}]','自己紹介B','{work_life,growth,income}'),
 ('00000000-0000-0000-0000-000000000003','一部公開C','LIMITED','東京都',3,'アシスタント','{カラー}','full_time','passive', null, '[]','自己紹介C',null),
 ('00000000-0000-0000-0000-000000000004','公開D','PUBLIC','大阪府',8,'店長','{パーマ}','contract','passive', null, '[]','自己紹介D',null),
 ('00000000-0000-0000-0000-000000000005','両ロールE','PRIVATE','東京都',2,'アシスタント','{カット}','part_time','passive', null, '[]','自己紹介E',null);
-- 個人情報（氏名・性別・年代は既存のまま。birth_date は後で）
insert into public.stylist_private (user_id, full_name, age_band, gender) select user_id, '氏名'||right(user_id::text,2), '30_34', 'female' from public.stylist_profiles;
-- avatar（実在オブジェクト＋profiles.avatar_path）。s1,s2,s4 + 古い画像（s1の過去分）
insert into storage.objects (bucket_id, name, owner) values
 ('avatars','00000000-0000-0000-0000-000000000001/avatar.webp','00000000-0000-0000-0000-000000000001'),
 ('avatars','00000000-0000-0000-0000-000000000001/old.webp','00000000-0000-0000-0000-000000000001'),
 ('avatars','00000000-0000-0000-0000-000000000002/avatar.webp','00000000-0000-0000-0000-000000000002'),
 ('avatars','00000000-0000-0000-0000-000000000004/avatar.webp','00000000-0000-0000-0000-000000000004');
update public.profiles set avatar_path = id::text||'/avatar.webp' where id in ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004');
-- 既存の受信拒否: s4(美容師), s5(美容師+サロン), u6(サロンのみ)
update public.user_settings set scout_enabled=false, notify_email=false where user_id in ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006');
-- 既存の給与提示（履歴保持の確認用）。1行（トリガー適用前なので普通にINSERT）
insert into public.salary_offers (salon_user_id, stylist_user_id, monthly_guarantee, performance_addition, guarantee_months)
values ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001',300000,0,6);

-- 給与提示RPCの前提データ（店舗・メンバー・Interest・検証済みの実績プロフィール）。サロンa1が店舗に所属。
insert into public.salon_organizations (id, name) values ('00000000-0000-0000-0000-0000000000a0','検証会社');
insert into public.salon_stores (id, organization_id, store_name) values ('00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-0000000000a0','検証店舗');
insert into public.organization_members (organization_id, user_id, role) values ('00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-000000000010','company_owner');
insert into public.stylist_match_profiles (stylist_user_id, primary_goal, career_stage, evidence_period_months, avg_monthly_technical_sales, avg_monthly_clients, monthly_working_days) values ('00000000-0000-0000-0000-000000000004','income','results_stylist',6,800000,100,22);
update public.stylist_match_profiles set wants_performance_offer = true, verification_status = 'verified' where stylist_user_id='00000000-0000-0000-0000-000000000004';
insert into public.stylist_salon_interests (stylist_user_id, salon_user_id, store_id) values ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000b0');

-- ローカルのstorageスタブにはSupabase本番相当のschema/SELECT権限が無いため、検証用に付与（本番は付与済み）
grant usage on schema storage to authenticated, anon;
grant select on storage.objects to authenticated, anon;
