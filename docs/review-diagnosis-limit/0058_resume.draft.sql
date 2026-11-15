-- ============================================================================
-- 0058 再開SQL（草案・未適用）: 巻き戻し後に、制限の関数とトリガーを元どおり戻す
-- ============================================================================
-- ★このファイルは 0058_diagnosis_change_limits.draft.sql の2〜6章から機械的に作成したものです（手で編集しない）。
-- ★巻き戻し後は状態表が残っているため、0058本体の再実行（create table でエラーになる）では復旧できません。この再開SQLを使います。
--
-- 保持するもの（一切変更しない）:
--   diagnosis_change_limits（状態・変更回数・ロック日時）、diagnosis_save_requests（送信ID）、salon_culture_drafts（下書き）
-- 戻すもの: 関数（正規RPC・内部ゲート・状態取得・下書き・確定）と書き込み検査トリガー4つ（何度実行しても同じ結果）。
--
-- 巻き戻し中（制限が外れていた間）に保存された結果の扱い:
--   ・結果そのものは消さない（診断結果・サロンの確定結果は、そのまま残る）。
--   ・遡って回数を数えない・遡ってロックしない。状態表に記録のある人の変更回数・ロック日時は、巻き戻し前のまま。
--   ・状態表に記録が無い人（巻き戻し中に初めて保存した人など）は、末尾で「初回保存済み・ロックなし」の状態を作る
--     （0058本体の既存会員の扱いと同じ。導入後に1回変更でき、保存成功の時点から3か月ロック）。
--   ・巻き戻し中に変更して保存した人が、再開時点でロック中なら、その結果は残したまま、次回変更可能日時まで変更できない。
--   適用前に 0058_resume_precheck.sql で、状態表に記録されていない保存の件数を確認できる。
--
-- 0059（旧入口の権限整理）は巻き戻しで元に戻っている。再開後に必要なら、アプリ切替を確認してから別途適用する。
begin;

do $$
begin
  if to_regclass('public.diagnosis_change_limits') is null
     or to_regclass('public.diagnosis_save_requests') is null
     or to_regclass('public.salon_culture_drafts') is null then
    raise exception 'resume refused: 0058 state tables not found. Use 0058_diagnosis_change_limits.draft.sql for a first-time apply.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. 内部: 回数の判定と消費（呼び出し元と同じトランザクション内）
