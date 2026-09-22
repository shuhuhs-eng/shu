-- ============================================================================
-- Beauty Reach — 0013_get_public_salon_culture_detail
--
-- 美容師向けサロン詳細画面（/stylist/salons/[salonUserId]）用の、
-- PUBLICサロンのCulture詳細・AI紹介文取得RPC。
--
-- ★既存の salon_culture_profiles・salon_culture_ai_outputs のRLSは
-- 「本人のみSELECT」のまま一切変更しない（新規ポリシー追加もしない）。
-- 代わりに、calculate_stylist_salon_match()（0011）と同じ設計思想の
-- SECURITY DEFINER RPCを新設し、PUBLICサロンに限定して必要最小限の
-- データのみを返す。
--
-- ★既存テーブル・既存RPC（calculate_stylist_salon_match・
-- create_salon_culture_ai_output・activate_salon_culture_ai_output等）は
-- 一切変更しない（新規追加のみ）。
-- ============================================================================

create or replace function public.get_public_salon_culture_detail(
  p_salon_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stylist_uid uuid := auth.uid();
  v_culture public.salon_culture_profiles;
  v_ai_essence jsonb;
  v_ai_explanation jsonb;
  v_ai_advice jsonb;
  v_ai_growth jsonb;
  v_ai jsonb;
begin
  if v_stylist_uid is null then
    raise exception 'not authenticated';
  end if;

  -- callerがstylist roleであることを確認（user_rolesを正とする既存方針、
  -- calculate_stylist_salon_match()と同じ確認パターン）。
  if not exists (
    select 1 from public.user_roles where user_id = v_stylist_uid and role = 'stylist'
  ) then
    raise exception 'caller is not a stylist';
  end if;

  -- 対象がsalon roleであることを確認。
  if not exists (
    select 1 from public.user_roles where user_id = p_salon_user_id and role = 'salon'
  ) then
    raise exception 'target is not a salon';
  end if;

  -- 対象サロンがvisibility='PUBLIC'であることを確認。PRIVATE/LIMITEDは拒否。
  if not exists (
    select 1 from public.salon_profiles
    where user_id = p_salon_user_id and visibility = 'PUBLIC'
  ) then
    raise exception 'target salon is not public';
  end if;

  select * into v_culture from public.salon_culture_profiles where salon_user_id = p_salon_user_id;

  -- サロンのCultureが未完了（行が無い＝select intoで全列null、または
  -- status != 'completed'）の場合は例外にせず、正常な戻り値として返す
  -- （calculate_stylist_salon_match()と同じ設計思想）。
  if v_culture.status is null or v_culture.status != 'completed' then
    return jsonb_build_object('available', false, 'reason', 'salon_culture_incomplete');
  end if;

  -- サロンCulture AI（0012_salon_culture_ai_outputs.sql）を取得する。
  -- 一部または全部が未生成でもRPC全体は失敗させず、availableな回答から
  -- 取得できた分だけを "ai" に詰める（見つからないoutput_typeはnullのまま）。
  select response into v_ai_essence from public.salon_culture_ai_outputs
    where salon_culture_profile_id = v_culture.id
      and output_type = 'essence' and is_current = true and prompt_version = 'salon-culture-v1';
  select response into v_ai_explanation from public.salon_culture_ai_outputs
    where salon_culture_profile_id = v_culture.id
      and output_type = 'explanation' and is_current = true and prompt_version = 'salon-culture-v1';
  select response into v_ai_advice from public.salon_culture_ai_outputs
    where salon_culture_profile_id = v_culture.id
      and output_type = 'advice' and is_current = true and prompt_version = 'salon-culture-v1';
  select response into v_ai_growth from public.salon_culture_ai_outputs
    where salon_culture_profile_id = v_culture.id
      and output_type = 'growth' and is_current = true and prompt_version = 'salon-culture-v1';

  if v_ai_essence is null and v_ai_explanation is null and v_ai_advice is null and v_ai_growth is null then
    v_ai := null;
  else
    v_ai := jsonb_build_object(
      'essence', v_ai_essence,
      'explanation', v_ai_explanation,
      'advice', v_ai_advice,
      'growth', v_ai_growth
    );
  end if;

  return jsonb_build_object(
    'available', true,
    'culture_profile_id', v_culture.id,
    'culture_axes', v_culture.culture_axes,
    'value_priorities', v_culture.value_priorities,
    'comment', v_culture.comment,
    'ai', v_ai
  );
end;
$$;
comment on function public.get_public_salon_culture_detail is '美容師向けサロン詳細画面用。引数は対象salon_user_idのみ、呼び出し美容師はauth.uid()から取得。caller=stylist role・対象=salon role・対象visibility=PUBLICをすべて確認した上で、対象のsalon_culture_profiles（culture_axes/value_priorities/comment）とsalon_culture_ai_outputsの現行AI（is_current=true・prompt_version=salon-culture-v1）を返す。salon_culture_profiles.status!=completedの場合はavailable:falseを返す（例外にしない）。AIが未生成でもRPC全体は失敗させない。既存RLS（本人のみSELECT）は一切変更していない。SECURITY DEFINER、固定search_path。';

revoke all on function public.get_public_salon_culture_detail(uuid) from public;
revoke all on function public.get_public_salon_culture_detail(uuid) from anon;
grant execute on function public.get_public_salon_culture_detail(uuid) to authenticated;
