-- ============================================================================
-- 0060（レビュー済み v2）: 運営の「会社・店舗」「美容師」一覧・詳細の読み取り専用RPC
-- ============================================================================
-- 目的: 運営者が、会社・店舗・登録担当者・美容師を検索して詳細を見られるようにする（読み取りのみ）。
-- 方針:
--   ・表・列・RLS・既存の権限は一切変更しない（新しい関数を足すだけ）。巻き戻しは関数のdropのみ。
--   ・公開RPCはすべて SECURITY DEFINER ＋ 先頭で is_platform_admin() を確認。search_path固定。
--   ・★実行権限は既存環境のデフォルト権限に依存しない: 作成直後に public/anon/authenticated/service_role から全て外し、
--     公開RPC5つだけを authenticated に付与する。内部補助関数は誰にも付与しない（所有者の関数内からのみ呼ばれる）。
--     service_role も付与しない（auth.uid() が無く、運営者判定に通らないため。明示的に外す）。
--   ・書き込みは行わない。診断の回答・結果の本文は返さない（美容師詳細は診断タイプ名と日時のみ）。
--   ・検索は strpos(lower(..)) の部分一致（%や_は特殊文字として働かない）。件数は 1〜100 に丸める。
-- v2 の変更点（レビュー指摘への対応）:
--   1) 店舗の条件（所在地・公開状態・利用状態）は【同一の店舗がすべて満たす】。別々の店舗が条件を分担しても当たらない。
--      会社内のどの店舗が条件に一致したか（matches_filter）、検索語に一致したか（matches_query）を店舗ごとに返す。
--   2) 美容師一覧は「登録アカウント」を基準にする（profiles.role='stylist' または user_roles に stylist）。
--      registration_state = completed（オンボーディング完了=user_roles記録あり）／in_progress（プロフィール行はあるが未完了）／
--      no_profile（アカウントのみ）。サロン・運営者のアカウントは除外（対象外ロールを混ぜない）。
--   3) 美容師の診断は mode='stylist' のみ。同時刻の結果は id でも並べて順序を固定。詳細も美容師アカウントか確認する。
--   4) 会社未作成のサロン登録者を確認する admin_list_salon_registrants_without_company を追加（読み取り専用）。
-- 見える範囲・見えない範囲（既存データ）:
--   ・会社一覧: salon_organizations に行がある会社のみ。会社が作られる前（サロン登録の途中）のアカウントは会社一覧には出ない
--     → admin_list_salon_registrants_without_company で確認する（profiles.role='salon' で会社・店舗の所属が無いアカウント）。
--   ・auth.users に profiles 行が無いアカウント（通常は発生しない）、profiles.role が未設定の既定値(stylist)のままの
--     サロン登録途中アカウントは、役割で区別できないため美容師一覧に混ざり得る（登録メタデータで role を決める現行設計の限界）。
-- 店舗の所在地: salon_store_profiles（美容師向け表示の元）を優先し、無ければ salon_stores の値。出どころは address_source で返す。
-- 会社の所在地: 本ファイルでは扱わない（0063で別に提案）。
begin;

-- ---- 内部補助関数（誰にも実行権限を付与しない） ----
create or replace function public._admin_known_prefectures() returns text[]
language sql immutable set search_path = public, pg_temp
as $$ select array['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県']::text[] $$;

-- 美容師アカウントか（登録アカウント基準）。profiles.role='stylist' または user_roles に stylist。サロン・運営者は除く。
create or replace function public._admin_is_stylist_account(p_user_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.profiles p where p.id = p_user_id and (
            p.role = 'stylist' or exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'stylist')))
     and not exists (select 1 from public.user_roles ur where ur.user_id = p_user_id and ur.role in ('salon', 'admin'))
     and not exists (select 1 from public.platform_admins pa where pa.user_id = p_user_id)
$$;

