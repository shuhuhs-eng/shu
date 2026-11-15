-- 0071 の巻き戻し（草案・未適用）。運用開始前の完全な取り消し用。
-- 安全装置: 区分が1件でも設定されている、または学生・新卒診断の結果が1件でもあるときは、何も変更せずに中止する。
begin;
do $$
begin
  if exists (select 1 from public.stylist_profiles where career_phase is not null)
     or (to_regclass('public.student_diagnosis_results') is not null and exists (select 1 from public.student_diagnosis_results)) then
    raise exception 'rollback refused: career phase or student diagnosis data exists';
  end if;
end $$;
drop trigger if exists trg_student_diagnosis_limit on public.student_diagnosis_results;
drop function if exists public.commit_student_diagnosis(uuid, uuid, text, jsonb, jsonb);
drop function if exists public._trg_student_diagnosis_limit();
drop table if exists public.student_diagnosis_results;
drop function if exists public.set_stylist_career_phase(text, date, text, date, text);
alter table public.stylist_profiles drop constraint if exists stylist_profiles_start_after_graduation;
alter table public.stylist_profiles drop constraint if exists stylist_profiles_career_phase_consistent;
alter table public.stylist_profiles drop column if exists license_status, drop column if exists desired_start_ym,
  drop column if exists graduation_kind, drop column if exists graduation_ym, drop column if exists career_phase;
commit;
