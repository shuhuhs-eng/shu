-- 適用後（読み取りのみ）。3つの結果を確認します。
-- 期待値: backfilled_rows=1 / 補完した店舗の current_visibility=PRIVATE・state=状態1_未更新 /
--         権限は下記コメントのとおり
-- (1) 補完記録の件数と、店舗プロフィール総数（直前確認の total_store_profiles + 1 になるはず）
select (select count(*) from public.salon_store_profile_backfill_0057) as backfilled_rows,
       (select count(*) from public.salon_store_profiles) as total_store_profiles_now;

-- (2) 補完した店舗の状態（非公開であること）
select b.store_id, ss.store_name,
       p.visibility as current_visibility,        -- 期待: PRIVATE
       b.source_visibility as legacy_visibility_at_backfill,  -- 期待: PUBLIC
       case when p.created_at = b.row_created_at and p.updated_at = b.row_updated_at
                 and md5(row(p.salon_name, p.visibility, p.prefecture, p.city, p.street_address, p.culture_description,
                             p.employee_size_code, p.target_specialties, p.bio, p.hotpepper_url)::text) = b.content_hash
            then '状態1_未更新' else '状態2以降_更新あり' end as state
from public.salon_store_profile_backfill_0057 b
join public.salon_stores ss on ss.id = b.store_id
left join public.salon_store_profiles p on p.store_id = b.store_id;

-- (3) 権限（関数・記録テーブル）
select 'update_salon_logo' as target,
       has_function_privilege('authenticated','public.update_salon_logo(text)','execute') as authenticated_ok,  -- 期待: true
       has_function_privilege('anon','public.update_salon_logo(text)','execute') as anon,                       -- 期待: false
       has_function_privilege('service_role','public.update_salon_logo(text)','execute') as service_role        -- 期待: false
union all
select 'save_salon_profile',
       has_function_privilege('authenticated','public.save_salon_profile(text,text,text,text,text,text,text[],text,text,public.profile_visibility,text,text)','execute'),  -- 期待: true（適用前と同じ）
       has_function_privilege('anon','public.save_salon_profile(text,text,text,text,text,text,text[],text,text,public.profile_visibility,text,text)','execute'),           -- 期待: false
       has_function_privilege('service_role','public.save_salon_profile(text,text,text,text,text,text,text[],text,text,public.profile_visibility,text,text)','execute');  -- 期待: false

select r as role,
       has_table_privilege(r,'public.salon_store_profile_backfill_0057','select') as can_select,   -- 期待: すべて false
       has_table_privilege(r,'public.salon_store_profile_backfill_0057','insert') as can_insert,
       has_table_privilege(r,'public.salon_store_profile_backfill_0057','update') as can_update,
       has_table_privilege(r,'public.salon_store_profile_backfill_0057','delete') as can_delete
from (values ('anon'),('authenticated'),('service_role')) v(r);

select c.relrowsecurity as rls_enabled,                                              -- 期待: true
       (select count(*) from pg_policies where schemaname='public' and tablename='salon_store_profile_backfill_0057') as policies  -- 期待: 0
from pg_class c where c.oid = 'public.salon_store_profile_backfill_0057'::regclass;
