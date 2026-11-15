-- ============================================================================
-- 0073（草案・未適用）: 「いまの立場」を必須にする（追加のみ。旧経路はまだ閉じない）
-- ============================================================================
-- 仕様: 選択肢は「新卒(new_graduate)」「現役の美容師(experienced)」「ブランクあり(blank)」の3つだけ。美容学生(student)・未設定(NULL)は新しく書けない。
--       プロフィールと立場は「別々に保存できない」: プロフィール保存と同じ1トランザクションで保存する新関数 save_stylist_profile_v3 を追加する。
-- ★追加のみ・既存を壊さない: 既存の関数（save_stylist_profile / _v2 / set_stylist_career_phase）は変更しない。旧経路を閉じるのは 0074（アプリを v3 に切り替えたあとに適用）。
-- ★適用済みの 0058〜0071 のSQLは編集しない。0071 が作った制約は、この草案が名前を指定して置き換える（下記）。
-- ★既存の「未設定(NULL)」「美容学生(student)」のデータは勝手に変更しない（有効な旧値のまま残る）。本人の次回のプロフィール保存で、3択から選び直してもらう。
-- ★診断の採点・回数制限・マッチング計算・診断履歴には触れない（career_phase は診断関数から参照されない）。
-- 前提: 0071 適用済み（career_phase 等の列）、0070 適用済み（save_stylist_profile_v2）。
begin;
set local lock_timeout = '15s';

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='stylist_profiles' and column_name='career_phase') then
    raise exception '0073 requires 0071 (career_phase column) to be applied first';
  end if;
  if to_regprocedure('public.save_stylist_profile_v2(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text)') is null then
    raise exception '0073 requires 0070 (save_stylist_profile_v2) to be applied first';
  end if;
  if to_regprocedure('public.save_stylist_profile_v3(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,text,date,text)') is not null then
    raise exception '0073 is already applied (save_stylist_profile_v3 exists)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. 区分の値と整合制約に 'blank'（ブランクあり）を追加する。
--    旧値（student / NULL）は既存データのために有効なまま残す（新しく書けないことは、下の2のトリガーと v3 が保証する）。
-- ---------------------------------------------------------------------------
lock table public.stylist_profiles in share row exclusive mode;
alter table public.stylist_profiles drop constraint if exists stylist_profiles_career_phase_check;
alter table public.stylist_profiles add constraint stylist_profiles_career_phase_check check (career_phase in ('student','new_graduate','experienced','blank'));
alter table public.stylist_profiles drop constraint if exists stylist_profiles_career_phase_consistent;
alter table public.stylist_profiles add constraint stylist_profiles_career_phase_consistent check ((
  (career_phase is null and graduation_ym is null and graduation_kind is null and desired_start_ym is null and license_status is null)
  or (career_phase in ('experienced','blank') and graduation_ym is null and graduation_kind is null and desired_start_ym is null and license_status is null)
  or (career_phase = 'student' and graduation_ym is not null and graduation_kind is not null and graduation_kind = 'planned')
  or (career_phase = 'new_graduate' and graduation_ym is not null and graduation_kind is not null and graduation_kind in ('planned','completed'))
) is true);
comment on column public.stylist_profiles.career_phase is '立場（必須・3択）: new_graduate=新卒 / experienced=現役の美容師 / blank=ブランクあり。student(美容学生)とNULL(未設定)は旧データのみ有効で、新しく書けない（本人の次回のプロフィール保存で選び直す）。';

-- ---------------------------------------------------------------------------
-- 2. 立場を「新しい値へ変える」ときは、3択のどれかでなければ拒否する（NULL・student へは変えられない）。
--    立場が変わらない更新（旧データの行の、他の項目の更新）は妨げない。
-- ---------------------------------------------------------------------------
create or replace function public._trg_career_phase_valid()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if new.career_phase is distinct from old.career_phase and (new.career_phase is null or new.career_phase not in ('new_graduate','experienced','blank')) then
    raise exception 'career_phase_required' using errcode = '23514', hint = '立場は「新卒」「現役の美容師」「ブランクあり」から選んでください';
  end if;
  return new;
end;
$$;
revoke all on function public._trg_career_phase_valid() from public, anon, authenticated, service_role;
drop trigger if exists trg_career_phase_valid on public.stylist_profiles;
create trigger trg_career_phase_valid before update of career_phase on public.stylist_profiles
  for each row execute function public._trg_career_phase_valid();