-- ---------------------------------------------------------------------------
-- 所有者ごとの直列化ロック（トランザクション内）。「最新回答の取得 → 変更判定 → 回数の更新 → 結果の保存」を
-- すべてこのロックの内側で行うため、呼び出し側は判定に使う最新回答を読む【前】に必ずこれを呼ぶ。
-- （同じトランザクション内で何度呼んでもよい。ゲート関数も同じロックを取る）
create or replace function public._diag_owner_lock(p_kind text, p_user_id uuid, p_store_id uuid) returns void
language sql security definer set search_path = public, pg_temp
as $$ select pg_advisory_xact_lock(hashtextextended(p_kind || ':' || coalesce(p_user_id::text, p_store_id::text), 0)) $$;
revoke all on function public._diag_owner_lock(text, uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public._diagnosis_limit_gate(
  p_kind text, p_user_id uuid, p_store_id uuid, p_request_id uuid,
  p_content_changed boolean, p_allow_change boolean,
  p_extra_completion boolean default false,
  p_content_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now    timestamptz := now();
  v_req    public.diagnosis_save_requests;
  v_lim    public.diagnosis_change_limits;
  v_action text;
  v_until  timestamptz;
begin
  if p_request_id is null then raise exception 'request id required'; end if;
  perform public._diag_owner_lock(p_kind, p_user_id, p_store_id);   -- 呼び出し側が先に取っていても同じロック（再入可）

  select * into v_req from public.diagnosis_save_requests where request_id = p_request_id;
  if found then
    if v_req.kind <> p_kind or v_req.user_id is distinct from p_user_id or v_req.store_id is distinct from p_store_id then
      raise exception 'request id reused';
    end if;
    if p_content_hash is not null and v_req.content_hash is not null and v_req.content_hash <> p_content_hash then
      raise exception 'request id content mismatch';   -- 同じ request_id で内容が違う
    end if;
    select * into v_lim from public.diagnosis_change_limits
      where kind = p_kind and user_id is not distinct from p_user_id and store_id is not distinct from p_store_id;
    return jsonb_build_object('action', v_req.action, 'replay', true, 'result_ref', v_req.result_ref,
                              'locked_until', v_lim.locked_until);
  end if;

  select * into v_lim from public.diagnosis_change_limits
    where kind = p_kind and user_id is not distinct from p_user_id and store_id is not distinct from p_store_id
    for update;

  if not found then
    insert into public.diagnosis_change_limits (kind, user_id, store_id, initial_saved_at)
      values (p_kind, p_user_id, p_store_id, v_now) returning * into v_lim;
    v_action := 'initial';
  elsif not p_allow_change then
    raise exception 'diagnosis_already_saved';
  elsif p_extra_completion then
    v_action := 'extra_completion';
  elsif not p_content_changed then
    v_action := 'unchanged';
  else
    if v_lim.locked_until is not null and v_now < v_lim.locked_until then
      raise exception 'diagnosis_change_locked'
        using detail = to_char(v_lim.locked_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    end if;
    -- 保存成功の時点から、日本時間の暦で3か月後の同時刻（月末は月内に丸める: 11/30 → 2/28）
    v_until := ((v_now at time zone 'Asia/Tokyo') + interval '3 months') at time zone 'Asia/Tokyo';
    update public.diagnosis_change_limits
       set last_change_at = v_now, change_count = change_count + 1, locked_until = v_until
     where id = v_lim.id returning * into v_lim;
    v_action := 'change';
  end if;

  insert into public.diagnosis_save_requests (request_id, kind, user_id, store_id, action, content_hash)
    values (p_request_id, p_kind, p_user_id, p_store_id, v_action, p_content_hash);

  return jsonb_build_object('action', v_action, 'replay', false, 'locked_until', v_lim.locked_until);
end;
$$;
revoke all on function public._diagnosis_limit_gate(text, uuid, uuid, uuid, boolean, boolean, boolean, text) from public, anon, authenticated, service_role;

-- 内部: 正規の確定関数だけが立てる、トランザクション内限定の合図
create or replace function public._diag_gate_open(p_kind text) returns void
language sql security definer set search_path = public, pg_temp
as $$ select set_config('app.diag_gate', p_kind, true) $$;
create or replace function public._diag_gate_close() returns void
language sql security definer set search_path = public, pg_temp
as $$ select set_config('app.diag_gate', '', true) $$;
revoke all on function public._diag_gate_open(text), public._diag_gate_close() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. 美容師診断・サロン診断14問: 確定保存（service_role専用）＋ 表のトリガー（直接INSERTも制限）
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
revoke all on function public.commit_diagnosis_result(uuid, uuid, boolean, text, public.diagnosis_mode, jsonb, smallint, smallint, smallint, smallint, smallint, smallint, text, text, smallint, text, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.commit_diagnosis_result(uuid, uuid, boolean, text, public.diagnosis_mode, jsonb, smallint, smallint, smallint, smallint, smallint, smallint, text, text, smallint, text, uuid, timestamptz) to service_role;

-- 正規関数を通らない直接INSERT（旧アプリ・service_roleのSQL）も、同じ規則で検査する。
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
revoke all on function public._trg_diagnosis_results_limit() from public, anon, authenticated, service_role;
drop trigger if exists trg_diagnosis_results_limit on public.diagnosis_results;
create trigger trg_diagnosis_results_limit before insert on public.diagnosis_results
  for each row execute function public._trg_diagnosis_results_limit();

-- ---------------------------------------------------------------------------
-- 4. 状態の読み取り（画面の案内用）
-- ---------------------------------------------------------------------------
create or replace function public.get_diagnosis_change_status(p_kind text, p_store_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_lim public.diagnosis_change_limits;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_kind = 'salon_culture_store' then
    if p_store_id is null or not public.is_store_accessible(p_store_id) then
      raise exception 'store not found or not accessible';
    end if;
    select * into v_lim from public.diagnosis_change_limits where kind = p_kind and store_id = p_store_id;
  elsif p_kind in ('stylist','salon_quiz','salon_culture_user') then
    select * into v_lim from public.diagnosis_change_limits where kind = p_kind and user_id = v_uid;
  else
    raise exception 'unknown kind';
  end if;
  if not found then return jsonb_build_object('state', 'none'); end if;
  if v_lim.locked_until is not null and now() < v_lim.locked_until then
    return jsonb_build_object('state', 'locked', 'locked_until', v_lim.locked_until, 'change_count', v_lim.change_count);
  end if;
  return jsonb_build_object('state', 'can_change', 'change_count', v_lim.change_count);
end;
$$;
revoke all on function public.get_diagnosis_change_status(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_diagnosis_change_status(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. サロンらしさ: 下書き（途中回答）と、公開中の確定結果を分ける
-- ---------------------------------------------------------------------------
-- 5-1. 下書き保存（回数を消費しない・公開中の結果は変えない）。店舗は既存の編集権限(can_edit_store_culture_analysis)が必要。閲覧専用は不可。
create or replace function public.save_salon_culture_draft(p_store_id uuid, p_payload jsonb, p_expected_rev integer default null)
returns public.salon_culture_drafts
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.salon_culture_drafts;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or pg_column_size(p_payload) > 20000 then
    raise exception 'invalid payload';
  end if;
  if p_store_id is null then
    select * into v_row from public.salon_culture_drafts where salon_user_id = v_uid for update;
  else
    if not public.can_edit_store_culture_analysis(p_store_id) then raise exception 'not allowed to edit this store'; end if;
    select * into v_row from public.salon_culture_drafts where store_id = p_store_id for update;
  end if;
  if found then
    -- 別タブ・別担当者が先に更新していたら、上書きしない（p_expected_rev を渡した場合）
    if p_expected_rev is not null and v_row.rev <> p_expected_rev then raise exception 'draft_changed'; end if;
    update public.salon_culture_drafts set payload = p_payload, rev = rev + 1, updated_by = v_uid
      where id = v_row.id returning * into v_row;
  elsif p_store_id is null then
    insert into public.salon_culture_drafts (salon_user_id, payload, updated_by) values (v_uid, p_payload, v_uid) returning * into v_row;
  else
    insert into public.salon_culture_drafts (store_id, payload, updated_by) values (p_store_id, p_payload, v_uid) returning * into v_row;
  end if;
  return v_row;
end;
$$;
revoke all on function public.save_salon_culture_draft(uuid, jsonb, integer) from public, anon, authenticated, service_role;
grant execute on function public.save_salon_culture_draft(uuid, jsonb, integer) to authenticated;

-- 5-2. 下書きの破棄（キャンセル）。回数を消費しない。
create or replace function public.discard_salon_culture_draft(p_store_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_store_id is null then
    delete from public.salon_culture_drafts where salon_user_id = v_uid;
  else
    if not public.can_edit_store_culture_analysis(p_store_id) then raise exception 'not allowed to edit this store'; end if;
    delete from public.salon_culture_drafts where store_id = p_store_id;
  end if;
end;
$$;
revoke all on function public.discard_salon_culture_draft(uuid) from public, anon, authenticated, service_role;
grant execute on function public.discard_salon_culture_draft(uuid) to authenticated;

-- 5-3. 確定: 下書き（12問＋任意で追加5問）を、同じトランザクションで公開し、回数を判定・消費する。
--      既存の保存関数（軸の計算式・検証）を内部で呼ぶだけで、式は複製しない。
create or replace function public.confirm_salon_culture_diagnosis(p_store_id uuid, p_request_id uuid, p_expected_rev integer default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid         uuid := auth.uid();
  v_kind        text := case when p_store_id is null then 'salon_culture_user' else 'salon_culture_store' end;
  v_draft       public.salon_culture_drafts;
  v_p           jsonb;
  v_answers     jsonb;
  v_extra       jsonb;
  v_pub_ans     jsonb;
  v_pub_status  public.salon_culture_status;
  v_old_extra   public.salon_culture_analysis_answers;
  v_base_new    jsonb;
  v_base_old    jsonb;
  v_changed     boolean;
  v_extra_first boolean := false;
  v_gate        jsonb;
  v_prio        text[];
  v_hash        text;
  k             text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;
  if p_store_id is not null and not public.can_edit_store_culture_analysis(p_store_id) then
    raise exception 'not allowed to edit this store';       -- 閲覧専用は確定できない
  end if;

  perform public._diag_owner_lock(v_kind, case when p_store_id is null then v_uid end, p_store_id);   -- ★公開中の回答を読む前にロックを取る
  if p_store_id is null then
    select * into v_draft from public.salon_culture_drafts where salon_user_id = v_uid for update;
  else
    select * into v_draft from public.salon_culture_drafts where store_id = p_store_id for update;
  end if;
  if not found then
    -- 再送: 下書きが確定済みで消えていても、同じ request_id なら1回目の結果を返す。
    if exists (select 1 from public.diagnosis_save_requests where request_id = p_request_id and kind = v_kind) then
      return public._diagnosis_limit_gate(v_kind, case when p_store_id is null then v_uid end, p_store_id, p_request_id, false, true, false, null);
    end if;
    raise exception 'draft not found';
  end if;
  if p_expected_rev is not null and v_draft.rev <> p_expected_rev then raise exception 'draft_changed'; end if;

  v_p := v_draft.payload;
  v_answers := v_p->'answers';
  v_extra := nullif(v_p->'extra', 'null'::jsonb);
  v_hash := md5(v_p::text);

  foreach k in array array['q1_education_support','q2_challenge_openness','q3_personal_brand_support','q4_team_collaboration',
                           'q5_individual_autonomy','q6_work_flexibility','q7_technical_specialization','q8_premium_value',
                           'q9_trend_orientation','q10_creative_output','q11_relationship_distance','q12_hierarchy_flatness'] loop
    if v_answers is null or jsonb_typeof(v_answers) <> 'object' or jsonb_typeof(v_answers->k) <> 'number'
       or (v_answers->>k)::numeric not between 1 and 5 then
      raise exception 'draft incomplete';
    end if;
  end loop;

  if p_store_id is null then
    select answers, status into v_pub_ans, v_pub_status from public.salon_culture_profiles where salon_user_id = v_uid;
    select * into v_old_extra from public.salon_culture_analysis_answers where salon_user_id = v_uid and analysis_version = 'salon-analysis-v1';
  else
    select answers, status into v_pub_ans, v_pub_status from public.salon_store_culture_profiles where store_id = p_store_id;
    select * into v_old_extra from public.salon_culture_analysis_answers where store_id = p_store_id and analysis_version = 'salon-analysis-v1';
  end if;

  v_changed := not coalesce(v_pub_status = 'completed' and v_pub_ans is not distinct from v_answers, false);
  v_base_new := public._salon_analysis_base_snapshot(v_answers, 'draft incomplete');
  if v_pub_status = 'completed' then
    v_base_old := public._salon_analysis_base_snapshot(v_pub_ans, 'invalid published base');
    if v_old_extra.id is not null then
      -- 追加5問が回答済みの人が、5軸に使う5問(q2,q3,q4,q5,q9)を変えるなら、追加5問も同時に答え直す。
      if v_base_new is distinct from v_base_old and v_extra is null then raise exception 'extra answers required'; end if;
      if v_extra is not null and v_extra->'answers' is distinct from v_old_extra.answers then v_changed := true; end if;
    elsif not v_changed and v_extra is not null then
      v_extra_first := true;    -- 12問は同じで、未回答だった追加5問を初めて完成させる。回数を消費しない。
    end if;
  end if;

  v_gate := public._diagnosis_limit_gate(v_kind, case when p_store_id is null then v_uid end, p_store_id, p_request_id,
                                         v_changed, true, v_extra_first, v_hash);
  if (v_gate->>'replay')::boolean then return v_gate; end if;

  v_prio := case when jsonb_typeof(v_p->'value_priorities') = 'array'
                 then array(select jsonb_array_elements_text(v_p->'value_priorities')) else null end;

  perform public._diag_gate_open(v_kind);
  if v_gate->>'action' in ('initial','change','unchanged') then   -- 'unchanged'でもコメント等の付随項目は反映（消費なし）
    if p_store_id is null then
      perform public.save_salon_culture_profile('completed', (v_p->>'respondent_role')::public.salon_culture_respondent_role,
        coalesce((v_p->>'current_step')::int, 0), v_answers, v_prio, nullif(v_p->>'comment', ''));
    else
      perform public.save_salon_store_culture_profile(p_store_id, 'completed', (v_p->>'respondent_role')::public.salon_culture_respondent_role,
        coalesce((v_p->>'current_step')::int, 0), v_answers, v_prio, nullif(v_p->>'comment', ''));
    end if;
  end if;
  if v_extra is not null then
    if p_store_id is null then
      perform public.save_salon_culture_analysis_answers(v_extra->>'version', v_extra->'answers', v_base_new);
    else
      perform public.save_salon_store_culture_analysis_answers(p_store_id, v_extra->>'version', v_extra->'answers', v_base_new);
    end if;
  end if;
  perform public._diag_gate_close();

  delete from public.salon_culture_drafts where id = v_draft.id;
  update public.diagnosis_save_requests set result_ref = v_kind where request_id = p_request_id;
  return v_gate;
end;
$$;
revoke all on function public.confirm_salon_culture_diagnosis(uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.confirm_salon_culture_diagnosis(uuid, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. 既存の表への「書き込み検査」トリガー（旧RPC・直接API・別経路でも迂回できない）
-- ---------------------------------------------------------------------------
-- 6-1. 本人用12問（salon_culture_profiles）
--   ・確定関数（app.diag_gate = salon_culture_user）: 通す。
--   ・店舗の確定関数による「初期店舗→本人」の既存同期（app.diag_gate = salon_culture_store）:
--       本人の行が確定済み（completed）なら、書き込まない（本人の確定結果とロックを上書きしない）。
--       行が無い／未確定なら、従来どおり書き込む（初期化）。その結果が completed なら、本人用の「初回保存」として状態を作る。
--   ・それ以外（旧RPC・直接API）: 確定済みの行の回答を変える／確定を取り消す更新は拒否。
--       未確定→確定になる書き込みは、本人用の「初回保存」として状態を作る（既に状態があれば変更として判定される）。
create or replace function public._trg_salon_culture_profiles_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tok text := coalesce(current_setting('app.diag_gate', true), '');
begin
  if v_tok = 'salon_culture_user' then return new; end if;
  -- 「INSERT ... ON CONFLICT DO UPDATE」の最初のINSERT検査は、行が既にあるなら素通りさせ、判定は続くUPDATEに任せる（二重判定しない）
  if tg_op = 'INSERT' and exists (select 1 from public.salon_culture_profiles where salon_user_id = new.salon_user_id) then
    return new;
  end if;

  if v_tok = 'salon_culture_store' then
    if tg_op = 'UPDATE' and old.status = 'completed' then
      return old;                                   -- 同期で本人の確定結果を上書きしない（スキップ）
    end if;
    -- 本人用の状態がまだ無いときだけ「初回保存」として作る（既にあれば、同期では回数を消費しない）
    if new.status = 'completed' and not exists (
         select 1 from public.diagnosis_change_limits where kind = 'salon_culture_user' and user_id = new.salon_user_id) then
      perform public._diagnosis_limit_gate('salon_culture_user', new.salon_user_id, null, gen_random_uuid(), true, true, false, null);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'completed'
     and (new.answers is distinct from old.answers or new.status <> 'completed') then
    raise exception 'diagnosis_use_confirm';        -- 確定済みの回答は、確定関数（回数制限つき）でしか変えられない
  end if;
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    perform public._diagnosis_limit_gate('salon_culture_user', new.salon_user_id, null, gen_random_uuid(), true, true, false, null);
  end if;
  return new;
end;
$$;
revoke all on function public._trg_salon_culture_profiles_limit() from public, anon, authenticated, service_role;
drop trigger if exists trg_salon_culture_profiles_limit on public.salon_culture_profiles;
create trigger trg_salon_culture_profiles_limit before insert or update on public.salon_culture_profiles
  for each row execute function public._trg_salon_culture_profiles_limit();

-- 6-2. 店舗用12問（salon_store_culture_profiles）: 同様。加えて、閲覧専用などの編集権限が無い人の書き込みは拒否。
create or replace function public._trg_salon_store_culture_profiles_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tok text := coalesce(current_setting('app.diag_gate', true), '');
begin
  if v_tok = 'salon_culture_store' then return new; end if;
  if auth.uid() is not null and not public.can_edit_store_culture_analysis(new.store_id) then
    raise exception 'not allowed to edit this store';
  end if;
  if tg_op = 'INSERT' and exists (select 1 from public.salon_store_culture_profiles where store_id = new.store_id) then
    return new;     -- ON CONFLICT DO UPDATE の最初のINSERT検査。判定は続くUPDATEに任せる
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed'
     and (new.answers is distinct from old.answers or new.status <> 'completed') then
    raise exception 'diagnosis_use_confirm';
  end if;
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    perform public._diagnosis_limit_gate('salon_culture_store', null, new.store_id, gen_random_uuid(), true, true, false, null);
  end if;
  return new;
end;
$$;
revoke all on function public._trg_salon_store_culture_profiles_limit() from public, anon, authenticated, service_role;
drop trigger if exists trg_salon_store_culture_profiles_limit on public.salon_store_culture_profiles;
create trigger trg_salon_store_culture_profiles_limit before insert or update on public.salon_store_culture_profiles
  for each row execute function public._trg_salon_store_culture_profiles_limit();

-- 6-3. 追加5問（本人・店舗）: 回答の変更は確定関数だけ。初めての回答（INSERT）は「同じ診断の完了」として通す。
create or replace function public._trg_salon_culture_analysis_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tok  text := coalesce(current_setting('app.diag_gate', true), '');
  v_kind text := case when new.store_id is null then 'salon_culture_user' else 'salon_culture_store' end;
begin
  if v_tok = v_kind then return new; end if;
  if new.store_id is not null and auth.uid() is not null and not public.can_edit_store_culture_analysis(new.store_id) then
    raise exception 'not allowed to edit this store';
  end if;
  if tg_op = 'UPDATE' and new.answers is distinct from old.answers then
    raise exception 'diagnosis_use_confirm';
  end if;
  return new;
end;
$$;
revoke all on function public._trg_salon_culture_analysis_limit() from public, anon, authenticated, service_role;
drop trigger if exists trg_salon_culture_analysis_limit on public.salon_culture_analysis_answers;
create trigger trg_salon_culture_analysis_limit before insert or update on public.salon_culture_analysis_answers
  for each row execute function public._trg_salon_culture_analysis_limit();

-- 巻き戻しの時刻の記録を、元のコメントに戻す
comment on table public.diagnosis_change_limits is
  '診断の変更回数制限の状態（所有者×種類で1行）。locked_until が null か過去なら変更を1回確定できる。書き込みは制限用の内部関数・トリガーだけ。';

-- ---------------------------------------------------------------------------
-- 7. 状態表に記録の無い所有者だけ、「初回保存済み・ロックなし」の状態を作る（既にある記録は変更しない）
-- ---------------------------------------------------------------------------
insert into public.diagnosis_change_limits (kind, user_id, initial_saved_at)
select case when mode = 'stylist' then 'stylist' else 'salon_quiz' end, user_id, min(created_at)
  from public.diagnosis_results group by 1, user_id
on conflict do nothing;
insert into public.diagnosis_change_limits (kind, user_id, initial_saved_at)
select 'salon_culture_user', salon_user_id, created_at from public.salon_culture_profiles where status = 'completed'
on conflict do nothing;
insert into public.diagnosis_change_limits (kind, store_id, initial_saved_at)
select 'salon_culture_store', store_id, created_at from public.salon_store_culture_profiles where status = 'completed'
on conflict do nothing;

commit;
