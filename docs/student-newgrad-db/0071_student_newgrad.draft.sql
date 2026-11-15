-- ============================================================================
-- 0071（草案・未適用）: 美容学生・新卒対応（美容師側のプロフィール区分と、学生・新卒診断の保存）
-- ============================================================================
-- ★前提: 0058（診断の変更回数制限）が適用済みであること。0058の状態表・ゲート関数・所有者ロックを共有する。
-- ★0058・0059・0070とは別。既存の表・関数の定義は変更しない（追加のみ）。診断・マッチング計算には触れない。
-- ★公開・課金は含まない: サロンへ学生・新卒の情報を返す関数は作らない（未成年の公開は未確定・採用料も未確定）。
--
-- 決定事項（docs/student-newgrad-proposal.md / student-newgrad-diagnosis-design.md）:
--   ・career_phase の NULL は「未設定」。経験者とは扱わず、既存会員を推定して設定しない（既存会員は全員NULL）。
--   ・学生区分と免許取得状況は別々の列。免許の有無で区分を決めない。
--   ・卒業時期・就業開始希望は年月（月初日で保持）。
--   ・学生・新卒の診断にも、経験者診断と同じ回数制限を適用する。**制限の状態は経験者診断と共有**（kind='stylist'）。
--     別の質問セットへの保存は常に「変更」として数えるため、質問セットの切替では回避できない。
--   ・同じ所有者ロックの内側で「最新回答の取得 → 変更判定 → 回数更新 → 結果保存」を行う（0058と同じ）。
begin;

do $$
begin
  if to_regclass('public.diagnosis_change_limits') is null or to_regprocedure('public._diagnosis_limit_gate(text,uuid,uuid,uuid,boolean,boolean,boolean,text)') is null
     or to_regprocedure('public._diag_owner_lock(text,uuid,uuid)') is null then
    raise exception '0071 requires 0058 (diagnosis change limits) to be applied first';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. 美容師プロフィールの区分（すべて NULL 可。NULL＝未設定）
-- ---------------------------------------------------------------------------
alter table public.stylist_profiles
  add column career_phase     text check (career_phase in ('student','new_graduate','experienced')),
  add column graduation_ym    date check (graduation_ym is null or graduation_ym = date_trunc('month', graduation_ym)::date),
  add column graduation_kind  text check (graduation_kind in ('planned','completed')),
  add column desired_start_ym date check (desired_start_ym is null or desired_start_ym = date_trunc('month', desired_start_ym)::date),
  add column license_status   text check (license_status in ('studying','exam_planned','passed_waiting','obtained'));
alter table public.stylist_profiles add constraint stylist_profiles_career_phase_consistent check (
  (career_phase is null and graduation_ym is null and graduation_kind is null and desired_start_ym is null and license_status is null)
  or (career_phase = 'experienced' and graduation_ym is null and graduation_kind is null and desired_start_ym is null and license_status is null)
  or (career_phase = 'student' and graduation_ym is not null and graduation_kind = 'planned')
  or (career_phase = 'new_graduate' and graduation_ym is not null and graduation_kind in ('planned','completed'))
);
alter table public.stylist_profiles add constraint stylist_profiles_start_after_graduation check (
  desired_start_ym is null or graduation_ym is null or desired_start_ym >= graduation_ym
);
comment on column public.stylist_profiles.career_phase is '区分: student=美容学生（在学中）/ new_graduate=新卒 / experienced=本人が選んだ経験者。NULL=未設定（経験者という意味ではない。既存会員は推定しない）。';
comment on column public.stylist_profiles.license_status is '美容師免許の取得状況（区分とは別）: studying=在学中 / exam_planned=受験予定 / passed_waiting=合格・登録待ち / obtained=取得済。NULL=未設定。';

-- 本人だけが、専用関数で設定・解除する。NULLで未設定へ戻せる。
create or replace function public.set_stylist_career_phase(
  p_phase text, p_graduation_ym date default null, p_graduation_kind text default null,
  p_desired_start_ym date default null, p_license_status text default null
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_m0    date := date_trunc('month', v_today)::date;
  v_grad  date := case when p_graduation_ym is null then null else date_trunc('month', p_graduation_ym)::date end;
  v_start date := case when p_desired_start_ym is null then null else date_trunc('month', p_desired_start_ym)::date end;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.stylist_profiles where user_id = v_uid) then raise exception 'stylist profile not found'; end if;
  if p_phase is not null and p_phase not in ('student','new_graduate','experienced') then raise exception 'invalid career phase'; end if;
  if p_license_status is not null and p_license_status not in ('studying','exam_planned','passed_waiting','obtained') then raise exception 'invalid license status'; end if;

  if p_phase is null or p_phase = 'experienced' then
    if v_grad is not null or p_graduation_kind is not null or v_start is not null or p_license_status is not null then
      raise exception 'graduation, start and license must be empty for this phase';
    end if;
  else
    if v_grad is null then raise exception 'graduation month required'; end if;
    -- 想定値（変更可）: 卒業は3年前〜5年後、就業開始希望は1年前〜6年後
    if v_grad < (v_m0 - interval '3 years') or v_grad > (v_m0 + interval '5 years') then raise exception 'graduation month out of range'; end if;
    if p_phase = 'student' and p_graduation_kind is distinct from 'planned' then raise exception 'student requires planned graduation'; end if;
    if p_phase = 'new_graduate' and p_graduation_kind not in ('planned','completed') then raise exception 'invalid graduation kind'; end if;
    if p_graduation_kind = 'completed' and v_grad > v_m0 then raise exception 'completed graduation cannot be in the future'; end if;
    if v_start is not null and (v_start < (v_m0 - interval '1 year') or v_start > (v_m0 + interval '6 years') or v_start < v_grad) then
      raise exception 'desired start month out of range';
    end if;
  end if;

  update public.stylist_profiles
     set career_phase = p_phase,
         graduation_ym = case when p_phase in ('student','new_graduate') then v_grad end,
         graduation_kind = case when p_phase in ('student','new_graduate') then p_graduation_kind end,
         desired_start_ym = case when p_phase in ('student','new_graduate') then v_start end,
         license_status = case when p_phase in ('student','new_graduate') then p_license_status end
   where user_id = v_uid;
