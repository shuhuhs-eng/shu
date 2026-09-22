-- ============================================================================
-- Beauty Reach — 0012_salon_culture_ai_outputs
--
-- サロンCulture AI（「このサロンはどんな組織・職場か」を説明するAI解説）を、
-- 旧14問診断（diagnosis_results）・diagnosis_ai_outputsから完全に独立させる。
--
-- ★背景: diagnosis_ai_outputs.diagnosis_result_id は diagnosis_results(id)
-- への外部キー必須のため、旧14問診断を一度も受けていないサロン
-- （salon_culture_profiles.status='completed'のみ達成しているサロン）には
-- AI出力を保存できないという制約があった。14問診断は任意（必須ではない）
-- ため、これは要件として許容できない。本migrationは、AI出力の紐付け先を
-- salon_culture_profiles(id) に直接する専用テーブル・専用RPCを新設する
-- ことで、旧14問診断の有無に一切依存しない構造にする。
--
-- ★既存の diagnosis_ai_outputs・diagnosis_results・create_ai_output()・
-- activate_ai_output()・set_diagnosis_ai_status()・既存migration(0001〜0011)
-- は一切変更しない（新規追加のみ）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. テーブル本体。既存 diagnosis_ai_outputs と同じ設計思想（output_type・
-- provider・model・prompt_version・response・is_current・created_at）を
-- 踏襲し、紐付け先だけを salon_culture_profiles(id) に変更している。
-- ----------------------------------------------------------------------------
create table public.salon_culture_ai_outputs (
  id                        uuid primary key default gen_random_uuid(),
  salon_culture_profile_id  uuid not null references public.salon_culture_profiles(id) on delete cascade,
  output_type               public.ai_output_type not null,
  provider                  text not null,
  model                     text not null,
  prompt_version            text not null,
  response                  jsonb not null,
  is_current                boolean not null default true,
  created_at                timestamptz not null default now()
);
comment on table public.salon_culture_ai_outputs is 'サロンCulture AI生成物（「このサロンはどんな組織・職場か」の解説）。salon_culture_profiles 1件・用途(output_type)ごとに複数バージョンを保持可能。is_currentで現行版を示す（部分ユニークインデックスで一意性を保証）。diagnosis_results/旧14問診断には一切依存しない。書き込みはcreate_salon_culture_ai_output()/activate_salon_culture_ai_output()経由のみ。';
create index salon_culture_ai_outputs_profile_idx on public.salon_culture_ai_outputs (salon_culture_profile_id);

-- 同一(salon_culture_profile_id, output_type)で is_current=true は最大1件のみ許可。
create unique index salon_culture_ai_outputs_current_uniq
  on public.salon_culture_ai_outputs (salon_culture_profile_id, output_type)
  where is_current;

-- ----------------------------------------------------------------------------
-- 2. immutabilityトリガー。既存の enforce_ai_output_immutable_fields() は
-- new.diagnosis_result_id を直接参照するハードコードのため、
-- salon_culture_ai_outputs（diagnosis_result_id列を持たない）にはそのまま
-- 適用できない。既存関数・既存トリガー（diagnosis_ai_outputs側）は一切
-- 変更せず、同じ思想の専用関数を新設する。
-- ----------------------------------------------------------------------------
create or replace function public.enforce_salon_culture_ai_output_immutable_fields()
returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.salon_culture_profile_id is distinct from old.salon_culture_profile_id
     or new.output_type is distinct from old.output_type
     or new.provider is distinct from old.provider
     or new.model is distinct from old.model
     or new.prompt_version is distinct from old.prompt_version
     or new.response is distinct from old.response
     or new.created_at is distinct from old.created_at then
    raise exception 'salon_culture_ai_outputs: is_current 以外の列は更新できません';
  end if;
  return new;
end;
$$;
create trigger trg_salon_culture_ai_outputs_immutable
  before update on public.salon_culture_ai_outputs
  for each row execute function public.enforce_salon_culture_ai_output_immutable_fields();

-- ----------------------------------------------------------------------------
-- 3. RLS。本人（そのsalon_culture_profileのsalon_user_id）のみSELECT可能。
-- 他サロンのAIは絶対に読めない。INSERT/UPDATE/DELETEはクライアントへ
-- 一切GRANTしない（既存diagnosis_ai_outputsと同じ方針）。
-- ----------------------------------------------------------------------------
alter table public.salon_culture_ai_outputs enable row level security;

create policy salon_culture_ai_outputs_select_own on public.salon_culture_ai_outputs
  for select using (
    exists (
      select 1 from public.salon_culture_profiles scp
      where scp.id = salon_culture_ai_outputs.salon_culture_profile_id
        and scp.salon_user_id = auth.uid()
    )
  );

grant select on public.salon_culture_ai_outputs to authenticated;
-- INSERT/UPDATE/DELETEはいずれもGRANTしない。書き込みは
-- create_salon_culture_ai_output()/activate_salon_culture_ai_output()のみ。

