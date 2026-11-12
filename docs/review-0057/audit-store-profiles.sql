-- ============================================================================
-- 読み取り専用: 店舗プロフィール（salon_store_profiles）が未作成の店舗の洗い出し
-- 変更はしません（select のみ）。Supabase の SQL Editor でそのまま実行できます。
-- 個人情報（メール・氏名）は出しません。店舗名・店舗ID・分類・旧プロフィールの公開設定のみ。
-- ============================================================================

-- 1) 分類ごとの件数（まずこれを見てください）
with st as (
  select ss.id as store_id, ss.organization_id, ss.store_name, ss.legacy_salon_user_id
  from public.salon_stores ss
  where not exists (select 1 from public.salon_store_profiles sp where sp.store_id = ss.id)
),
asg as (
  select store_id, count(*) as n_users, min(user_id::text)::uuid as user_id
  from public.salon_onboarding_assignments
  group by store_id
),
classified as (
  select st.*,
         a.n_users, a.user_id as legacy_user_id,
         sp.visibility as legacy_visibility,
         case
           when a.store_id is null then 'C_対応なし（初期店舗ではない／対応表に無い）'
           when a.n_users > 1 then 'D_曖昧（1店舗に複数の旧ユーザー）'
           when st.legacy_salon_user_id is not null and st.legacy_salon_user_id <> a.user_id then 'D_曖昧（legacy_salon_user_id が不一致）'
           when not exists (select 1 from public.salon_onboarding_assignments x
                            where x.user_id = a.user_id and x.organization_id = st.organization_id) then 'D_曖昧（会社が不一致）'
           when sp.user_id is null then 'B_旧プロフィールなし'
           else 'A_補完可能（対応が一意）'
         end as category
  from st
  left join asg a on a.store_id = st.store_id
  left join public.salon_profiles sp on sp.user_id = a.user_id
)
select category, count(*) as stores,
       count(*) filter (where legacy_visibility = 'PUBLIC') as legacy_public,
       count(*) filter (where legacy_visibility = 'LIMITED') as legacy_limited,
       count(*) filter (where legacy_visibility = 'PRIVATE') as legacy_private
from classified
group by category
order by category;

-- 2) 店舗ごとの一覧（分類つき。件数が多い場合は limit を付けてください）
with st as (
  select ss.id as store_id, ss.organization_id, ss.store_name, ss.legacy_salon_user_id
  from public.salon_stores ss
  where not exists (select 1 from public.salon_store_profiles sp where sp.store_id = ss.id)
),
asg as (
  select store_id, count(*) as n_users, min(user_id::text)::uuid as user_id
  from public.salon_onboarding_assignments
  group by store_id
)
select st.store_id, st.store_name,
       (select count(*) from public.salon_stores s2 where s2.organization_id = st.organization_id) as stores_in_org,
       a.n_users as assigned_users,
       sp.visibility as legacy_visibility,
       case
         when a.store_id is null then 'C_対応なし'
         when a.n_users > 1 then 'D_曖昧'
         when st.legacy_salon_user_id is not null and st.legacy_salon_user_id <> a.user_id then 'D_曖昧'
         when not exists (select 1 from public.salon_onboarding_assignments x
                          where x.user_id = a.user_id and x.organization_id = st.organization_id) then 'D_曖昧'
         when sp.user_id is null then 'B_旧プロフィールなし'
         else 'A_補完可能'
       end as category
from st
left join asg a on a.store_id = st.store_id
left join public.salon_profiles sp on sp.user_id = a.user_id
order by category, st.store_name;

-- 3) 参考: 旧プロフィールはあるが、対応する店舗プロフィールが無い旧ユーザーの数
select count(*) as legacy_profiles_without_store_profile
from public.salon_profiles sp
where not exists (
  select 1 from public.salon_onboarding_assignments a
  join public.salon_store_profiles x on x.store_id = a.store_id
  where a.user_id = sp.user_id
);

-- 4) 参考: 初期店舗で、店舗プロフィールと旧プロフィールの内容が食い違っている数（補完では上書きしません）
select count(*) as initial_stores_diverged
from public.salon_onboarding_assignments a
join public.salon_store_profiles x on x.store_id = a.store_id
join public.salon_profiles sp on sp.user_id = a.user_id
where (x.salon_name, x.prefecture, x.city, x.street_address, x.culture_description, x.employee_size_code, x.target_specialties, x.bio, x.hotpepper_url, x.visibility)
      is distinct from
      (sp.salon_name, sp.prefecture, sp.city, sp.street_address, sp.culture_description, sp.employee_size_code, sp.target_specialties, sp.bio, sp.hotpepper_url, sp.visibility);

-- 5) 参考（写真の別作業用）: 写真を持つ旧ユーザー数と、その会社の店舗数
select count(distinct p.salon_user_id) as users_with_photos,
       count(distinct p.salon_user_id) filter (where
         (select count(*) from public.salon_stores s
            join public.salon_onboarding_assignments a on a.organization_id = s.organization_id
            where a.user_id = p.salon_user_id) = 1) as users_whose_org_has_single_store,
       count(distinct p.salon_user_id) filter (where
         not exists (select 1 from public.salon_onboarding_assignments a where a.user_id = p.salon_user_id)) as users_without_assignment
from public.salon_photos p;