end;
$$;
revoke all on function public.set_stylist_career_phase(text, date, text, date, text) from public, anon, authenticated, service_role;
grant execute on function public.set_stylist_career_phase(text, date, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. 学生・新卒診断の結果（既存の diagnosis_results とは別表）
-- ---------------------------------------------------------------------------
create table public.student_diagnosis_results (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  version    text        not null,
  answers    jsonb       not null check (jsonb_typeof(answers) = 'object'
                           and answers ?& array['q1','q2','q3','q4','q5','q6','q7','q9','q10','q11','q12','q13','q14']),
  result     jsonb       not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);
create index student_diagnosis_results_user_idx on public.student_diagnosis_results (user_id, created_at desc, id desc);
comment on table public.student_diagnosis_results is '美容学生・新卒診断の結果。書き込みは commit_student_diagnosis（service_role専用）か、回数制限つきのトリガー経由のみ。サロンへは返さない（未成年の公開は未確定）。';
alter table public.student_diagnosis_results enable row level security;
create policy student_diagnosis_results_select_own on public.student_diagnosis_results for select to authenticated using (user_id = auth.uid());
revoke all on table public.student_diagnosis_results from public, anon, authenticated, service_role;
grant select on table public.student_diagnosis_results to authenticated;

-- 直接INSERT（正規関数を通らない書き込み）も、経験者診断と同じ状態（kind='stylist'）・同じ所有者ロックで制限する。
create or replace function public._trg_student_diagnosis_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_latest jsonb; v_gate jsonb;
begin
  if current_setting('app.diag_gate', true) = 'student' then return new; end if;
  perform public._diag_owner_lock('stylist', new.user_id, null);     -- ★最新回答の取得より前にロック
  select answers into v_latest from public.student_diagnosis_results where user_id = new.user_id order by created_at desc, id desc limit 1;
  v_gate := public._diagnosis_limit_gate('stylist', new.user_id, null, gen_random_uuid(), (v_latest is null or v_latest is distinct from new.answers), true, false, null);
  if v_gate->>'action' = 'unchanged' then return null; end if;
  return new;
end;
$$;
revoke all on function public._trg_student_diagnosis_limit() from public, anon, authenticated, service_role;
create trigger trg_student_diagnosis_limit before insert on public.student_diagnosis_results
  for each row execute function public._trg_student_diagnosis_limit();

-- 正規の確定保存（service_role専用。アプリのサーバーが、本人確認のあとに user_id を渡して呼ぶ）
create or replace function public.commit_student_diagnosis(
  p_user_id uuid, p_request_id uuid, p_version text, p_answers jsonb, p_result jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_latest public.student_diagnosis_results; v_gate jsonb; v_new public.student_diagnosis_results;
begin
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'user not found'; end if;
  perform public._diag_owner_lock('stylist', p_user_id, null);        -- ★最新回答の取得より前にロック
  select * into v_latest from public.student_diagnosis_results where user_id = p_user_id order by created_at desc, id desc limit 1;
  v_gate := public._diagnosis_limit_gate('stylist', p_user_id, null, p_request_id,
              (v_latest.id is null or v_latest.answers is distinct from p_answers), true, false, md5('student:' || p_answers::text));
  if (v_gate->>'replay')::boolean then return v_gate || jsonb_build_object('result_id', v_gate->>'result_ref'); end if;
  if v_gate->>'action' = 'unchanged' then
    update public.diagnosis_save_requests set result_ref = v_latest.id::text where request_id = p_request_id;
    return v_gate || jsonb_build_object('result_id', v_latest.id);
  end if;
  perform public._diag_gate_open('student');
  insert into public.student_diagnosis_results (user_id, version, answers, result) values (p_user_id, p_version, p_answers, p_result) returning * into v_new;
  perform public._diag_gate_close();
  update public.diagnosis_save_requests set result_ref = v_new.id::text where request_id = p_request_id;
  return v_gate || jsonb_build_object('result_id', v_new.id);
end;
$$;
revoke all on function public.commit_student_diagnosis(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.commit_student_diagnosis(uuid, uuid, text, jsonb, jsonb) to service_role;

commit;
