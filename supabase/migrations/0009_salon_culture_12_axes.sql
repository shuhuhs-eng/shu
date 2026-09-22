-- ============================================================================
-- Beauty Reach — 0009_salon_culture_12_axes
--
-- 「サロンらしさ」診断を、確定した12軸・12問・5段階評価へ再構築する。
--
-- ★重要: 既存の salon_culture_profiles テーブル自体（schema）は変更しない。
-- culture_axes・answers はいずれも既に jsonb 型のため、新しいキー構成を
-- 追加するだけでカラム変更・ALTER TABLE は不要と判断した。
--
-- save_salon_culture_profile() のシグネチャ（引数の型・個数・順序）は
-- 0005_salon_culture.sql の時点から一切変更していない。create or replace
-- のため、既存のGRANT/REVOKE（0005で設定済み）もそのまま有効。
-- lib/salon-culture/actions.ts（呼び出し側）の変更は不要。
--
-- ★新しい12問のanswersキー（各1〜5の整数、5段階クリック回答をそのまま送る）:
--   q1_education_support         (Q1  教育支援)
--   q2_challenge_openness        (Q2  挑戦開放性)
--   q3_personal_brand_support    (Q3  個人ブランド支援)
--   q4_team_collaboration        (Q4  チーム協働)
--   q5_individual_autonomy       (Q5  個人裁量)
--   q6_work_flexibility          (Q6  働き方柔軟性)
--   q7_technical_specialization  (Q7  技術専門性)
--   q8_premium_value             (Q8  高付加価値)
--   q9_trend_orientation         (Q9  トレンド志向)
--   q10_creative_output          (Q10 クリエイティブ発信)
--   q11_relationship_distance    (Q11 人間関係の距離、スタッフ間)
--   q12_hierarchy_flatness       (Q12 上下関係・フラット度)
-- 各値(1〜5)を (value-1)*25 で0/25/50/75/100へ変換して culture_axes へ保存する。
-- 1が悪く5が良い、という意味ではなく、両端ともサロンの特徴を表す
-- （値自体に優劣の意味を持たせない。UI側でも同様の方針とする）。
--
-- ★旧5問（0005_salon_culture.sql、q1_new_hire_mistake等）からの移行方針:
--   ・education_support / challenge_openness / personal_brand_support は
--     軸名・0〜100の意味が新12軸のQ1〜Q3と完全に一致するため、そのまま
--     同じ軸名で新方式に統合する（このRPCが新方式で保存する際、これら
--     3軸は新しい回答（Q1〜Q3）から算出される）。
--   ・旧 management_style は新 individual_autonomy とは意味が異なる
--     （経営の意思決定スタイル vs 個人の裁量）ため、同一データとして
--     絶対に扱わない。このRPCは新12軸に management_style を含めない。
--   ・旧 customer_relationship_style（お客様との距離感）は新
--     relationship_distance（スタッフ同士の距離感）とは対象が異なる
--     ため、絶対に混同しない。このRPCは新12軸に
--     customer_relationship_style を含めない。
--   ・既存ユーザーで、まだ新12問に回答し直していない行は、この関数を
--     一度も呼ばない限り一切変更されない（culture_axesもanswersも
--     旧データのまま）。既存データの削除・書き換えは行わない。
--     UPDATEは、ユーザー本人が新ウィザードで再度回答し「保存」した
--     ときにのみ発生し、その場合は本人の最新の回答で上書きされる
--     （これは0005時点からの既存の途中保存の仕様と同じ挙動）。
--
-- ★value_priorities・comment は今回の変更対象外。既存のパラメータ
-- （p_value_priorities, p_comment）をそのまま受け取り、そのまま保存する
-- （ロジック変更なし）。
--
-- ★サロン8タイプ（main/sub）の算出は今回実装しない（次ステップ）。
-- ============================================================================