-- ---- 公開RPC ----
create or replace function public.admin_list_organizations(
  p_q text default null,
  p_prefectures text[] default null,
  p_include_unset boolean default false,
  p_visibility text default null,
  p_usage text default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(lower(trim(coalesce(p_q, ''))), '');
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_has_area boolean := (p_prefectures is not null and cardinality(p_prefectures) > 0) or coalesce(p_include_unset, false);
  v_has_store_filter boolean;
  v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_visibility is not null and p_visibility not in ('PUBLIC', 'PRIVATE') then raise exception 'invalid visibility'; end if;
  if p_usage is not null and p_usage not in ('active', 'inactive') then raise exception 'invalid usage'; end if;
  v_has_store_filter := v_has_area or p_visibility is not null or p_usage is not null;

  with st as (
    select s.id, s.organization_id, s.store_name, s.status, s.usage_status,
           sp.visibility::text as visibility,
           coalesce(nullif(trim(sp.prefecture), ''), nullif(trim(s.prefecture), '')) as prefecture,
           coalesce(nullif(trim(sp.city), ''), nullif(trim(s.city), '')) as city
    from public.salon_stores s
    left join public.salon_store_profiles sp on sp.store_id = s.id
  ),
  -- 店舗の条件は、1つの店舗がすべて満たすこと（所在地・公開状態・利用状態をAND）
  st2 as (
    select st.*,
           (not v_has_store_filter or (
              (not v_has_area
                 or (st.prefecture is not null and st.prefecture = any (coalesce(p_prefectures, '{}')))
                 or (coalesce(p_include_unset, false) and (st.prefecture is null or st.prefecture <> all (public._admin_known_prefectures()))))
              and (p_visibility is null or st.visibility = p_visibility)
              and (p_usage is null or st.usage_status = p_usage)
           )) as matches_filter,
           (v_q is not null and strpos(lower(st.store_name), v_q) > 0) as matches_query
    from st
  ),
  mem as (
    select om.organization_id, om.user_id, om.role, u.email::text as email, nullif(u.raw_user_meta_data->>'display_name', '') as name
    from public.organization_members om join auth.users u on u.id = om.user_id
  ),
  matched as (
    select o.*
    from public.salon_organizations o
    where (v_q is null
        or strpos(lower(o.name), v_q) > 0
        or exists (select 1 from st2 where st2.organization_id = o.id and st2.matches_query)
        or exists (select 1 from mem where mem.organization_id = o.id and (strpos(lower(mem.email), v_q) > 0 or strpos(lower(coalesce(mem.name, '')), v_q) > 0))
        or exists (select 1 from public.store_members sm join auth.users u on u.id = sm.user_id join public.salon_stores s on s.id = sm.store_id
                   where s.organization_id = o.id and (strpos(lower(u.email), v_q) > 0 or strpos(lower(coalesce(u.raw_user_meta_data->>'display_name', '')), v_q) > 0)))
      and (not v_has_store_filter or exists (select 1 from st2 where st2.organization_id = o.id and st2.matches_filter))
  ),
  page as (select * from matched order by created_at desc, id limit v_limit offset v_offset)
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'status', p.status, 'created_at', p.created_at,
        'store_count', (select count(*) from st2 where st2.organization_id = p.id),
        'matched_store_count', (select count(*) from st2 where st2.organization_id = p.id and st2.matches_filter and v_has_store_filter),
        'stores', coalesce((select jsonb_agg(jsonb_build_object('id', st2.id, 'name', st2.store_name, 'prefecture', st2.prefecture, 'city', st2.city,
                              'visibility', st2.visibility, 'usage_status', st2.usage_status,
                              'matches_filter', (v_has_store_filter and st2.matches_filter), 'matches_query', st2.matches_query) order by st2.store_name)
                            from st2 where st2.organization_id = p.id), '[]'::jsonb),
        'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', mem.user_id, 'role', mem.role, 'name', mem.name, 'email', mem.email) order by mem.role, mem.email)
                             from mem where mem.organization_id = p.id), '[]'::jsonb)
      ) order by p.created_at desc, p.id) from page p), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$$;

