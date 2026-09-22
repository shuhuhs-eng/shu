-- ============================================================================
-- Beauty Reach — 0005_salon_culture
--
-- 「サロンらしさ」入力機能 Sprint 1。
-- docs/salon-personality-design.md Ver2・docs/salon-culture-input-ux.md の設計に基づく。
--
-- Sprint 1のスコープ:
--   ・current_culture（実態）のみ保存する。aspired_culture（理想）は作らない
--   ・brand/store/recruitingの3層構造はまだ作らない（1サロン=1プロファイルの
--     シンプルな構造。将来の拡張はテーブル追加で対応する想定）
--   ・回答者情報（respondent_role / respondent_user_id）は保持するが、
--     承認フロー（confirmation_status等）はまだ作らない
--   ・AI要約はルールベースの簡易生成（Anthropic APIは呼ばない。仮実装）
--   ・美容師との比較・AIマッチング・在籍スタッフ分析は行わない
--
-- 設計方針（既存のstylist_core_type_*と同じ考え方）:
--   ・重要データ（将来のAIマッチングに使う）のため、クライアントから
--     CultureAxisの値を直接書き込める構造にはしない。
--   ・クライアントが渡せるのは「どの選択肢を選んだか」という生の回答のみ。
--     CultureAxisの数値化（スコア変換）はこのRPC自身がSQL側で行う。
--   ・途中保存（draft）に対応するため、質問に答えるたびにこのRPCを
--     呼び直す想定（upsert）。1サロンにつき1行のみ保持する。
-- ============================================================================

create type public.salon_culture_respondent_role as enum (
  'owner_representative', -- オーナー・代表者
  'store_manager',        -- 店舗責任者
  'recruiter_hr',         -- 採用担当
  'other'
);

create type public.salon_culture_status as enum ('draft', 'completed');

