-- ============================================================================
-- 0076（草案・未適用）: 「いまの立場」の入力を簡素化する（追加・緩和のみ。旧経路は閉じない）
-- ============================================================================
-- 仕様:
--   ・新卒の入力は「卒業（予定）年月」だけ。月は 3月／10月 のみ（サーバー・DBで他の月を拒否）。年は西暦の範囲内（下記）。
--   ・「卒業の区分」「就業開始の希望時期」「美容師免許の取得状況」は、画面からも保存の必須条件からも外す（入力しなくても保存できる）。
--       固定値（例: 卒業予定）を裏で補って通すことはしない。
--   ・ブランクありに「ブランク期間」（数値＋単位 ヶ月/年）を追加。任意。未入力を0ヶ月とは扱わない。数値と単位はセットで保存する。
--       保存形式: blank_period_value(smallint, 1以上) + blank_period_unit('months'|'years')。「6ヶ月」「2年」をそのまま保存・表示する（月に換算して失わない）。
--       上限: ヶ月は 1〜120、年は 1〜10（どちらも最長10年。理由: 現場復帰を想定した期間として十分で、入力ミス（例: 600ヶ月）を弾くため）。
-- 既存データの保護（この移行ではデータを一切更新しない）:
--   ・卒業の区分・就業開始・免許の保存済みの値は、削除も変換もしない。新しい保存関数（v4）は、この3列を読み書きしない（触らない）。
--   ・卒業月が 3月／10月 以外の既存データは、丸めない・変更しない。本人が次に保存するとき（新卒のまま）に選び直す。
--       DBの月の検査は「卒業年月または立場を新しく書くとき」だけ働き、既存の行を他の項目の更新で拒否することはない。
--   ・旧値（未設定NULL・美容学生student）は変換しない（0073と同じ）。
-- 立場を切り替えたときの扱い（v4・トリガーが行う）:
--   ・新卒→現役/ブランク: 卒業年月を消す（新卒の入力のため）。旧3項目は触らない（残る）。
--   ・ブランク→現役/新卒: ブランク期間を消す（ブランクの入力のため）。
--   ・現役/ブランク→新卒: 卒業年月が必須。旧3項目は触らない。
--   ・それ以外のプロフィール項目（公開範囲・生年月日・自己紹介・大切にしたいこと等）は、この関数では立場の切り替えで変わらない。
-- 緩和する既存制約（適用済みの 0071/0073 の制約を、名前を指定して置き換える。SQLファイルは編集しない）:
--   ・stylist_profiles_career_phase_consistent: 新卒でも「卒業の区分」が空でよい／現役・ブランクでも旧3項目が残っていてよい／ブランク期間の整合を追加。
--   ・stylist_profiles_start_after_graduation: 削除（就業開始の希望時期は入力項目から外れ、保存済みの値は残るため、卒業月の選び直しを邪魔しない）。
-- 診断の採点・変更回数・現在の診断判定・マッチング・料金・公開条件・サロン向けの公開項目には触れない。
-- 前提: 0073 適用済み（v3・立場の検証トリガー）。0072（大切にしたい働き方の専用保存）は変更しない。
begin;
set local lock_timeout = '15s';

do $$
begin
  if to_regprocedure('public.save_stylist_profile_v3(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,text,date,text)') is null then
    raise exception '0076 requires 0073 (save_stylist_profile_v3) to be applied first';
  end if;
  if to_regprocedure('public.save_stylist_profile_v4(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,integer,text)') is not null
     or exists (select 1 from information_schema.columns where table_schema='public' and table_name='stylist_profiles' and column_name='blank_period_value') then
    raise exception '0076 is already applied';
  end if;
end $$;

lock table public.stylist_profiles in share row exclusive mode;

-- 1. ブランク期間（任意）。数値と単位はセット。
alter table public.stylist_profiles
  add column blank_period_value smallint,
  add column blank_period_unit  text;
