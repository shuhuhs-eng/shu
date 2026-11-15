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
--   ・同じ所有者ロックの内側で「現在の診断の取得 → 変更判定 → 回数更新 → 結果保存」を行う（0058と同じ）。
--   ・【現在の診断】は経験者診断・学生診断を横断した「最新の保存成功結果」。順序は保存順の連番（下の stylist_diagnosis_current.seq）で
--     一意に決める（時刻の値や同時刻では決めない）。変更判定は「同じ質問セット かつ 同じ回答」のときだけ「変更なし」。
--     別の質問セットへの切替は、以前と同じ回答でも「変更1回」。「経験者A→学生B→経験者A」の3回目も、共通ロックの中で
--     ロック中なら拒否、解除後なら変更として保存する。
--   ・【0058の関数を2つ置き換える】commit_diagnosis_result と _trg_diagnosis_results_limit（stylistモードのみ判定を変更。サロン診断の分岐は同一）。
--     適用前に、本番の現行定義が0058の定義と一致することを下の確認で止める（一致しなければ中止）。
begin;

do $$
begin
  if to_regclass('public.diagnosis_change_limits') is null or to_regprocedure('public._diagnosis_limit_gate(text,uuid,uuid,uuid,boolean,boolean,boolean,text)') is null
     or to_regprocedure('public._diag_owner_lock(text,uuid,uuid)') is null then
    raise exception '0071 requires 0058 (diagnosis change limits) to be applied first';
  end if;
  -- 置き換える2関数が、0058の定義のままであること（誰かが手で変えていたら中止）
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.commit_diagnosis_result(uuid,uuid,boolean,text,public.diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamptz)')) is distinct from '04fe4af9ea696398239f95f6f984b6f6'
     or (select md5(prosrc) from pg_proc where oid = to_regprocedure('public._trg_diagnosis_results_limit()')) is distinct from '15df323841beef4372b72dc2e2d488e4' then
    raise exception '0071 aborted: commit_diagnosis_result / _trg_diagnosis_results_limit differ from the 0058 definitions';
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

-- ---------------------------------------------------------------------------
-- 3. 【現在の診断】（経験者・学生を横断した最新の保存成功結果）
--    順序は「所有者ロックの中で採番する連番 seq」。保存成功＝結果表への挿入の成功。拒否・ロールバックされた保存は連番を進めない。
--    ポインタは両方の結果表のAFTER INSERTトリガーだけが更新する（アプリ・利用者は書けない）。
-- ---------------------------------------------------------------------------
create table public.stylist_diagnosis_current (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  bank       text   not null check (bank in ('experienced','student')),
  result_id  uuid   not null,
  answers    jsonb  not null,
  seq        bigint not null check (seq >= 1),
  updated_at timestamptz not null default now()
);
comment on table public.stylist_diagnosis_current is '美容師の「現在の診断」（経験者診断か学生・新卒診断のどちらか）。最新の保存成功結果を指す。seq=保存順の連番。';
alter table public.stylist_diagnosis_current enable row level security;
create policy stylist_diagnosis_current_select_own on public.stylist_diagnosis_current for select to authenticated using (user_id = auth.uid());
revoke all on table public.stylist_diagnosis_current from public, anon, authenticated, service_role;
grant select on table public.stylist_diagnosis_current to authenticated;

-- 既存会員: 現在の経験者診断の最新1件を、現在の診断として登録（seq=1）。診断の無い人は行なし。
insert into public.stylist_diagnosis_current (user_id, bank, result_id, answers, seq)
select distinct on (user_id) user_id, 'experienced', id, answers, 1
  from public.diagnosis_results where mode = 'stylist'
 order by user_id, created_at desc, id desc;

create or replace function public._trg_set_current_diagnosis() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  -- 呼び出しは所有者ロックの内側（BEFOREトリガー／確定関数が先にロック済み）。念のため同じロックを再取得（再入可）。
  perform public._diag_owner_lock('stylist', new.user_id, null);
  insert into public.stylist_diagnosis_current (user_id, bank, result_id, answers, seq)
    values (new.user_id, tg_argv[0], new.id, new.answers, 1)
  on conflict (user_id) do update
    set bank = excluded.bank, result_id = excluded.result_id, answers = excluded.answers,
        seq = public.stylist_diagnosis_current.seq + 1, updated_at = now();
  return null;
end;
$$;
revoke all on function public._trg_set_current_diagnosis() from public, anon, authenticated, service_role;
create trigger trg_set_current_diagnosis after insert on public.diagnosis_results
  for each row when (new.mode = 'stylist') execute function public._trg_set_current_diagnosis('experienced');
create trigger trg_set_current_diagnosis after insert on public.student_diagnosis_results
  for each row execute function public._trg_set_current_diagnosis('student');

-- ---------------------------------------------------------------------------
-- 4. 0058の2関数の置き換え（stylistモードの「変更あり」の判定だけを、現在の診断（バンク込み）基準へ）
--    差分: ①stylistモードは stylist_diagnosis_current を読む ②「変更なし」＝同じバンクかつ同じ回答 ③それ以外は0058と同一
-- ---------------------------------------------------------------------------
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
  v_kind    text := case when p_mode = 'stylist' then 'stylist' else 'salon_quiz' end;
  v_cur_id  uuid;
  v_changed boolean;
  v_gate    jsonb;
  v_new     public.diagnosis_results;
