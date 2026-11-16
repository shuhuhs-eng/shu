-- ============================================================================
-- 0077（草案・未適用）: 旧い保存関数 save_stylist_profile_v3 を閉じる
-- ============================================================================
-- ★適用の順序: 0076 を適用 → アプリを save_stylist_profile_v4 に切り替えて配備 → 本番で保存を確認 → この 0077 を適用。
--   （アプリの切り替え前に適用すると、旧アプリのプロフィール保存が拒否される）
-- v3 は「卒業の区分」を必須とする旧仕様。閉じても v4 は SECURITY DEFINER で v2 を内部から呼ぶため動く。
-- すでに閉じている v2 / v1 / set_stylist_career_phase（0074）は変更しない。0072（大切にしたい働き方の専用保存）も変更しない。
begin;
set local lock_timeout = '15s';
do $$
begin
  if to_regprocedure('public.save_stylist_profile_v4(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,integer,text)') is null then
    raise exception '0077 requires 0076 (save_stylist_profile_v4) to be applied first';
  end if;
  if not has_function_privilege('authenticated', to_regprocedure('public.save_stylist_profile_v3(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,text,date,text)'), 'execute') then
    raise exception '0077 is already applied';
  end if;
end $$;
revoke execute on function public.save_stylist_profile_v3(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,text,date,text) from authenticated;
commit;