alter table public.stylist_profiles add constraint stylist_profiles_blank_period_unit_check check (blank_period_unit is null or blank_period_unit in ('months','years'));
alter table public.stylist_profiles add constraint stylist_profiles_blank_period_pair check (
  (blank_period_value is null and blank_period_unit is null)
  or (blank_period_value is not null and blank_period_unit is not null and blank_period_value >= 1
      and ((blank_period_unit = 'months' and blank_period_value <= 120) or (blank_period_unit = 'years' and blank_period_value <= 10)))
);
comment on column public.stylist_profiles.blank_period_value is 'ブランクありの期間の数値（任意。1以上の整数。blank_period_unit とセット）。未入力はNULL（0ヶ月ではない）。';
comment on column public.stylist_profiles.blank_period_unit is 'ブランク期間の単位: months=ヶ月（1〜120） / years=年（1〜10）。NULLは未入力。';

-- 2. 整合制約を置き換える（旧データを壊さない緩和＋ブランク期間の整合）
alter table public.stylist_profiles drop constraint if exists stylist_profiles_career_phase_consistent;
alter table public.stylist_profiles drop constraint if exists stylist_profiles_start_after_graduation;
alter table public.stylist_profiles add constraint stylist_profiles_career_phase_consistent check ((
  (career_phase is null and graduation_ym is null and graduation_kind is null and desired_start_ym is null and license_status is null
     and blank_period_value is null and blank_period_unit is null)
  or (career_phase = 'student' and graduation_ym is not null and graduation_kind is not null and graduation_kind = 'planned'
     and blank_period_value is null and blank_period_unit is null)
  or (career_phase = 'new_graduate' and graduation_ym is not null and blank_period_value is null and blank_period_unit is null)
  or (career_phase = 'experienced' and graduation_ym is null and blank_period_value is null and blank_period_unit is null)
  or (career_phase = 'blank' and graduation_ym is null)
) is true);

-- 3. 卒業の月は 3月／10月 のみ（立場を新卒にする・卒業年月を書くとき。既存行を他の更新で拒否しない）
create or replace function public._trg_graduation_month_valid()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if new.career_phase = 'new_graduate'
     and (tg_op = 'INSERT' or new.graduation_ym is distinct from old.graduation_ym or new.career_phase is distinct from old.career_phase)
     and (new.graduation_ym is null or extract(month from new.graduation_ym) not in (3, 10)) then
    raise exception 'graduation_month_invalid' using errcode = '23514', hint = '卒業（予定）の月は3月か10月から選んでください';
  end if;
  return new;
end;
$$;
revoke all on function public._trg_graduation_month_valid() from public, anon, authenticated, service_role;
drop trigger if exists trg_graduation_month_valid on public.stylist_profiles;
create trigger trg_graduation_month_valid before insert or update of graduation_ym, career_phase on public.stylist_profiles
  for each row execute function public._trg_graduation_month_valid();

-- 4. ブランク以外の立場に変わるとき、ブランク期間を消す（旧経路 v3 からの切り替えでも整合制約を破らない）
create or replace function public._trg_blank_period_follow_phase()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if new.career_phase is distinct from 'blank' then
    new.blank_period_value := null; new.blank_period_unit := null;
  end if;
  return new;
end;
$$;
revoke all on function public._trg_blank_period_follow_phase() from public, anon, authenticated, service_role;
drop trigger if exists trg_blank_period_follow_phase on public.stylist_profiles;
create trigger trg_blank_period_follow_phase before update of career_phase on public.stylist_profiles
  for each row execute function public._trg_blank_period_follow_phase();