begin
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found';
  end if;
  perform public._diag_owner_lock(v_kind, p_user_id, null);   -- ★現在の診断の取得より前にロックを取る
  if p_mode = 'stylist' then
    select c.result_id, (c.bank <> 'experienced' or c.answers is distinct from p_answers)
      into v_cur_id, v_changed from public.stylist_diagnosis_current c where c.user_id = p_user_id;
    if not found then v_changed := true; v_cur_id := null; end if;
  else
    select l.id, (l.answers is distinct from p_answers) into v_cur_id, v_changed from public.diagnosis_results l
      where l.user_id = p_user_id and l.mode = p_mode order by l.created_at desc, l.id desc limit 1;
    if not found then v_changed := true; v_cur_id := null; end if;
  end if;

  v_gate := public._diagnosis_limit_gate(
    v_kind, p_user_id, null, p_request_id, v_changed, p_allow_change, false, md5(p_mode::text || ':' || p_answers::text));

  if (v_gate->>'replay')::boolean then
    return v_gate || jsonb_build_object('result_id', v_gate->>'result_ref');   -- 再送: 現在の診断も回数も動かさない
  end if;
  if v_gate->>'action' = 'unchanged' then
    update public.diagnosis_save_requests set result_ref = v_cur_id::text where request_id = p_request_id;
    return v_gate || jsonb_build_object('result_id', v_cur_id);
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
  v_kind    text := case when new.mode = 'stylist' then 'stylist' else 'salon_quiz' end;
  v_changed boolean;
  v_gate    jsonb;
begin
  if current_setting('app.diag_gate', true) = v_kind then return new; end if;
  perform public._diag_owner_lock(v_kind, new.user_id, null);   -- ★現在の診断の取得より前にロックを取る
  if new.mode = 'stylist' then
    select (c.bank <> 'experienced' or c.answers is distinct from new.answers) into v_changed
      from public.stylist_diagnosis_current c where c.user_id = new.user_id;
    if not found then v_changed := true; end if;
  else
    select (l.answers is distinct from new.answers) into v_changed from public.diagnosis_results l
      where l.user_id = new.user_id and l.mode = new.mode order by l.created_at desc, l.id desc limit 1;
    if not found then v_changed := true; end if;
  end if;
  v_gate := public._diagnosis_limit_gate(v_kind, new.user_id, null, gen_random_uuid(), v_changed, true, false, null);
  if v_gate->>'action' = 'unchanged' then return null; end if;   -- 同じバンク・同じ回答の再保存: 追加しない・消費しない
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. 学生・新卒診断: 直接INSERTの制限と確定保存（経験者診断と同じ状態 kind='stylist'・同じ所有者ロック・同じ「現在の診断」）
-- ---------------------------------------------------------------------------
create or replace function public._trg_student_diagnosis_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_changed boolean; v_gate jsonb;
begin
  if current_setting('app.diag_gate', true) = 'student' then return new; end if;
  perform public._diag_owner_lock('stylist', new.user_id, null);     -- ★現在の診断の取得より前にロック
  select (c.bank <> 'student' or c.answers is distinct from new.answers) into v_changed
    from public.stylist_diagnosis_current c where c.user_id = new.user_id;
  if not found then v_changed := true; end if;
  v_gate := public._diagnosis_limit_gate('stylist', new.user_id, null, gen_random_uuid(), v_changed, true, false, null);
  if v_gate->>'action' = 'unchanged' then return null; end if;
  return new;
end;
$$;
revoke all on function public._trg_student_diagnosis_limit() from public, anon, authenticated, service_role;
create trigger trg_student_diagnosis_limit before insert on public.student_diagnosis_results
  for each row execute function public._trg_student_diagnosis_limit();

create or replace function public.commit_student_diagnosis(
  p_user_id uuid, p_request_id uuid, p_version text, p_answers jsonb, p_result jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_cur_id uuid; v_changed boolean; v_gate jsonb; v_new public.student_diagnosis_results;
begin
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'user not found'; end if;
  perform public._diag_owner_lock('stylist', p_user_id, null);        -- ★現在の診断の取得より前にロック
  select c.result_id, (c.bank <> 'student' or c.answers is distinct from p_answers) into v_cur_id, v_changed
    from public.stylist_diagnosis_current c where c.user_id = p_user_id;
  if not found then v_changed := true; v_cur_id := null; end if;
  v_gate := public._diagnosis_limit_gate('stylist', p_user_id, null, p_request_id, v_changed, true, false, md5('student:' || p_answers::text));
  if (v_gate->>'replay')::boolean then return v_gate || jsonb_build_object('result_id', v_gate->>'result_ref'); end if;   -- 再送: 現在の診断も回数も動かさない
  if v_gate->>'action' = 'unchanged' then
    update public.diagnosis_save_requests set result_ref = v_cur_id::text where request_id = p_request_id;
    return v_gate || jsonb_build_object('result_id', v_cur_id);
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

-- ---------------------------------------------------------------------------
-- 6. サロン公開の保留（0070が適用済みの場合のみ）: 区分が「美容学生・新卒」で生年月日が未登録の人は、年齢未確認のため保留する。
--    （年齢未登録を成人と推定しない。生年月日が満18歳未満と分かる人は0070の規則で保留。サロンへ返す関数は本マイグレーションには無い）
--    0070を後から適用する場合は、0070適用後にこのブロックだけを再実行する。
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.stylist_salon_publishable(uuid)') is not null then
    execute $f$
      create or replace function public.stylist_salon_publishable(p_user_id uuid)
      returns boolean language sql stable security definer set search_path = public, pg_temp
      as $b$
        select not coalesce(
          coalesce((select paused from public.feature_pauses where feature = 'minor_salon_public'), true)
          and (
            coalesce((select public.stylist_age_years(birth_date) < 18 from public.stylist_private where user_id = p_user_id), false)
            or (
              coalesce((select birth_date is null from public.stylist_private where user_id = p_user_id), true)
              and exists (select 1 from public.stylist_profiles sp where sp.user_id = p_user_id and sp.career_phase in ('student','new_graduate'))
            )
          ), false)
      $b$ $f$;
  end if;
end $$;

commit;
