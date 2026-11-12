-- ============================================================================
-- 0057 補完の「実行直前の再確認」「実行後の確認」「誤補完の取り消し」
-- Supabase の SQL Editor で、ブロックごとに実行してください。
-- ============================================================================

-- ■ A. 【実行直前・読み取りのみ】補完される予定の店舗数（0057の補完条件と同一）
--     この件数が、監査SQL(audit-store-profiles.sql)の「A_補完可能」と一致することを確認してから0057を適用します。
select count(*) as will_be_backfilled
from public.salon_stores ss
join (
  select store_id, min(user_id::text)::uuid as user_id, min(organization_id::text)::uuid as organization_id
  from public.salon_onboarding_assignments
  group by store_id
  having count(*) = 1
) a on a.store_id = ss.id
join public.salon_profiles sp on sp.user_id = a.user_id
where not exists (select 1 from public.salon_store_profiles x where x.store_id = ss.id)
  and a.organization_id = ss.organization_id
  and (ss.legacy_salon_user_id is null or ss.legacy_salon_user_id = a.user_id);

-- ■ A2. 【実行直前・読み取りのみ】対象店舗の一覧（店舗名・旧プロフィールの公開設定・補完後の公開設定）
select ss.id as store_id, ss.store_name, sp.visibility as legacy_visibility,
       case when sp.visibility = 'PUBLIC' then 'PRIVATE' else sp.visibility::text end as visibility_after_backfill
from public.salon_stores ss
join (
  select store_id, min(user_id::text)::uuid as user_id, min(organization_id::text)::uuid as organization_id
  from public.salon_onboarding_assignments
  group by store_id
  having count(*) = 1
) a on a.store_id = ss.id
join public.salon_profiles sp on sp.user_id = a.user_id
where not exists (select 1 from public.salon_store_profiles x where x.store_id = ss.id)
  and a.organization_id = ss.organization_id
  and (ss.legacy_salon_user_id is null or ss.legacy_salon_user_id = a.user_id)
order by ss.store_name;

-- ■ A3. 【実行直前・読み取りのみ】現在の店舗プロフィール総数（適用後は +補完件数 になるはず）
select count(*) as total_store_profiles from public.salon_store_profiles;

-- ■ B. 【適用後・読み取りのみ】補完された件数（A の件数と同じになるはず）
select count(*) as backfilled_rows from public.salon_store_profile_backfill_0057;

-- ■ B2. 【適用後・読み取りのみ】補完行の現在の状態
--   状態1_未更新   : 作成時刻・更新時刻・保存列がすべて補完直後のまま（取り消し対象にできる）
--   状態2_更新あり : 補完後に1度でも更新された（値を元に戻した場合も、更新時刻が変わるためこちら。取り消し対象外）
--   状態3_作り直し : 削除されて作り直された（作成時刻が違う。取り消し対象外）
--   状態4_存在しない: 現在は店舗プロフィールが無い
select b.store_id, ss.store_name,
       case
         when p.store_id is null then '状態4_存在しない'
         when p.created_at <> b.row_created_at then '状態3_作り直し'
         when p.updated_at <> b.row_updated_at
              or md5(row(p.salon_name, p.visibility, p.prefecture, p.city, p.street_address, p.culture_description,
                         p.employee_size_code, p.target_specialties, p.bio, p.hotpepper_url)::text) <> b.content_hash
              then '状態2_更新あり'
         else '状態1_未更新'
       end as state,
       p.visibility as current_visibility, b.source_visibility as legacy_visibility_at_backfill
from public.salon_store_profile_backfill_0057 b
join public.salon_stores ss on ss.id = b.store_id
left join public.salon_store_profiles p on p.store_id = b.store_id
order by state, ss.store_name;

-- ■ C. 【誤補完の取り消し・変更あり】状態1（未更新）の補完行だけを削除する。
-- C1 確認（読み取りのみ）: 削除される店舗の一覧
select b.store_id, ss.store_name
from public.salon_store_profile_backfill_0057 b
join public.salon_store_profiles p on p.store_id = b.store_id
join public.salon_stores ss on ss.id = b.store_id
where p.created_at = b.row_created_at
  and p.updated_at = b.row_updated_at
  and md5(row(p.salon_name, p.visibility, p.prefecture, p.city, p.street_address, p.culture_description,
              p.employee_size_code, p.target_specialties, p.bio, p.hotpepper_url)::text) = b.content_hash;

-- C2 実行（削除。必要な場合だけ。コメントを外して実行します。特定の店舗だけにするときは
--         末尾に  and p.store_id in ('店舗ID')  を足してください）
-- begin;
-- delete from public.salon_store_profiles p
-- using public.salon_store_profile_backfill_0057 b
-- where b.store_id = p.store_id
--   and p.created_at = b.row_created_at
--   and p.updated_at = b.row_updated_at
--   and md5(row(p.salon_name, p.visibility, p.prefecture, p.city, p.street_address, p.culture_description,
--               p.employee_size_code, p.target_specialties, p.bio, p.hotpepper_url)::text) = b.content_hash
-- returning p.store_id, p.salon_name;
-- commit;
-- 注意: ・削除した店舗は「店舗プロフィール未作成」に戻る（旧プロフィールは影響を受けない）。
--       ・記録テーブルの行は残る（履歴）。削除後に0057の補完部分を再実行すると、同じ条件で再び補完され、
--         新しい作成時刻で作り直される（記録は更新されない＝以後は状態3として取り消し対象外になる）。
--       ・状態2・3の行は、このSQLでは削除されません。内容を確認のうえ、個別に判断してください。
