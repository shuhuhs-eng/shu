-- 0071 の巻き戻し（草案・未適用）。運用開始前の完全な取り消し用。
-- 安全装置: 区分が1件でも設定されている、または学生・新卒診断の結果が1件でもあるときは、何も変更せずに中止する。
-- 0058の2関数は、0058の定義（docs/review-diagnosis-limit/0058_diagnosis_change_limits.draft.sql の該当部分）へ戻す。
-- 末尾の2関数の定義は、0058本体から機械的に抜き出したもの（内容は0058と同一）。
begin;
do $$
begin
  if exists (select 1 from public.stylist_profiles where career_phase is not null)
     or (to_regclass('public.student_diagnosis_results') is not null and exists (select 1 from public.student_diagnosis_results)) then
    raise exception 'rollback refused: career phase or student diagnosis data exists';
  end if;
end $$;
drop trigger if exists trg_student_diagnosis_limit on public.student_diagnosis_results;
drop trigger if exists trg_set_current_diagnosis on public.student_diagnosis_results;
drop trigger if exists trg_set_current_diagnosis on public.diagnosis_results;
drop function if exists public.commit_student_diagnosis(uuid, uuid, text, jsonb, jsonb);
drop function if exists public._trg_student_diagnosis_limit();
drop function if exists public._trg_set_current_diagnosis();
drop table if exists public.stylist_diagnosis_current;
drop table if exists public.student_diagnosis_results;
drop function if exists public.set_stylist_career_phase(text, date, text, date, text);
alter table public.stylist_profiles drop constraint if exists stylist_profiles_start_after_graduation;
alter table public.stylist_profiles drop constraint if exists stylist_profiles_career_phase_consistent;
alter table public.stylist_profiles drop column if exists license_status, drop column if exists desired_start_ym,
  drop column if exists graduation_kind, drop column if exists graduation_ym, drop column if exists career_phase;
-- 公開判定を0070の定義へ戻す（0070適用済みの場合のみ）
do $$
begin
  if to_regprocedure('public.stylist_salon_publishable(uuid)') is not null then
    execute $f$
      create or replace function public.stylist_salon_publishable(p_user_id uuid)
      returns boolean language sql stable security definer set search_path = public, pg_temp
      as $b$
        select not coalesce(
          coalesce((select paused from public.feature_pauses where feature = 'minor_salon_public'), true)
          and coalesce((select public.stylist_age_years(birth_date) < 18 from public.stylist_private where user_id = p_user_id), false),
          false)
      $b$ $f$;
  end if;
end $$;
create or replace function public.commit_diagnosis_result(
  p_user_id uuid, p_request_id uuid, p_allow_change boolean,
  p_diagnosis_version text, p_mode public.diagnosis_mode, p_answers jsonb,
  p_craft smallint, p_sense smallint, p_hospitality smallint, p_brand smallint, p_drive smallint, p_mentor smallint,
  p_type_id text, p_type_name text, p_market_value smallint, p_salary_band text,
  p_source_pending_id uuid default null,
  p_created_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_kind   text := case when p_mode = 'stylist' then 'stylist' else 'salon_quiz' end;
  v_latest public.diagnosis_results;
  v_gate   jsonb;
  v_new    public.diagnosis_results;
begin
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found';
  end if;
  perform public._diag_owner_lock(v_kind, p_user_id, null);   -- ★最新回答の取得より前にロックを取る
  select * into v_latest from public.diagnosis_results
    where user_id = p_user_id and mode = p_mode order by created_at desc, id desc limit 1;

  v_gate := public._diagnosis_limit_gate(
    v_kind, p_user_id, null, p_request_id,
    (v_latest.id is null or v_latest.answers is distinct from p_answers),
    p_allow_change, false, md5(p_mode::text || ':' || p_answers::text));

  if (v_gate->>'replay')::boolean then
    return v_gate || jsonb_build_object('result_id', v_gate->>'result_ref');
  end if;
  if v_gate->>'action' = 'unchanged' then
    update public.diagnosis_save_requests set result_ref = v_latest.id::text where request_id = p_request_id;
    return v_gate || jsonb_build_object('result_id', v_latest.id);
  end if;

  perform public._diag_gate_open(v_kind);
  insert into public.diagnosis_results (
    user_id, diagnosis_version, mode, answers,
    craft_score, sense_score, hospitality_score, brand_score, drive_score, mentor_score,
    type_id, type_name, market_value_score, salary_band, source_pending_id, created_at
  ) values (
    p_user_id, p_diagnosis_version, p_mode, p_answers,
    p_craft, p_sense, p_hospitality, p_brand, p_drive, p_mentor,
    p_type_id, p_type_name, p_market_value, p_salary_band, p_source_pending_id, coalesce(p_created_at, clock_timestamp())
  ) returning * into v_new;
  perform public._diag_gate_close();

  update public.diagnosis_save_requests set result_ref = v_new.id::text where request_id = p_request_id;
  return v_gate || jsonb_build_object('result_id', v_new.id);
end;
$$;
create or replace function public._trg_diagnosis_results_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_kind   text := case when new.mode = 'stylist' then 'stylist' else 'salon_quiz' end;
  v_latest jsonb;
  v_gate   jsonb;
begin
  if current_setting('app.diag_gate', true) = v_kind then return new; end if;
  perform public._diag_owner_lock(v_kind, new.user_id, null);   -- ★最新回答の取得より前にロックを取る
  select answers into v_latest from public.diagnosis_results
    where user_id = new.user_id and mode = new.mode order by created_at desc, id desc limit 1;
  v_gate := public._diagnosis_limit_gate(v_kind, new.user_id, null, gen_random_uuid(),
              (v_latest is null or v_latest is distinct from new.answers), true, false, null);
  if v_gate->>'action' = 'unchanged' then return null; end if;   -- 同一回答の再保存: 追加しない・消費しない
  return new;
end;
$$;

commit;
