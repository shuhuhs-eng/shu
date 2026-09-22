-- ============================================================================
-- Beauty Reach — 0010_stylist_preference
--
-- 美容師側「働きたいサロン環境」Preference診断（8問・5段階・8軸）。
--
-- ★既存の30問美容師診断（才能診断・T/S/H/B/A/M・8タイプ・市場価値・AI）とは
-- 完全に別物。診断バンク（Q/QS）・diagnosis_results・calculateCoreType()・
-- save_core_type_result() など、既存の診断関連スキーマ・RPCには一切触れない。
--
-- ★salon_culture_profiles（0005/0009）と対称構造で設計した:
--   ・1ユーザー1行（stylist_user_id に unique制約）
--   ・生回答（answers）と変換後の軸（preference_axes）をjsonbで分離保存
--   ・書き込みは save_stylist_preference_profile() RPC経由のみ
--   ・RLSはSELECTのみ本人に許可、INSERT/UPDATEは一切GRANTしない
--
-- ★8軸（0〜100、(回答値-1)*25で変換。1が悪く5が良いという意味ではなく、
-- 両端とも「好みの方向」を表す）:
--   education_preference / challenge_preference / personal_brand_preference /
--   collaboration_preference / autonomy_preference /
--   work_flexibility_preference / relationship_distance_preference /
--   hierarchy_preference
--
-- ★今回はマッチング計算・相性％・Preference結果タイプ等は一切実装しない。
-- 8問への回答→8軸の保存までがスコープ。
-- ============================================================================

create type public.stylist_preference_status as enum ('draft', 'completed');