create or replace function public.admin_get_organization(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select jsonb_build_object(
    'organization', jsonb_build_object('id', o.id, 'name', o.name, 'status', o.status, 'created_at', o.created_at),
    'stores', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.store_name, 'status', s.status, 'usage_status', s.usage_status,
        'visibility', sp.visibility::text,
        'prefecture', coalesce(nullif(trim(sp.prefecture), ''), nullif(trim(s.prefecture), '')),
        'city', coalesce(nullif(trim(sp.city), ''), nullif(trim(s.city), '')),
        'address_source', case when nullif(trim(sp.prefecture), '') is not null then 'profile' when nullif(trim(s.prefecture), '') is not null then 'store' else null end,
        'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', sm.user_id, 'role', sm.role, 'name', nullif(u.raw_user_meta_data->>'display_name', ''), 'email', u.email::text) order by sm.role, u.email)
                             from public.store_members sm join auth.users u on u.id = sm.user_id where sm.store_id = s.id), '[]'::jsonb)
      ) order by s.store_name)
      from public.salon_stores s left join public.salon_store_profiles sp on sp.store_id = s.id
      where s.organization_id = o.id), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', om.user_id, 'role', om.role, 'name', nullif(u.raw_user_meta_data->>'display_name', ''), 'email', u.email::text, 'since', om.created_at) order by om.role, u.email)
                         from public.organization_members om join auth.users u on u.id = om.user_id where om.organization_id = o.id), '[]'::jsonb),
    'hiring_process_count', (select count(*) from public.store_hiring_processes p join public.salon_stores s on s.id = p.store_id where s.organization_id = o.id)
  ) into v_result
  from public.salon_organizations o where o.id = p_organization_id;
  if v_result is null then raise exception 'organization not found'; end if;
  return v_result;
end;
$$;

-- 会社が作られていないサロン登録者（登録途中を含む）。profiles.role='salon' または user_roles に salon があり、
-- 会社・店舗のどちらの所属も無いアカウント。運営者アカウントは除く。
create or replace function public.admin_list_salon_registrants_without_company(p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  with base as (
    select p.id as user_id, u.email::text as email, nullif(u.raw_user_meta_data->>'display_name', '') as name,
           u.email_confirmed_at is not null as email_confirmed, p.onboarding_step, p.created_at,
           exists (select 1 from public.salon_profiles sp where sp.user_id = p.id) as has_salon_profile
    from public.profiles p join auth.users u on u.id = p.id
    where (p.role = 'salon' or exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'salon'))
      and not exists (select 1 from public.platform_admins pa where pa.user_id = p.id)
      and not exists (select 1 from public.organization_members om where om.user_id = p.id)
      and not exists (select 1 from public.store_members sm where sm.user_id = p.id)
      and not exists (select 1 from public.salon_onboarding_assignments a where a.user_id = p.id)
  ), page as (select * from base order by created_at desc, user_id limit v_limit offset v_offset)
  select jsonb_build_object('total', (select count(*) from base),
    'rows', coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc, page.user_id) from page), '[]'::jsonb)) into v_result;
  return v_result;
end;
$$;

create or replace function public.admin_list_stylists(
  p_q text default null,
  p_residence_prefectures text[] default null,
  p_residence_unset boolean default false,
  p_desired_prefectures text[] default null,
  p_visibility text default null,
  p_state text default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(lower(trim(coalesce(p_q, ''))), '');
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_res_filter boolean := (p_residence_prefectures is not null and cardinality(p_residence_prefectures) > 0) or coalesce(p_residence_unset, false);
  v_des_filter boolean := p_desired_prefectures is not null and cardinality(p_desired_prefectures) > 0;
  v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_visibility is not null and p_visibility not in ('PUBLIC', 'PRIVATE') then raise exception 'invalid visibility'; end if;
  if p_state is not null and p_state not in ('completed', 'in_progress', 'no_profile') then raise exception 'invalid state'; end if;
  with base as (
    -- 登録アカウントを基準にする（プロフィール未作成・登録途中も一覧に残る）
    select p.id as user_id, u.email::text as email, p.onboarding_step, p.created_at as registered_at,
           sp.public_name, pr.full_name, sp.visibility::text as visibility,
           nullif(trim(sp.prefecture), '') as residence, nullif(trim(sp.desired_work_location), '') as desired,
           sp.experience_years, sp.job_change_intent::text as job_change_intent,
           case when exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'stylist') then 'completed'
                when sp.user_id is not null then 'in_progress'
                else 'no_profile' end as registration_state
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.stylist_profiles sp on sp.user_id = p.id
    left join public.stylist_private pr on pr.user_id = p.id
    where public._admin_is_stylist_account(p.id)
  ),
  matched as (
    select b.* from base b
    where (v_q is null or strpos(lower(coalesce(b.public_name, '')), v_q) > 0 or strpos(lower(coalesce(b.full_name, '')), v_q) > 0 or strpos(lower(b.email), v_q) > 0)
      and (p_visibility is null or b.visibility = p_visibility)
      and (p_state is null or b.registration_state = p_state)
      and (not v_res_filter
           or (b.residence = any (coalesce(p_residence_prefectures, '{}')))
           or (coalesce(p_residence_unset, false) and (b.residence is null or b.residence <> all (public._admin_known_prefectures()))))
      and (not v_des_filter or exists (select 1 from unnest(p_desired_prefectures) pf where b.desired is not null and strpos(b.desired, pf) > 0))
  ),
  page as (select * from matched order by registered_at desc, user_id limit v_limit offset v_offset)
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', p.user_id, 'public_name', p.public_name, 'full_name', p.full_name, 'email', p.email, 'visibility', p.visibility,
        'registration_state', p.registration_state, 'onboarding_step', p.onboarding_step,
        'residence_prefecture', p.residence, 'desired_work_location', p.desired,
        'experience_years', p.experience_years, 'job_change_intent', p.job_change_intent, 'created_at', p.registered_at,
        'diagnosis_type', (select d.type_name from public.diagnosis_results d where d.user_id = p.user_id and d.mode = 'stylist' order by d.created_at desc, d.id desc limit 1)
      ) order by p.registered_at desc, p.user_id) from page p), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$$;

