-- ============================================================================
-- 0072（草案・未適用）: 「サロン選びで大切にしたいこと」（stylist_profiles.value_priorities）だけを更新する専用の保存関数
-- ============================================================================
-- 目的: 診断結果からプロフィールへ反映するときに、プロフィール全項目を受け取る save_stylist_profile(_v2) を使うと、
--       別画面で同時に行った公開範囲・自己紹介などの変更を古い値で上書きしうる。この関数は value_priorities の1列だけを更新する。
-- ・引数は p_value_priorities のみ。公開範囲・生年月日・表示方法・その他のプロフィール項目は、引数で受け取らず、更新もしない。
-- ・本人確認: auth.uid()。更新するのは自分の stylist_profiles の行だけ（他人の行は指定できない）。
-- ・DB側の検証: 配列が1次元／ちょうど3件／NULL要素なし／重複なし／許可された12項目のみ（アプリの VALUE_PRIORITY_OPTIONS と同じ一覧）。
-- ・プロフィールが未保存なら作らずに拒否する（行は作らない）。既存の表・関数の定義は変更しない（関数1つの追加のみ）。
-- ・0070の before-update トリガー（生年月日・表示方法が未登録なら拒否）は、このUPDATEにも効く（既存の保存と同じ規則）。
-- ・profile_version は進めない（プロフィール全体の保存ではなく、1項目の更新のため。profiles を触らず、保存関数との行ロックの競合も増やさない）。
-- 前提: 0070 適用済み（save_stylist_profile_v2）。0071とは独立（0071の適用状態に依存しない）。
begin;
set local lock_timeout = '15s';

do $$
begin
  if to_regprocedure('public.save_stylist_profile_v2(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text)') is null then
    raise exception '0072 requires 0070 (save_stylist_profile_v2) to be applied first';
  end if;
  if to_regprocedure('public.set_stylist_value_priorities(text[])') is not null then
    raise exception '0072 is already applied (set_stylist_value_priorities exists)';
  end if;
end $$;

create function public.set_stylist_value_priorities(p_value_priorities text[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_allowed text[] := array[
    'work_life_balance','skill_growth','teamwork','independence','income_stability','customer_relationship',
    'education_support','brand_customer_base','work_flexibility','evaluation_fairness','location_convenience','culture_fit'];
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_value_priorities is null or array_ndims(p_value_priorities) is distinct from 1 or cardinality(p_value_priorities) <> 3 then
    raise exception 'invalid_value_priorities: exactly 3 items required' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_value_priorities) c where c is null) then
    raise exception 'invalid_value_priorities: null item' using errcode = '22023';
  end if;
  if (select count(distinct c) from unnest(p_value_priorities) c) <> 3 then
    raise exception 'invalid_value_priorities: duplicate items' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_value_priorities) c where c <> all (v_allowed)) then
    raise exception 'invalid_value_priorities: item not allowed' using errcode = '22023';
  end if;
  -- この1列だけを、本人の行にだけ書く。他の列は SET に含めない。
  update public.stylist_profiles set value_priorities = p_value_priorities where user_id = v_uid;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.set_stylist_value_priorities(text[]) from public, anon, authenticated, service_role;
grant execute on function public.set_stylist_value_priorities(text[]) to authenticated;
comment on function public.set_stylist_value_priorities(text[]) is '本人の value_priorities（サロン選びで大切にしたいこと）だけを更新する。ちょうど3件・重複なし・許可された12項目のみ。他のプロフィール項目は更新しない。';

commit;
