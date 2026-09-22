-- ============================================================================
-- Beauty Reach — 0003_stylist_onboarding_fields
--
-- 0001_init.sql（0002適用済みでも可）が適用済みの既存環境に対して、
-- Phase 1「美容師オンボーディング」で追加するフィールドを反映する差分マイグレーション。
--
-- 含む内容:
--   ・stylist_profiles へ sns_links(jsonb) / value_priorities(text[]) を追加
--   ・instagram_handle は非推奨化するが列自体は削除しない（既存データを破壊しない）
--   ・save_stylist_profile() を新シグネチャ（p_instagram_handle→p_sns_links に統合、
--     p_value_priorities を追加）で置き換え
--   ・上記に伴うREVOKE/GRANTの更新
--
-- 冪等性:
--   ・列追加は ADD COLUMN IF NOT EXISTS。
--   ・save_stylist_profile() はシグネチャが変わるため、旧シグネチャを
--     DROP FUNCTION IF EXISTS してから新シグネチャで CREATE する
--     （CREATE OR REPLACE は引数の型・個数が異なると同名の別関数として
--     追加されてしまい、旧関数が残留するため、明示的にDROPする）。
--   ・REVOKE/GRANTは新シグネチャに対して行うため、実行順序は
--     「旧関数のDROP → 新関数のCREATE → 新シグネチャへのREVOKE/GRANT」。
--
-- 前提: 0001_init.sql（stylist_profiles・save_stylist_profile()・
--   validate_and_normalize_avatar_path() 等）が適用済みであること。
-- ============================================================================

-- ---------- 1. 列の追加 -----------------------------------------------------
alter table public.stylist_profiles
  add column if not exists sns_links jsonb not null default '[]'::jsonb;

alter table public.stylist_profiles
  add column if not exists value_priorities text[]
    check (value_priorities is null or array_length(value_priorities, 1) = 3);

comment on column public.stylist_profiles.instagram_handle is '非推奨（sns_linksへ統合済み）。後方互換のため列自体は残すが、save_stylist_profile()は以後この列を書き込まない。';
comment on column public.stylist_profiles.sns_links is 'SNSアカウントのリンク集。[{"platform":"instagram","handle":"..."}] の形式のjsonb配列。プラットフォームを追加してもマイグレーション不要な拡張可能設計。現在UIで収集するのはInstagramのみ。';
comment on column public.stylist_profiles.value_priorities is '働き方・価値観の優先順位（候補約12項目から重要な3つを順位付きで選択）。配列の順序が優先順位を表す(0番目=第1優先)。3件ちょうどでなければ拒否する（部分入力は許可しない）。AIマッチング精度向上のためのシグナルとして利用する想定（Phase 5以降）。';

-- ---------- 2. save_stylist_profile() を新シグネチャで置き換え ------------
-- 旧シグネチャ（p_instagram_handle を含む17引数版）を明示的に削除してから、
-- 新シグネチャ（p_sns_links + p_value_priorities を含む18引数版）を作成する。
drop function if exists public.save_stylist_profile(
  text, text, public.age_band, public.gender_type, text, text, integer, text,
  text[], public.employment_type, public.job_change_intent, public.salary_band,
  text, text, public.profile_visibility, boolean, text
);

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

  return v_profile;
end;
$$;
comment on function public.save_stylist_profile is 'プロフィール保存の唯一の経路。stylist_private/stylist_profiles/user_settings/profiles(avatar_path,onboarding_step,profile_version)への書き込みを1トランザクションで行うSECURITY DEFINER関数。avatar検証・トランザクション範囲・profile_version/onboarding_step更新・エラーハンドリングはsave_salon_profile()と完全に同一構造。p_instagram_handleは廃止しp_sns_links(jsonb)に統合、p_value_priorities(text[]、ちょうど3件)を追加（Phase1美容師オンボーディング拡張分）。';

-- ---------- 3. 新シグネチャへのREVOKE/GRANT --------------------------------
revoke all on function public.save_stylist_profile(
  text, text, public.age_band, public.gender_type, text, text, integer, text,
  text[], public.employment_type, public.job_change_intent, public.salary_band,
  jsonb, text, public.profile_visibility, boolean, text, text[]
) from public;
revoke all on function public.save_stylist_profile(
  text, text, public.age_band, public.gender_type, text, text, integer, text,
  text[], public.employment_type, public.job_change_intent, public.salary_band,
  jsonb, text, public.profile_visibility, boolean, text, text[]
) from anon;
grant execute on function public.save_stylist_profile(
  text, text, public.age_band, public.gender_type, text, text, integer, text,
  text[], public.employment_type, public.job_change_intent, public.salary_band,
  jsonb, text, public.profile_visibility, boolean, text, text[]
) to authenticated;
