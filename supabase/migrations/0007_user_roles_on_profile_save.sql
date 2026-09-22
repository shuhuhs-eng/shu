-- ============================================================================
-- Beauty Reach — 0007_user_roles_on_profile_save
--
-- save_stylist_profile() / save_salon_profile() の成功時に、そのroleの
-- オンボーディング完了として user_roles へ記録するよう更新する。
-- 既存のパラメータ・戻り値・書き込み先テーブル・トランザクション範囲・
-- avatar検証・エラーハンドリングは一切変更しない（末尾にuser_roles書き込みを
-- 1文追加するのみ）。CREATE OR REPLACEのためシグネチャは変更していない。
-- ============================================================================

create or replace function public.save_stylist_profile(
  p_public_name           text,
  p_full_name             text,
  p_age_band              public.age_band,
  p_gender                public.gender_type,
  p_prefecture            text,
  p_desired_work_location text,
  p_experience_years      integer,
  p_current_position      text,
  p_specialties           text[],
  p_employment_type       public.employment_type,
  p_job_change_intent     public.job_change_intent,
  p_desired_salary_range  public.salary_band,
  p_sns_links             jsonb,
  p_bio                   text,
  p_visibility            public.profile_visibility,
  p_scout_enabled         boolean,
  p_avatar_path           text,
  p_value_priorities      text[]
) returns public.profiles
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_avatar_path text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  v_avatar_path := public.validate_and_normalize_avatar_path(v_uid, p_avatar_path);

  perform 1 from public.profiles where id = v_uid for update;

  insert into public.stylist_private (user_id, full_name, age_band, gender)
  values (v_uid, p_full_name, p_age_band, p_gender)
  on conflict (user_id) do update set
    full_name = excluded.full_name,
    age_band  = excluded.age_band,
    gender    = excluded.gender;

  insert into public.stylist_profiles (
    user_id, public_name, visibility, prefecture, desired_work_location,
    experience_years, current_position, specialties, employment_type,
    job_change_intent, desired_salary_range, sns_links, bio, value_priorities
  ) values (
    v_uid, p_public_name, p_visibility, p_prefecture, nullif(trim(p_desired_work_location), ''),
    p_experience_years, nullif(trim(p_current_position), ''), p_specialties, p_employment_type,
    p_job_change_intent, p_desired_salary_range, coalesce(p_sns_links, '[]'::jsonb),
    nullif(trim(p_bio), ''), p_value_priorities
  )
  on conflict (user_id) do update set
    public_name           = excluded.public_name,
    visibility             = excluded.visibility,
    prefecture             = excluded.prefecture,
    desired_work_location  = excluded.desired_work_location,
    experience_years       = excluded.experience_years,
    current_position       = excluded.current_position,
    specialties            = excluded.specialties,
    employment_type        = excluded.employment_type,
    job_change_intent      = excluded.job_change_intent,
    desired_salary_range   = excluded.desired_salary_range,
    sns_links              = excluded.sns_links,
    bio                    = excluded.bio,
    value_priorities       = excluded.value_priorities;

  insert into public.user_settings (user_id, scout_enabled)
  values (v_uid, p_scout_enabled)
  on conflict (user_id) do update set
    scout_enabled = excluded.scout_enabled;

  update public.profiles
    set avatar_path      = v_avatar_path,
        onboarding_step  = greatest(onboarding_step, 4),
        profile_version  = profile_version + 1
    where id = v_uid
    returning * into v_profile;

  -- 複数role対応: このRPCの成功＝美容師としてのオンボーディング完了を意味するため、
  -- user_rolesへ 'stylist' を記録する（既に存在すれば何もしない）。
  insert into public.user_roles (user_id, role)
  values (v_uid, 'stylist')
  on conflict (user_id, role) do nothing;

  return v_profile;
end;
$$;

create or replace function public.save_salon_profile(
  p_salon_name           text,
  p_prefecture           text,
  p_city                 text,
  p_street_address       text,
  p_culture_description  text,
  p_employee_size_code   text,
  p_target_specialties   text[],
  p_instagram_handle     text,
  p_bio                  text,
  p_visibility           public.profile_visibility,
  p_avatar_path          text
) returns public.profiles
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_avatar_path text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  v_avatar_path := public.validate_and_normalize_avatar_path(v_uid, p_avatar_path);

  -- 対象行をロックしてから更新する（同一ユーザーからの同時保存要求を直列化）。
  perform 1 from public.profiles where id = v_uid for update;

  insert into public.salon_profiles (
    user_id, salon_name, visibility, prefecture, city, street_address,
    culture_description, employee_size_code, target_specialties,
    instagram_handle, bio
  ) values (
    v_uid, p_salon_name, p_visibility, p_prefecture, nullif(trim(p_city), ''),
    nullif(trim(p_street_address), ''), nullif(trim(p_culture_description), ''),
    p_employee_size_code, p_target_specialties,
    nullif(trim(p_instagram_handle), ''), nullif(trim(p_bio), '')
  )
  on conflict (user_id) do update set
    salon_name           = excluded.salon_name,
    visibility            = excluded.visibility,
    prefecture            = excluded.prefecture,
    city                  = excluded.city,
    street_address        = excluded.street_address,
    culture_description   = excluded.culture_description,
    employee_size_code    = excluded.employee_size_code,
    target_specialties    = excluded.target_specialties,
    instagram_handle      = excluded.instagram_handle,
    bio                   = excluded.bio;

  update public.profiles
    set avatar_path      = v_avatar_path,
        -- ここまでの全ての書き込みに成功した場合のみ到達し、COMPLETEへ進む。
        -- 途中で例外が発生した場合はこのUPDATEも含め全てロールバックされる。
        onboarding_step  = greatest(onboarding_step, 4), -- 4 = ONBOARDING_STEP.COMPLETE（lib/auth/onboarding.tsと値を同期させること）
        profile_version  = profile_version + 1
    where id = v_uid
    returning * into v_profile;

  -- 複数role対応: このRPCの成功＝サロンとしてのオンボーディング完了を意味するため、
  -- user_rolesへ 'salon' を記録する（既に存在すれば何もしない）。
  insert into public.user_roles (user_id, role)
  values (v_uid, 'salon')
  on conflict (user_id, role) do nothing;

  return v_profile;
end;
$$;