create or replace function public.save_salon_culture_profile(
  p_status public.salon_culture_status,
  p_respondent_role public.salon_culture_respondent_role,
  p_current_step integer,
  p_answers jsonb,
  p_value_priorities text[],
  p_comment text
) returns public.salon_culture_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_axes jsonb;
  v_top_label text;
  v_summary text;
  v_row public.salon_culture_profiles;

  -- 12問それぞれの回答(1〜5の整数)を一時的に受ける変数。
  v_a1 numeric; v_a2 numeric; v_a3 numeric; v_a4 numeric;
  v_a5 numeric; v_a6 numeric; v_a7 numeric; v_a8 numeric;
  v_a9 numeric; v_a10 numeric; v_a11 numeric; v_a12 numeric;

  -- 0〜100へ変換した後の12軸の値。
  v_educ numeric; v_chal numeric; v_brand numeric; v_team numeric;
  v_auto numeric; v_flex numeric; v_tech numeric; v_prem numeric;
  v_trend numeric; v_creative numeric; v_reldist numeric; v_hier numeric;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- 1〜5の整数のみ有効。範囲外・非整数・未回答(null)はnullのまま
  -- （途中保存を許可するため、未回答を許容する）。
  v_a1  := nullif((p_answers->>'q1_education_support'), '')::numeric;
  v_a2  := nullif((p_answers->>'q2_challenge_openness'), '')::numeric;
  v_a3  := nullif((p_answers->>'q3_personal_brand_support'), '')::numeric;
  v_a4  := nullif((p_answers->>'q4_team_collaboration'), '')::numeric;
  v_a5  := nullif((p_answers->>'q5_individual_autonomy'), '')::numeric;
  v_a6  := nullif((p_answers->>'q6_work_flexibility'), '')::numeric;
  v_a7  := nullif((p_answers->>'q7_technical_specialization'), '')::numeric;
  v_a8  := nullif((p_answers->>'q8_premium_value'), '')::numeric;
  v_a9  := nullif((p_answers->>'q9_trend_orientation'), '')::numeric;
  v_a10 := nullif((p_answers->>'q10_creative_output'), '')::numeric;
  v_a11 := nullif((p_answers->>'q11_relationship_distance'), '')::numeric;
  v_a12 := nullif((p_answers->>'q12_hierarchy_flatness'), '')::numeric;

  -- 1〜5の範囲外の値が来た場合は不正な入力として扱い、未回答(null)にする
  -- （防御的処理。フロント側のUIは1〜5のボタンしか送信しない設計だが、
  -- RPCとしても不正値をそのまま保存しないようにする）。
  if v_a1  is not null and (v_a1  < 1 or v_a1  > 5) then v_a1  := null; end if;
  if v_a2  is not null and (v_a2  < 1 or v_a2  > 5) then v_a2  := null; end if;
  if v_a3  is not null and (v_a3  < 1 or v_a3  > 5) then v_a3  := null; end if;
  if v_a4  is not null and (v_a4  < 1 or v_a4  > 5) then v_a4  := null; end if;
  if v_a5  is not null and (v_a5  < 1 or v_a5  > 5) then v_a5  := null; end if;
  if v_a6  is not null and (v_a6  < 1 or v_a6  > 5) then v_a6  := null; end if;
  if v_a7  is not null and (v_a7  < 1 or v_a7  > 5) then v_a7  := null; end if;
  if v_a8  is not null and (v_a8  < 1 or v_a8  > 5) then v_a8  := null; end if;
  if v_a9  is not null and (v_a9  < 1 or v_a9  > 5) then v_a9  := null; end if;
  if v_a10 is not null and (v_a10 < 1 or v_a10 > 5) then v_a10 := null; end if;
  if v_a11 is not null and (v_a11 < 1 or v_a11 > 5) then v_a11 := null; end if;
  if v_a12 is not null and (v_a12 < 1 or v_a12 > 5) then v_a12 := null; end if;

  -- 1→0, 2→25, 3→50, 4→75, 5→100
  v_educ    := case when v_a1  is null then null else (v_a1  - 1) * 25 end;
  v_chal    := case when v_a2  is null then null else (v_a2  - 1) * 25 end;
  v_brand   := case when v_a3  is null then null else (v_a3  - 1) * 25 end;
  v_team    := case when v_a4  is null then null else (v_a4  - 1) * 25 end;
  v_auto    := case when v_a5  is null then null else (v_a5  - 1) * 25 end;
  v_flex    := case when v_a6  is null then null else (v_a6  - 1) * 25 end;
  v_tech    := case when v_a7  is null then null else (v_a7  - 1) * 25 end;
  v_prem    := case when v_a8  is null then null else (v_a8  - 1) * 25 end;
  v_trend   := case when v_a9  is null then null else (v_a9  - 1) * 25 end;
  v_creative:= case when v_a10 is null then null else (v_a10 - 1) * 25 end;
  v_reldist := case when v_a11 is null then null else (v_a11 - 1) * 25 end;
  v_hier    := case when v_a12 is null then null else (v_a12 - 1) * 25 end;

  -- 未回答の軸はキー自体を含めない（jsonb_strip_nulls、既存パターン踏襲）。
  -- 旧軸（management_style / customer_relationship_style /
  -- team_collaboration_style）は新12軸の一部として一切含めない
  -- （意味が異なる、または対象が異なるため混同しない）。
  v_axes := jsonb_strip_nulls(jsonb_build_object(
    'education_support', v_educ,
    'challenge_openness', v_chal,
    'personal_brand_support', v_brand,
    'team_collaboration', v_team,
    'individual_autonomy', v_auto,
    'work_flexibility', v_flex,
    'technical_specialization', v_tech,
    'premium_value', v_prem,
    'trend_orientation', v_trend,
    'creative_output', v_creative,
    'relationship_distance', v_reldist,
    'hierarchy_flatness', v_hier
  ));

  -- ルールベースの簡易要約(仮実装。Anthropic APIは呼ばない)。
  -- education_support/challenge_openness/personal_brand_supportの3軸は
  -- 旧ロジックと同じ考え方（最も高い軸を採用）を維持する。旧
  -- customer_relationship_style部分は、新12問にはお客様との距離感を
  -- 測る質問が存在しないため、この部分の文言は生成しない
  -- （異なる概念のデータを混同して要約に混ぜない）。
  if v_educ is not null or v_chal is not null or v_brand is not null then
    if coalesce(v_chal, -1) >= coalesce(v_educ, -1) and coalesce(v_chal, -1) >= coalesce(v_brand, -1) then
      v_top_label := '新しい挑戦を歓迎する';
    elsif coalesce(v_brand, -1) >= coalesce(v_educ, -1) then
      v_top_label := '個人の発信・ブランドづくりを後押しする';
    else
      v_top_label := '丁寧な教育・育成を大切にする';
    end if;
    v_summary := v_top_label || 'サロンです。';
  else
    v_summary := null;
  end if;

  insert into public.salon_culture_profiles (
    salon_user_id, status, respondent_role, respondent_user_id, current_step,
    answers, culture_axes, value_priorities, comment, ai_summary
  ) values (
    v_uid, p_status, p_respondent_role, v_uid, p_current_step,
    coalesce(p_answers, '{}'::jsonb), v_axes, p_value_priorities, p_comment, v_summary
  )
  on conflict (salon_user_id) do update set
    status             = excluded.status,
    respondent_role     = excluded.respondent_role,
    current_step        = excluded.current_step,
    answers              = excluded.answers,
    culture_axes         = excluded.culture_axes,
    value_priorities     = excluded.value_priorities,
    comment              = excluded.comment,
    ai_summary           = excluded.ai_summary
  returning * into v_row;

  return v_row;
end;
$$;