-- 5. 保存関数 v4（プロフィール＋追加情報＋立場を1トランザクションで保存。立場は必須）
create function public.save_stylist_profile_v4(
  p_public_name text, p_full_name text, p_age_band public.age_band, p_gender public.gender_type, p_prefecture text,
  p_desired_work_location text, p_experience_years integer, p_current_position text, p_specialties text[],
  p_employment_type public.employment_type, p_job_change_intent public.job_change_intent, p_desired_salary_range public.salary_band,
  p_sns_links jsonb, p_bio text, p_visibility public.profile_visibility, p_scout_enabled boolean, p_avatar_path text,
  p_value_priorities text[], p_birth_date date, p_age_display_mode text,
  p_career_phase text, p_graduation_ym date, p_blank_period_value integer, p_blank_period_unit text
) returns public.profiles
language plpgsql security definer set search_path = public, storage, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_m0    date := date_trunc('month', v_today)::date;
  v_grad  date := case when p_graduation_ym is null then null else date_trunc('month', p_graduation_ym)::date end;
  v_max   integer;
  v_profile public.profiles;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  -- 立場と入力の検証（何かを保存する前）
  if p_career_phase is null or p_career_phase not in ('new_graduate','experienced','blank') then
    raise exception 'career_phase_required' using errcode = '23514', hint = '立場は「新卒」「現役の美容師」「ブランクあり」から選んでください';
  end if;
  if p_career_phase = 'new_graduate' then
    if p_blank_period_value is not null or p_blank_period_unit is not null then raise exception 'blank period must be empty for this phase'; end if;
    if v_grad is null then raise exception 'graduation month required'; end if;
    if extract(month from v_grad) not in (3, 10) then raise exception 'graduation_month_invalid' using errcode = '23514', hint = '卒業（予定）の月は3月か10月から選んでください'; end if;
    if v_grad < (v_m0 - interval '3 years') or v_grad > (v_m0 + interval '5 years') then raise exception 'graduation month out of range'; end if;
  elsif p_career_phase = 'experienced' then
    if v_grad is not null or p_blank_period_value is not null or p_blank_period_unit is not null then raise exception 'graduation and blank period must be empty for this phase'; end if;
  else
    if v_grad is not null then raise exception 'graduation must be empty for this phase'; end if;
    if (p_blank_period_value is null) <> (p_blank_period_unit is null) then raise exception 'blank period value and unit must be set together'; end if;
    if p_blank_period_value is not null then
      if p_blank_period_unit not in ('months','years') then raise exception 'invalid blank period unit'; end if;
      v_max := (case when p_blank_period_unit = 'months' then 120 else 10 end);
      if p_blank_period_value < 1 or p_blank_period_value > v_max then raise exception 'blank period out of range'; end if;
    end if;
  end if;

  v_profile := public.save_stylist_profile_v2(
    p_public_name, p_full_name, p_age_band, p_gender, p_prefecture, p_desired_work_location, p_experience_years, p_current_position,
    p_specialties, p_employment_type, p_job_change_intent, p_desired_salary_range, p_sns_links, p_bio, p_visibility, p_scout_enabled,
    p_avatar_path, p_value_priorities, p_birth_date, p_age_display_mode);

  -- 旧3項目（卒業の区分・就業開始・免許）は読まない・書かない（保存済みの値はそのまま残る）
  update public.stylist_profiles
     set career_phase = p_career_phase,
         graduation_ym = case when p_career_phase = 'new_graduate' then v_grad end,
         blank_period_value = case when p_career_phase = 'blank' then p_blank_period_value end,
         blank_period_unit = case when p_career_phase = 'blank' then p_blank_period_unit end
   where user_id = v_uid;
  if not found then raise exception 'stylist profile not found'; end if;
  return v_profile;
end;
$$;
revoke all on function public.save_stylist_profile_v4(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,integer,text) from public, anon, authenticated, service_role;
grant execute on function public.save_stylist_profile_v4(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,integer,text) to authenticated;
comment on function public.save_stylist_profile_v4(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,integer,text)
  is 'プロフィールと「いまの立場」（必須3択。新卒=卒業年月(3月/10月)、ブランクあり=任意のブランク期間）を1トランザクションで保存する。旧3項目（卒業の区分・就業開始・免許）は触らない。';

commit;