-- ----------------------------------------------------------------------------
-- 4. create_salon_culture_ai_output(): AI生成物を is_current=false で
-- 新規登録する（既存 create_ai_output() と同じ設計。現行版への昇格は
-- activate_salon_culture_ai_output()で行う）。
--
-- ★認可設計（既存create_ai_output()より厳格化）:
--   ・auth.uid()で認証確認。
--   ・user_rolesでcaller=salon roleであることを確認
--     （0008/0010/0011で確立済みの既存パターンを踏襲）。
--   ・対象 salon_culture_profiles.salon_user_id = auth.uid() を確認
--     （他人のsalon_culture_profile_idを渡してAI出力を作成できないように
--     する。既存create_ai_output()のdiagnosis_results所有権確認と同じ思想）。
-- ----------------------------------------------------------------------------
create or replace function public.create_salon_culture_ai_output(
  p_salon_culture_profile_id uuid,
  p_output_type public.ai_output_type,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_response jsonb
) returns public.salon_culture_ai_outputs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.salon_culture_ai_outputs;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.user_roles where user_id = v_uid and role = 'salon'
  ) then
    raise exception 'caller is not a salon';
  end if;

  if not exists (
    select 1 from public.salon_culture_profiles
    where id = p_salon_culture_profile_id and salon_user_id = v_uid
  ) then
    raise exception 'salon_culture_profile not found or not owned by caller';
  end if;

  insert into public.salon_culture_ai_outputs
    (salon_culture_profile_id, output_type, provider, model, prompt_version, response, is_current)
  values
    (p_salon_culture_profile_id, p_output_type, p_provider, p_model, p_prompt_version, p_response, false)
  returning * into v_row;

  return v_row;
end;
$$;
comment on function public.create_salon_culture_ai_output is 'サロンCulture AI生成物を is_current=false で新規登録する（現行版への昇格はactivate_salon_culture_ai_output()で行う）。caller=salon role・対象salon_culture_profileの所有権をともに確認する。SECURITY DEFINER、固定search_path。diagnosis_results/旧14問診断には一切依存しない。';

revoke all on function public.create_salon_culture_ai_output(
  uuid, public.ai_output_type, text, text, text, jsonb
) from public;
revoke all on function public.create_salon_culture_ai_output(
  uuid, public.ai_output_type, text, text, text, jsonb
) from anon;
grant execute on function public.create_salon_culture_ai_output(
  uuid, public.ai_output_type, text, text, text, jsonb
) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. activate_salon_culture_ai_output(): 既存のAI生成結果を「現行版」として
-- 原子的に有効化する（既存 activate_ai_output() と同じ設計）。
--   ・所有権確認: 対象行が属する salon_culture_profiles を auth.uid()で
--     絞り込み、無ければ例外（他人のsalon_culture_profile_idに紐づく
--     ai_output_idを渡してもactivateできない）。
--   ・同時実行対策: 対象 salon_culture_profiles 行を SELECT ... FOR UPDATE
--     でロックしてから旧current解除→対象行のcurrent化を行う
--     （既存activate_ai_output()と同じ直列化パターン）。
-- ----------------------------------------------------------------------------
create or replace function public.activate_salon_culture_ai_output(
  p_ai_output_id uuid
) returns public.salon_culture_ai_outputs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_salon_culture_profile_id uuid;
  v_output_type public.ai_output_type;
  v_row public.salon_culture_ai_outputs;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.user_roles where user_id = v_uid and role = 'salon'
  ) then
    raise exception 'caller is not a salon';
  end if;

  select salon_culture_profile_id, output_type
    into v_salon_culture_profile_id, v_output_type
    from public.salon_culture_ai_outputs
    where id = p_ai_output_id;

  if not found then
    raise exception 'ai_output not found';
  end if;

  -- 対象salon_culture_profileの行ロック＝所有権確認と同時実行の直列化を同時に行う。
  perform 1 from public.salon_culture_profiles
    where id = v_salon_culture_profile_id and salon_user_id = v_uid
    for update;

  if not found then
    raise exception 'salon_culture_profile not found or not owned by caller';
  end if;

  update public.salon_culture_ai_outputs
    set is_current = false
    where salon_culture_profile_id = v_salon_culture_profile_id
      and output_type = v_output_type
      and is_current = true;

  update public.salon_culture_ai_outputs
    set is_current = true
    where id = p_ai_output_id
    returning * into v_row;

  return v_row;
end;
$$;
comment on function public.activate_salon_culture_ai_output is 'create_salon_culture_ai_output()で作成済みのAI生成物を現行版として原子的に有効化する唯一の経路。caller=salon role・所有権確認・行ロックによる直列化・固定search_pathを持つSECURITY DEFINER関数。クライアントからの直接UPDATEは許可しない。';

revoke all on function public.activate_salon_culture_ai_output(uuid) from public;
revoke all on function public.activate_salon_culture_ai_output(uuid) from anon;
grant execute on function public.activate_salon_culture_ai_output(uuid) to authenticated;
