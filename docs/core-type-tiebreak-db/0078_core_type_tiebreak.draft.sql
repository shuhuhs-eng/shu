-- ============================================================================
-- 0078（草案・未適用）: 8タイプ判定の「同点時の順序」を明示する（save_core_type_result の置き換え）
-- ============================================================================
-- 目的: 8タイプの得点が同点のとき、アプリ（lib/diagnosis/core-types.ts の calculateCoreType）とDBで1位・2位が食い違わないようにする。
--   旧(0004): `order by value desc` だけで、同点の順序が未指定（実測では jsonb のキー順に従い、アプリの定義順と37%の同点で食い違った）。
--   新: 得点の降順 → 同点なら CORE_TYPE_CODES の定義順（shimei_jishaku, aisare_ace, niaiwase_master, trend_maker,
--        iyashi_charisma, repeat_king, mirai_no_ace, brand_builder）。1位・2位とも同じ規則。乱数や微小な加点で同点を隠さない。
-- 変更するのは並べ替えだけ。重み・得点の丸め（round(,1)）・履歴／初回確定への保存の仕方・引数・戻り値・権限は 0004 と同じ。
-- ★保存済みの履歴（stylist_core_type_history）と初回確定タイプ（stylist_core_type_assignments）は、この草案では一切変更しない。
--   新しい規則が効くのは、適用後に新しく保存される結果だけ（履歴は追記のみ・初回確定は上書きしない、という0004の規則のまま）。
-- 適用順: DB（この0078）→ アプリ（TS側の丸めの一致修正を含む版）。DBを先に適用しても、旧アプリは影響を受けない（旧アプリは保存結果を読むだけ）。
-- 適用済みの 0004 は編集しない。巻き戻しは 0078_rollback.draft.sql（0004の定義に戻す。履歴は変更しない）。
begin;
set local lock_timeout = '15s';
do $$
declare v_md5 text;
begin
  select md5(prosrc) into v_md5 from pg_proc where oid = to_regprocedure('public.save_core_type_result(uuid)');
  if v_md5 is null then raise exception '0078 aborted: save_core_type_result(uuid) not found'; end if;
  if v_md5 = 'ae6160867fd1cb88fd2cbb61c67dcb30' then raise exception '0078 is already applied'; end if;
  if v_md5 <> '319b6c1fd85ed6f22024d908a4b2bb3b' then raise exception '0078 aborted: save_core_type_result differs from the 0004 definition (md5 %)', v_md5; end if;
  if (select array_agg(e::text order by o) from unnest(enum_range(null::public.stylist_core_type)) with ordinality as t(e,o)) is distinct from array['shimei_jishaku','aisare_ace','niaiwase_master','trend_maker','iyashi_charisma','repeat_king','mirai_no_ace','brand_builder'] then
    raise exception '0078 aborted: stylist_core_type enum differs from the expected list';
  end if;
end $$;