create table public.stylist_preference_profiles (
  id                uuid primary key default gen_random_uuid(),
  stylist_user_id   uuid not null unique references public.profiles(id) on delete cascade,
  status            public.stylist_preference_status not null default 'draft',
  current_step      integer not null default 0,
  -- 生の回答（q1_education_preference 等、1〜5の整数）。preference_axesの
  -- 正式値はこのRPCが算出する。answersは元データ（監査用・将来の再計算用）。
  answers           jsonb not null default '{}'::jsonb,
  -- 変換後の8軸（0/25/50/75/100）。クライアントは直接指定できない。
  -- save_stylist_preference_profile()がanswersから独自に算出する。
  preference_axes   jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.stylist_preference_profiles is '美容師の「働きたいサロン環境」Preference診断結果。1美容師につき1行。書き込みはsave_stylist_preference_profile() RPC経由のみ。既存の30問診断（才能・diagnosis_results）とは別物。相性計算・マッチングは今回未実装（将来、サロン側culture_axesとの比較に使う想定）。';
comment on column public.stylist_preference_profiles.preference_axes is '8軸すべて0〜100。education_preference/challenge_preference/personal_brand_preference/collaboration_preference/autonomy_preference/work_flexibility_preference/relationship_distance_preference/hierarchy_preference。クライアントは直接指定できない。';

create trigger trg_stylist_preference_profiles_updated
  before update on public.stylist_preference_profiles
  for each row execute function public.set_updated_at();

alter table public.stylist_preference_profiles enable row level security;
create policy stylist_preference_profiles_select_own on public.stylist_preference_profiles
  for select using (stylist_user_id = auth.uid());

grant select on public.stylist_preference_profiles to authenticated;
-- INSERT/UPDATEは意図的に一切GRANTしない。書き込みはsave_stylist_preference_profile() RPCのみ。

-- ----------------------------------------------------------------------------
-- save_stylist_preference_profile(): Preference回答を保存する唯一の経路。
-- クライアントはq1〜q8の生の回答値(1〜5)のみ渡し、0/25/50/75/100への変換は
-- このRPCがSQL側で行う。1ユーザー1行のupsertで、途中保存(draft)にも対応する。
-- SECURITY DEFINER、固定search_path（既存のsave_salon_culture_profile()と
-- 同じ設計方針）。
-- ----------------------------------------------------------------------------
create or replace function public.save_stylist_preference_profile(
  p_status public.stylist_preference_status,
  p_current_step integer,
  p_answers jsonb
) returns public.stylist_preference_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_axes jsonb;
  v_row public.stylist_preference_profiles;

  v_a1 numeric; v_a2 numeric; v_a3 numeric; v_a4 numeric;
  v_a5 numeric; v_a6 numeric; v_a7 numeric; v_a8 numeric;

  v_education numeric; v_challenge numeric; v_brand numeric; v_collab numeric;
  v_autonomy numeric; v_flexibility numeric; v_reldist numeric; v_hierarchy numeric;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- ★「1 auth user = 1 role」「user_rolesを正とする」という既存方針（0008
  -- user_roles_single_role.sql・lib/auth/user-roles.tsのhasCompletedRole()と
  -- 同じ判定基準）に合わせ、salon roleのユーザーがこのRPCを直接呼べない
  -- ようにする。stylist roleを持たない場合は例外にする（防御的処理。
  -- 通常はmiddleware/ページ側のrole guardで弾かれるが、RPCはSECURITY
  -- DEFINERであり、middlewareを経由しない直接呼び出しからも保護する）。
  if not exists (
    select 1 from public.user_roles where user_id = v_uid and role = 'stylist'
  ) then
    raise exception 'caller is not a stylist';
  end if;

  v_a1 := nullif((p_answers->>'q1_education_preference'), '')::numeric;
  v_a2 := nullif((p_answers->>'q2_challenge_preference'), '')::numeric;
  v_a3 := nullif((p_answers->>'q3_personal_brand_preference'), '')::numeric;
  v_a4 := nullif((p_answers->>'q4_collaboration_preference'), '')::numeric;
  v_a5 := nullif((p_answers->>'q5_autonomy_preference'), '')::numeric;
  v_a6 := nullif((p_answers->>'q6_work_flexibility_preference'), '')::numeric;
  v_a7 := nullif((p_answers->>'q7_relationship_distance_preference'), '')::numeric;
  v_a8 := nullif((p_answers->>'q8_hierarchy_preference'), '')::numeric;

  -- 1〜5の範囲外の値は不正な入力として扱い、未回答(null)にする（防御的処理）。
  if v_a1 is not null and (v_a1 < 1 or v_a1 > 5) then v_a1 := null; end if;
  if v_a2 is not null and (v_a2 < 1 or v_a2 > 5) then v_a2 := null; end if;
  if v_a3 is not null and (v_a3 < 1 or v_a3 > 5) then v_a3 := null; end if;
  if v_a4 is not null and (v_a4 < 1 or v_a4 > 5) then v_a4 := null; end if;
  if v_a5 is not null and (v_a5 < 1 or v_a5 > 5) then v_a5 := null; end if;
  if v_a6 is not null and (v_a6 < 1 or v_a6 > 5) then v_a6 := null; end if;
  if v_a7 is not null and (v_a7 < 1 or v_a7 > 5) then v_a7 := null; end if;
  if v_a8 is not null and (v_a8 < 1 or v_a8 > 5) then v_a8 := null; end if;

  -- 1→0, 2→25, 3→50, 4→75, 5→100
  v_education   := case when v_a1 is null then null else (v_a1 - 1) * 25 end;
  v_challenge   := case when v_a2 is null then null else (v_a2 - 1) * 25 end;
  v_brand       := case when v_a3 is null then null else (v_a3 - 1) * 25 end;
  v_collab      := case when v_a4 is null then null else (v_a4 - 1) * 25 end;
  v_autonomy    := case when v_a5 is null then null else (v_a5 - 1) * 25 end;
  v_flexibility := case when v_a6 is null then null else (v_a6 - 1) * 25 end;
  v_reldist     := case when v_a7 is null then null else (v_a7 - 1) * 25 end;
  v_hierarchy   := case when v_a8 is null then null else (v_a8 - 1) * 25 end;

  -- 未回答の軸はキー自体を含めない（jsonb_strip_nulls、salon_culture_profilesと同じ方針）。
  v_axes := jsonb_strip_nulls(jsonb_build_object(
    'education_preference', v_education,
    'challenge_preference', v_challenge,
    'personal_brand_preference', v_brand,
    'collaboration_preference', v_collab,
    'autonomy_preference', v_autonomy,
    'work_flexibility_preference', v_flexibility,
    'relationship_distance_preference', v_reldist,
    'hierarchy_preference', v_hierarchy
  ));

  insert into public.stylist_preference_profiles (
    stylist_user_id, status, current_step, answers, preference_axes
  ) values (
    v_uid, p_status, p_current_step, coalesce(p_answers, '{}'::jsonb), v_axes
  )
  on conflict (stylist_user_id) do update set
    status           = excluded.status,
    current_step     = excluded.current_step,
    answers          = excluded.answers,
    preference_axes  = excluded.preference_axes
  returning * into v_row;

  return v_row;
end;
$$;
comment on function public.save_stylist_preference_profile is '美容師「働きたいサロン環境」Preference回答を保存する唯一の経路。クライアントは1〜5の生の回答値のみ渡し、0/25/50/75/100への変換はこのRPCがSQL側で行う。1ユーザー1行のupsertで、途中保存(draft)にも対応する。SECURITY DEFINER、固定search_path。相性計算・マッチングは今回未実装。';

revoke all on function public.save_stylist_preference_profile(
  public.stylist_preference_status, integer, jsonb
) from public;
revoke all on function public.save_stylist_preference_profile(
  public.stylist_preference_status, integer, jsonb
) from anon;
grant execute on function public.save_stylist_preference_profile(
  public.stylist_preference_status, integer, jsonb
) to authenticated;