-- ---------------------------------------------------------------------------
-- 3. プロフィールと立場を1トランザクションで保存する新関数（立場は必須）。
--    先に立場を検証（未選択・旧値は、何も保存せず拒否）→ 既存の v2 でプロフィールを保存 → 立場の列を更新。途中で失敗すれば全体が取り消される。
-- ---------------------------------------------------------------------------
create function public.save_stylist_profile_v3(
  p_public_name text, p_full_name text, p_age_band public.age_band, p_gender public.gender_type, p_prefecture text,
  p_desired_work_location text, p_experience_years integer, p_current_position text, p_specialties text[],
  p_employment_type public.employment_type, p_job_change_intent public.job_change_intent, p_desired_salary_range public.salary_band,
  p_sns_links jsonb, p_bio text, p_visibility public.profile_visibility, p_scout_enabled boolean, p_avatar_path text,
  p_value_priorities text[], p_birth_date date, p_age_display_mode text,
  p_career_phase text, p_graduation_ym date, p_graduation_kind text, p_desired_start_ym date, p_license_status text
) returns public.profiles
language plpgsql security definer set search_path = public, storage, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_m0    date := date_trunc('month', v_today)::date;
  v_grad  date := case when p_graduation_ym is null then null else date_trunc('month', p_graduation_ym)::date end;
  v_start date := case when p_desired_start_ym is null then null else date_trunc('month', p_desired_start_ym)::date end;
  v_profile public.profiles;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  -- 立場の検証（何かを保存する前）
  if p_career_phase is null or p_career_phase not in ('new_graduate','experienced','blank') then
    raise exception 'career_phase_required' using errcode = '23514', hint = '立場は「新卒」「現役の美容師」「ブランクあり」から選んでください';
  end if;
  if p_license_status is not null and p_license_status not in ('studying','exam_planned','passed_waiting','obtained') then raise exception 'invalid license status'; end if;
  if p_career_phase in ('experienced','blank') then
    if v_grad is not null or p_graduation_kind is not null or v_start is not null or p_license_status is not null then
      raise exception 'graduation, start and license must be empty for this phase';
    end if;
  else
    if v_grad is null then raise exception 'graduation month required'; end if;
    if v_grad < (v_m0 - interval '3 years') or v_grad > (v_m0 + interval '5 years') then raise exception 'graduation month out of range'; end if;
    if p_graduation_kind is null or p_graduation_kind not in ('planned','completed') then raise exception 'graduation kind required'; end if;
    if p_graduation_kind = 'completed' and v_grad > v_m0 then raise exception 'completed graduation cannot be in the future'; end if;
    if v_start is not null and (v_start < (v_m0 - interval '1 year') or v_start > (v_m0 + interval '6 years') or v_start < v_grad) then
      raise exception 'desired start month out of range';
    end if;
  end if;

  v_profile := public.save_stylist_profile_v2(
    p_public_name, p_full_name, p_age_band, p_gender, p_prefecture, p_desired_work_location, p_experience_years, p_current_position,
    p_specialties, p_employment_type, p_job_change_intent, p_desired_salary_range, p_sns_links, p_bio, p_visibility, p_scout_enabled,
    p_avatar_path, p_value_priorities, p_birth_date, p_age_display_mode);

  update public.stylist_profiles
     set career_phase = p_career_phase,
         graduation_ym = case when p_career_phase = 'new_graduate' then v_grad end,
         graduation_kind = case when p_career_phase = 'new_graduate' then p_graduation_kind end,
         desired_start_ym = case when p_career_phase = 'new_graduate' then v_start end,
         license_status = case when p_career_phase = 'new_graduate' then p_license_status end
   where user_id = v_uid;
  if not found then raise exception 'stylist profile not found'; end if;
  return v_profile;
end;
$$;
revoke all on function public.save_stylist_profile_v3(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,text,date,text) from public, anon, authenticated, service_role;
grant execute on function public.save_stylist_profile_v3(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,text,date,text) to authenticated;
comment on function public.save_stylist_profile_v3(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,text,date,text)
  is 'プロフィールと「いまの立場」（必須・3択）を1トランザクションで保存する。立場が未選択・旧値なら何も保存しない。';

commit;