create or replace function public.save_core_type_result(
  p_diagnosis_result_id uuid
) returns public.stylist_core_type_history
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_diag public.diagnosis_results;
  v_match jsonb := '{}'::jsonb;
  -- 同点のときの順序（0078で追加）。lib/diagnosis/core-types.ts の CORE_TYPE_CODES の定義順と同じ。
  v_order public.stylist_core_type[] := array['shimei_jishaku','aisare_ace','niaiwase_master','trend_maker','iyashi_charisma','repeat_king','mirai_no_ace','brand_builder']::public.stylist_core_type[];
  v_score numeric;
  v_top public.stylist_core_type;
  v_top_score numeric;
  v_second public.stylist_core_type;
  v_second_score numeric;
  v_history public.stylist_core_type_history;
  w record;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_diag
  from public.diagnosis_results
  where id = p_diagnosis_result_id and user_id = v_uid;

  if not found then
    raise exception 'diagnosis_result not found or not owned by caller';
  end if;

  -- 8タイプ分のmatchScoreをSQL側で独自に算出する（クライアント入力は一切使わない）。
  for w in
    select * from (values
      ('shimei_jishaku'::public.stylist_core_type,  0.20, 0.00, 0.50, 0.30, 0.00, 0.00),
      ('aisare_ace',       0.35, 0.00, 0.45, 0.00, 0.00, 0.20),
      ('niaiwase_master',  0.50, 0.35, 0.15, 0.00, 0.00, 0.00),
      ('trend_maker',      0.00, 0.50, 0.00, 0.35, 0.15, 0.00),
      ('iyashi_charisma',  0.00, 0.20, 0.50, 0.00, 0.00, 0.30),
      ('repeat_king',      0.35, 0.00, 0.40, 0.00, 0.25, 0.00),
      ('mirai_no_ace',     0.30, 0.00, 0.00, 0.20, 0.50, 0.00),
      ('brand_builder',    0.00, 0.00, 0.00, 0.45, 0.20, 0.35)
    ) as t(code, wt, ws, wh, wb, wa, wm)
  loop
    v_score := w.wt * v_diag.craft_score
             + w.ws * v_diag.sense_score
             + w.wh * v_diag.hospitality_score
             + w.wb * v_diag.brand_score
             + w.wa * v_diag.drive_score
             + w.wm * v_diag.mentor_score;
    v_match := v_match || jsonb_build_object(w.code, round(v_score, 1));
  end loop;

  -- 上位2件を抽出する。
  select (kv.key)::public.stylist_core_type, (kv.value)::numeric
    into v_top, v_top_score
  from jsonb_each_text(v_match) as kv
  order by (kv.value)::numeric desc, array_position(v_order, (kv.key)::public.stylist_core_type) asc
  limit 1;

  select (kv.key)::public.stylist_core_type, (kv.value)::numeric
    into v_second, v_second_score
  from jsonb_each_text(v_match) as kv
  where (kv.key)::public.stylist_core_type <> v_top
  order by (kv.value)::numeric desc, array_position(v_order, (kv.key)::public.stylist_core_type) asc
  limit 1;

  -- 履歴へ追加（同一診断への重複呼び出しは冪等に既存行を返す）。
  insert into public.stylist_core_type_history (
    user_id, diagnosis_result_id, top_type_code, second_type_code, score_gap, match_scores
  ) values (
    v_uid, p_diagnosis_result_id, v_top, v_second, round(v_top_score - v_second_score, 1), v_match
  )
  on conflict (diagnosis_result_id) do nothing
  returning * into v_history;

  if not found then
    select * into v_history
    from public.stylist_core_type_history
    where diagnosis_result_id = p_diagnosis_result_id;
  end if;

  -- コアタイプは初回のみ確定する。既に存在する場合は一切上書きしない
  -- （ON CONFLICT DO NOTHING）。将来の安定性アルゴリズムによる更新は
  -- 別途専用の仕組み（assignment_method='stability_algorithm'）で行う想定。
  insert into public.stylist_core_type_assignments (
    user_id, core_type_code, source_diagnosis_result_id, assignment_method
  ) values (
    v_uid, v_top, p_diagnosis_result_id, 'initial'
  )
  on conflict (user_id) do nothing;

  return v_history;
end;
$$;
comment on function public.save_core_type_result is '8タイプ判定を保存する唯一の経路。クライアントはdiagnosis_result_idのみ渡し、matchScore等の計算結果はこのRPCが診断結果の生スコアから独自に再計算する（クライアントが計算結果を偽って渡すことはできない）。履歴への追加は冪等。コアタイプの確定は初回のみで、以後は上書きしない。SECURITY DEFINER、固定search_path。同点のときは、得点の降順に続けて、lib/diagnosis/core-types.ts の CORE_TYPE_CODES の定義順（shimei_jishaku→aisare_ace→niaiwase_master→trend_maker→iyashi_charisma→repeat_king→mirai_no_ace→brand_builder）で1位・2位を決める（0078）。';
commit;