create table public.salon_culture_profiles (
  id                  uuid primary key default gen_random_uuid(),
  salon_user_id       uuid not null unique references public.profiles(id) on delete cascade,
  status              public.salon_culture_status not null default 'draft',
  respondent_role     public.salon_culture_respondent_role,
  respondent_user_id  uuid references public.profiles(id),
  current_step        integer not null default 0,
  -- 生の回答（質問コードごとの選択肢 or スライダー値）。CultureAxisの正式値は
  -- culture_axes 列であり、answers はその元データ（監査用・将来の再計算用）。
  answers              jsonb not null default '{}'::jsonb,
  -- CultureAxis（6軸のうち、Sprint1では5軸のみ算出。team_collaboration_styleは
  -- 追加プロフィール実装まで未算出＝キー自体が存在しない状態にする）。
  -- クライアントはこの列を直接指定できない。save_salon_culture_profile()が
  -- answersから独自に算出する。
  culture_axes         jsonb,
  value_priorities     text[] check (value_priorities is null or array_length(value_priorities, 1) = 3),
  comment              text check (comment is null or char_length(comment) <= 500),
  -- ルールベースの簡易要約（仮実装。Anthropic APIは呼ばない）。
  ai_summary           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.salon_culture_profiles is '「サロンらしさ」の入力結果(Sprint1: current_cultureのみ)。1サロンにつき1行。書き込みはsave_salon_culture_profile() RPC経由のみ。将来brand/store/recruitingの3層構造やaspired_culture、履行フローを追加する際は別テーブル・別カラムで拡張する想定（docs/salon-personality-design.md参照）。';
comment on column public.salon_culture_profiles.culture_axes is '6軸のうちSprint1で算出するのは5軸（education_support/challenge_openness/personal_brand_support/customer_relationship_style/management_style）。team_collaboration_styleは追加プロフィール実装まで未算出。クライアントは直接指定できない。';
comment on column public.salon_culture_profiles.ai_summary is 'Sprint1時点ではルールベースの簡易生成（仮実装）。将来的にAnthropic APIを使った本格的な要約生成に置き換える想定（既存の診断AI解説生成とは別系統）。';

create trigger trg_salon_culture_profiles_updated
  before update on public.salon_culture_profiles
  for each row execute function public.set_updated_at();

alter table public.salon_culture_profiles enable row level security;
create policy salon_culture_profiles_select_own on public.salon_culture_profiles
  for select using (salon_user_id = auth.uid());

grant select on public.salon_culture_profiles to authenticated;
-- INSERT/UPDATEは意図的に一切GRANTしない。書き込みはsave_salon_culture_profile() RPCのみ。

-- ---------- save_salon_culture_profile RPC ---------------------------------
-- クライアントは「選んだ選択肢」「スライダーの生の値」「価値観トップ3」
-- 「任意コメント」「回答者ロール」「現在のステップ」のみ渡す。CultureAxisの
-- 数値化・AI要約の生成はこのRPC自身がSQL側で行う（クライアントの入力値を
-- そのままCultureAxisとして信用しない）。
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
  v_educ numeric;
  v_chal numeric;
  v_brand numeric;
  v_mgmt numeric;
  v_cust numeric;
  v_axes jsonb;
  v_top_label text;
  v_cust_label text;
  v_summary text;
  v_row public.salon_culture_profiles;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- 度合い型3軸：4択の選択肢コード(a/b/c/d)をスコアへ変換する。
  v_educ := case p_answers->>'q1_new_hire_mistake'
    when 'a' then 90 when 'b' then 65 when 'c' then 40 when 'd' then 20 else null end;
  v_brand := case p_answers->>'q4_sns_delegation'
    when 'a' then 90 when 'b' then 65 when 'c' then 35 when 'd' then 20 else null end;
  v_chal := case p_answers->>'q5_new_challenge'
    when 'a' then 90 when 'b' then 65 when 'c' then 40 when 'd' then 20 else null end;

  -- 方向性型2軸：管理スタイルは4択(a=オーナー主導寄り 〜 d=権限委譲寄り)。
  v_mgmt := case p_answers->>'q2_decision_maker'
    when 'a' then 10 when 'b' then 35 when 'c' then 65 when 'd' then 90 else null end;

  -- 客との距離感はスライダーの生の値(0-100)をそのまま採用する(範囲のみ検証)。
  v_cust := (p_answers->>'q3_customer_distance')::numeric;
  if v_cust is not null then
    v_cust := greatest(0, least(100, v_cust));
  end if;

  -- team_collaboration_style はSprint1では未算出のため、キー自体を含めない。
  v_axes := jsonb_strip_nulls(jsonb_build_object(
    'education_support', v_educ,
    'challenge_openness', v_chal,
    'personal_brand_support', v_brand,
    'management_style', v_mgmt,
    'customer_relationship_style', v_cust
  ));

  -- ルールベースの簡易要約(仮実装。Anthropic APIは呼ばない)。
  if v_educ is not null or v_chal is not null or v_brand is not null then
    if coalesce(v_chal, -1) >= coalesce(v_educ, -1) and coalesce(v_chal, -1) >= coalesce(v_brand, -1) then
      v_top_label := '新しい挑戦を歓迎する';
    elsif coalesce(v_brand, -1) >= coalesce(v_educ, -1) then
      v_top_label := '個人の発信・ブランドづくりを後押しする';
    else
      v_top_label := '丁寧な教育・育成を大切にする';
    end if;
  end if;

  if v_cust is not null then
    v_cust_label := case when v_cust < 50 then 'お客様との親密な関係を大切にする'
                         else 'お客様との適度な距離感を大切にする' end;
  end if;

  if v_top_label is not null and v_cust_label is not null then
    v_summary := v_top_label || '、' || v_cust_label || 'サロンです。';
  elsif v_top_label is not null then
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
comment on function public.save_salon_culture_profile is '「サロンらしさ」の回答を保存する唯一の経路(Sprint1)。クライアントは選択肢コード・スライダーの生の値のみ渡し、CultureAxisの数値化とAI要約(仮実装・ルールベース)はこのRPCがSQL側で行う。1サロン1行のupsertで、途中保存(draft)にもそのまま対応する。SECURITY DEFINER、固定search_path。';

revoke all on function public.save_salon_culture_profile(
  public.salon_culture_status, public.salon_culture_respondent_role, integer, jsonb, text[], text
) from public;
revoke all on function public.save_salon_culture_profile(
  public.salon_culture_status, public.salon_culture_respondent_role, integer, jsonb, text[], text
) from anon;
grant execute on function public.save_salon_culture_profile(
  public.salon_culture_status, public.salon_culture_respondent_role, integer, jsonb, text[], text
) to authenticated;