create or replace function public.admin_get_stylist(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  -- 美容師アカウントのみ（サロン・運営者のIDは「見つからない」）
  if not public._admin_is_stylist_account(p_user_id) then raise exception 'stylist not found'; end if;
  select jsonb_build_object(
    'user_id', p.id, 'email', u.email::text, 'onboarding_step', p.onboarding_step, 'created_at', p.created_at,
    'registration_state', case when exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'stylist') then 'completed'
                               when sp.user_id is not null then 'in_progress' else 'no_profile' end,
    'full_name', pr.full_name, 'public_name', sp.public_name, 'visibility', sp.visibility::text,
    'residence_prefecture', nullif(trim(sp.prefecture), ''),
    'desired_work_location', nullif(trim(sp.desired_work_location), ''),
    'experience_years', sp.experience_years, 'current_position', sp.current_position, 'specialties', coalesce(sp.specialties, '{}'),
    'employment_type', sp.employment_type::text, 'job_change_intent', sp.job_change_intent::text, 'bio', sp.bio,
    'updated_at', sp.updated_at,
    'diagnosis', (select jsonb_build_object('type_id', d.type_id, 'type_name', d.type_name, 'diagnosed_at', d.created_at)
                  from public.diagnosis_results d where d.user_id = p.id and d.mode = 'stylist' order by d.created_at desc, d.id desc limit 1),
    'preference_status', (select pp.status::text from public.stylist_preference_profiles pp where pp.stylist_user_id = p.id),
    'evidence', (select coalesce(jsonb_object_agg(review_status, n), '{}'::jsonb)
                 from (select review_status, count(*) n from public.stylist_evidence_documents where stylist_user_id = p.id group by review_status) e),
    'hiring_processes', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'store_id', h.store_id, 'store_name', s.store_name, 'organization_name', o.name, 'status', h.status, 'source', h.source, 'updated_at', h.updated_at) order by h.updated_at desc, h.id desc)
                                  from public.store_hiring_processes h join public.salon_stores s on s.id = h.store_id join public.salon_organizations o on o.id = s.organization_id
                                  where h.stylist_user_id = p.id), '[]'::jsonb)
  ) into v_result
  from public.profiles p join auth.users u on u.id = p.id
  left join public.stylist_profiles sp on sp.user_id = p.id left join public.stylist_private pr on pr.user_id = p.id
  where p.id = p_user_id;
  if v_result is null then raise exception 'stylist not found'; end if;
  return v_result;
end;
$$;

-- ---- 実行権限（既存環境のデフォルト権限に依存しない） ----
-- まず全員・全ロールから外し、必要なものだけを付与する。
revoke all on function public._admin_known_prefectures() from public, anon, authenticated, service_role;
revoke all on function public._admin_is_stylist_account(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_organizations(text, text[], boolean, text, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.admin_get_organization(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_salon_registrants_without_company(integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_stylists(text, text[], boolean, text[], text, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.admin_get_stylist(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_organizations(text, text[], boolean, text, text, integer, integer) to authenticated;
grant execute on function public.admin_get_organization(uuid) to authenticated;
grant execute on function public.admin_list_salon_registrants_without_company(integer, integer) to authenticated;
grant execute on function public.admin_list_stylists(text, text[], boolean, text[], text, text, integer, integer) to authenticated;
grant execute on function public.admin_get_stylist(uuid) to authenticated;

commit;
