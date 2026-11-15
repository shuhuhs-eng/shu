-- ============================================================================
-- 0074（草案・未適用）: 立場の必須条件を回避できる旧い経路を閉じる
-- ============================================================================
-- ★適用の順序: 0073 を適用 → アプリを save_stylist_profile_v3 に切り替えて配備 → この 0074 を適用。
--   （アプリの切り替え前に適用すると、旧アプリのプロフィール保存・立場の保存が拒否される）
-- 閉じるもの（authenticated の実行権限を外す。service_role・anon・PUBLIC は元から不可）:
--   ・save_stylist_profile_v2 / save_stylist_profile(18引数) … 立場を受け取らないため、これらでの保存は必須条件を回避できてしまう
--   ・set_stylist_career_phase … プロフィールと別に立場だけを保存でき、未設定(NULL)・美容学生へ戻せてしまう
--   v3 は SECURITY DEFINER（所有者の権限）で v2 を内部から呼ぶため、権限を外しても v3 経由の保存は動く。
-- 新しいプロフィール行は、コミット時点で立場が3択のいずれかでなければ作れない（遅延制約トリガー）。
--   既存の行（旧データ: 未設定・美容学生）は、立場を変えない更新を妨げない（本人が次に v3 で保存するときに選び直す）。
-- 適用済みの 0058〜0072 は編集しない。診断・マッチング・回数制限には触れない。
begin;
set local lock_timeout = '15s';

do $$
begin
  if to_regprocedure('public.save_stylist_profile_v3(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,text,date,text)') is null then
    raise exception '0074 requires 0073 (save_stylist_profile_v3) to be applied first';
  end if;
  if exists (select 1 from pg_trigger where tgname='trg_career_phase_required_on_insert' and tgrelid='public.stylist_profiles'::regclass) then
    raise exception '0074 is already applied';
  end if;
end $$;

revoke execute on function public.save_stylist_profile_v2(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text) from authenticated;
revoke execute on function public.save_stylist_profile(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[]) from authenticated;
revoke execute on function public.set_stylist_career_phase(text, date, text, date, text) from authenticated;

-- 新しいプロフィール行は、コミット時に立場が3択のいずれかであること（遅延。v3 は同じトランザクションの中で立場を入れる）
create or replace function public._trg_career_phase_required_on_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.stylist_profiles where user_id = new.user_id and career_phase in ('new_graduate','experienced','blank')) then
    raise exception 'career_phase_required' using errcode = '23514', hint = '立場は「新卒」「現役の美容師」「ブランクあり」から選んでください';
  end if;
  return null;
end;
$$;
revoke all on function public._trg_career_phase_required_on_insert() from public, anon, authenticated, service_role;
create constraint trigger trg_career_phase_required_on_insert after insert on public.stylist_profiles
  deferrable initially deferred for each row execute function public._trg_career_phase_required_on_insert();

commit;
