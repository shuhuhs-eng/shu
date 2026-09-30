-- ============================================================================
-- Beauty Reach — 0028_salon_onboarding_organization_store
--
-- save_salon_profile()（現行0014版）を再定義し、新規サロンの初回プロフィール
-- 保存時に、salon_profilesだけでなく
--   ・user_roles(role='salon')
--   ・salon_organizations 1件
--   ・organization_members(company_owner) 1件
--   ・salon_stores 1件
--   ・store_members(store_manager) 1件
--   ・salon_onboarding_assignments 1件（初回判定専用の記録）
-- まで一貫して作成されるようにする。既存の12引数シグネチャ・戻り値
-- （public.profiles）・avatar検証・salon_profilesへの書き込み内容・
-- profiles(avatar_path/onboarding_step/profile_version)の更新は一切変更
-- しない。引数シグネチャが0014から不変のため、revoke/grantの再付与は不要
-- （0024と同じ考え方。関数属性がすべて0014と一致していることは末尾の
-- 「関数属性の確認」参照）。
--
-- ★既存migration(0001〜0027)は一切編集していない。
--
-- ----------------------------------------------------------------------------
-- 1. user_roles書き込み欠落の修正（調査で発見した既存バグ）
-- ----------------------------------------------------------------------------
-- 0007で追加された「insert into user_roles ... on conflict (user_id, role)
-- do nothing」は、0014がsave_salon_profile()を丸ごとcreate or replaceした際に
-- 引き継がれず欠落していた（0007〜0013の間は正しく動いていたが、0014以降の
-- 新規サロン登録はuser_roles(salon)が一切作られない状態になっていた）。
--
-- ★on conflictの対象は現在のuser_rolesの実際の制約を確認した上で選定した:
--   ・0006: primary key (user_id, role)
--   ・0008: 追加で unique制約 user_roles_user_id_key on (user_id) のみ
--     （「1 auth user = 1 role」を強制するための制約）
-- 現在実際に効いているのはunique(user_id)であるため、on conflict (user_id)
-- do nothing とする（0007当時のon conflict(user_id,role)は現在の制約と
-- 列構成が一致しないため使わない）。
--
-- ★DB側role guardを追加（UIのredirectだけに依存しない）:
-- 「stylist roleのユーザーがこのRPCを直接呼んだ場合にorganization/store
-- だけが作られてしまう」状態を防ぐため、本体処理の最初（既存のauth.uid()
-- null チェック直後）でcallerを検証する。
--   1. auth.uid() is not null（既存のまま）
--   2. profiles.role = 'salon' であること。0001で確認した通り
--      profiles.role は signup 時に handle_new_user() が
--      raw_user_meta_data.role から確定させる not null 列であり、
--      user_rolesがまだ存在しない新規サロンの初回save時点でも必ず
--      値を持っている（だからこそuser_rolesだけをguard条件にできない、
--      というご指摘の通りの理由でこちらを一次判定に使う）。
--      値がnullまたは'salon'以外ならraise exceptionで即停止する
--      （IS NULLを明示的に見て、NULL比較による判定すり抜けを防ぐ）。
--   3. 既にuser_rolesに行がある場合、それが'salon'以外（stylist等）なら
--      raise exceptionで即停止する（profiles.roleとuser_rolesが将来
--      何らかの理由で食い違った場合の二重防御）。行が無い場合（初回）は
--      素通りする。
-- 正規のサロンオンボーディング（profiles.role='salon'かつuser_rolesが
-- 空またはsalon）は一切影響を受けない。判定はavatar検証・salon_profiles
-- 書き込みより前に行うため、拒否対象の呼び出しはsalon_profilesにすら
-- 書き込まれない（トランザクション全体がguardの時点で止まる）。
--
-- ----------------------------------------------------------------------------
-- 2. organization/store冪等性の設計（修正版・最重要）
-- ----------------------------------------------------------------------------
-- 前回案（organization_members.role='company_owner'の存在で判定）は、
-- 「company_ownerは権限であり、初回オンボーディングで作成された
-- organizationを一意に表す識別子ではない」というご指摘を受けて撤回した。
-- 将来1ユーザーが複数organizationに所属できる設計（別organizationの
-- company_owner・company_admin等として招待されるケースを含む）を維持する
-- ため、「権限の有無」と「本人が初回オンボーディングで作成した
-- organization/storeがどれか」を混同しない設計に変更する。
--
-- ★新設: public.salon_onboarding_assignments
--   user_id（PK） × organization_id × store_id × created_at
-- を持つ専用の対応テーブル。membership（権限）テーブルとは完全に別概念で、
-- 「このsalon userが初回onboardingでどのorganization/storeを作ったか」
-- だけを一意に記録する。organization_members/store_membersのrole設計・
-- 主キー（1ユーザー複数organization所属を許す構造）は一切変更していない。
--
-- 初回判定は `exists(select 1 from salon_onboarding_assignments where
-- user_id = v_uid)` のみで行う。これは以下を満たす:
--   ・別organizationのcompany_owner/company_admin等として招待されている
--     だけのユーザーは、salon_onboarding_assignmentsに行を持たないため
--     「初回未実施」と正しく判定され、自分自身のorganization/storeが
--     問題なく作成される。
--   ・本人が既に自分自身のオンボーディングを完了済みであれば、
--     salon_onboarding_assignmentsに行があるため再作成されない。
--
-- ★既存GV（0027バックフィルでorganization/company_owner/store/
-- store_managerを作成済み）については、本migration内で
-- salon_onboarding_assignmentsへのバックフィルを行う。0027が
-- salon_organizations/salon_storesに付与したlegacy_salon_user_id
-- （旧salon_profiles.user_idを保持する、バックフィル専用のprovenance列。
-- 意味は今回も変更していない）を使ってGV由来のorganization/storeを
-- 正確に特定し、対応するuser_idで1行だけINSERTする。新規登録ユーザーの
-- 経路（save_salon_profile内）ではlegacy_salon_user_idは一切参照・
-- 書き込みしない（新規作成分は常にNULLのまま）。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0. salon_onboarding_assignments（初回オンボーディング対応表・新設）
-- ----------------------------------------------------------------------------
-- ★organization_id/store_idはあえてon delete cascadeにしない（デフォルトの
-- NO ACTION/RESTRICT相当）。このテーブルは「このuserの初回オンボーディングは
-- 既に完了した」というcanonical recordであり、参照先のorganization/storeが
-- 削除された拍子にこの行まで消えてしまうと、次回save_salon_profile()呼び出し
-- 時にv_already_onboardedが誤ってfalseと判定され、新しいorganization/store
-- が再作成されてしまう。そのため、この行が存在する限り参照先の
-- organization/storeを（cascadeで）簡単に削除できないようにする。
-- user_id → auth.usersのみ、本人アカウント削除時にこの記録自体が無意味になる
-- ためon delete cascadeのままとする。
create table public.salon_onboarding_assignments (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.salon_organizations(id),
  store_id        uuid not null references public.salon_stores(id),
  created_at      timestamptz not null default now()
);
comment on table public.salon_onboarding_assignments is
  '「このsalon userが初回オンボーディングでどのorganization/storeを作成したか」だけを一意に記録する、削除されない前提のcanonical record。organization_members/store_members（権限=membership）とは別概念であり、company_owner等のroleを初回判定に流用しないためにこのテーブルを使う。user_idがPKのため、1ユーザーにつき初回オンボーディングの記録は常に高々1件。organization_id/store_idはon delete cascadeにしていない（参照先が削除されるとこの記録も消え、次回保存時に新しいorganization/storeが再作成されてしまうため、参照先の安易な削除を防ぐ意図で通常のFK既定動作＝NO ACTIONのままにしている）。書き込みはsave_salon_profile() RPCおよび本migrationの既存データバックフィルのみ。';

alter table public.salon_onboarding_assignments enable row level security;
create policy salon_onboarding_assignments_select_own on public.salon_onboarding_assignments
  for select using (user_id = auth.uid());
revoke all on public.salon_onboarding_assignments from anon, authenticated;
grant select on public.salon_onboarding_assignments to authenticated;

-- ----------------------------------------------------------------------------
-- 0b. 既存データのバックフィル: 0027で作成済みのGV等（legacy_salon_user_id
--     が付与されたorganization/store）について、対応するsalon_onboarding_
--     assignmentsを補完する。user_id(PK)によりon conflictで安全に冪等。
-- ----------------------------------------------------------------------------
insert into public.salon_onboarding_assignments (user_id, organization_id, store_id)
select so.legacy_salon_user_id, so.id, ss.id
from public.salon_organizations so
join public.salon_stores ss on ss.legacy_salon_user_id = so.legacy_salon_user_id
where so.legacy_salon_user_id is not null
on conflict (user_id) do nothing;

-- ----------------------------------------------------------------------------
-- 1. save_salon_profile() の再定義
-- ----------------------------------------------------------------------------
create or replace function public.save_salon_profile(
  p_salon_name           text,
  p_prefecture           text,
  p_city                 text,
  p_street_address       text,
  p_culture_description  text,
  p_employee_size_code   text,
  p_target_specialties   text[],
  p_instagram_handle     text,
  p_bio                  text,
  p_visibility           public.profile_visibility,
  p_avatar_path          text,
  p_hotpepper_url        text default null
) returns public.profiles
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_avatar_path text;
  v_hotpepper_url text := nullif(trim(p_hotpepper_url), '');
  v_already_onboarded boolean;
  v_organization_id uuid;
  v_store_id uuid;
  v_profile_role public.user_role;
  v_existing_user_role public.user_role;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- ★0028で追加: DB側role guard（ファイル冒頭コメント参照）。
  -- UIのredirectだけに依存せず、このRPC自身が「salonとしてsignupした
  -- ユーザーであること」を検証する。user_rolesがまだ無い初回save時でも
  -- profiles.roleは必ず存在するため、こちらを一次判定に使う。
  select role into v_profile_role from public.profiles where id = v_uid;
  if v_profile_role is null or v_profile_role <> 'salon' then
    raise exception 'caller did not sign up as salon';
  end if;

  select role into v_existing_user_role from public.user_roles where user_id = v_uid;
  if v_existing_user_role is not null and v_existing_user_role <> 'salon' then
    raise exception 'caller already has a different role';
  end if;

  if v_hotpepper_url is not null and v_hotpepper_url !~ '^https://beauty\.hotpepper\.jp/.+$' then
    raise exception 'invalid hotpepper_url: must be an https://beauty.hotpepper.jp/ URL';
  end if;

  v_avatar_path := public.validate_and_normalize_avatar_path(v_uid, p_avatar_path);

  -- 対象行をロックしてから更新する（同一ユーザーからの同時保存要求を直列化）。
  -- ★この既存ロックにより、下のorganization/store冪等性チェックも同一
  -- ユーザーからの同時リクエストに対して安全に直列化される（新たな
  -- ロック処理は追加していない）。
  perform 1 from public.profiles where id = v_uid for update;

  insert into public.salon_profiles (
    user_id, salon_name, visibility, prefecture, city, street_address,
    culture_description, employee_size_code, target_specialties,
    instagram_handle, bio, hotpepper_url
  ) values (
    v_uid, p_salon_name, p_visibility, p_prefecture, nullif(trim(p_city), ''),
    nullif(trim(p_street_address), ''), nullif(trim(p_culture_description), ''),
    p_employee_size_code, p_target_specialties,
    nullif(trim(p_instagram_handle), ''), nullif(trim(p_bio), ''), v_hotpepper_url
  )
  on conflict (user_id) do update set
    salon_name           = excluded.salon_name,
    visibility            = excluded.visibility,
    prefecture            = excluded.prefecture,
    city                  = excluded.city,
    street_address        = excluded.street_address,
    culture_description   = excluded.culture_description,
    employee_size_code    = excluded.employee_size_code,
    target_specialties    = excluded.target_specialties,
    instagram_handle      = excluded.instagram_handle,
    bio                   = excluded.bio,
    hotpepper_url         = excluded.hotpepper_url;

  update public.profiles
    set avatar_path      = v_avatar_path,
        -- ここまでの全ての書き込みに成功した場合のみ到達し、COMPLETEへ進む。
        -- 途中で例外が発生した場合はこのUPDATEも含め全てロールバックされる。
        onboarding_step  = greatest(onboarding_step, 4), -- 4 = ONBOARDING_STEP.COMPLETE（lib/auth/onboarding.tsと値を同期させること）
        profile_version  = profile_version + 1
    where id = v_uid
    returning * into v_profile;

  -- ★0028で復元: 0007で追加されたが0014の再定義で欠落していたuser_roles
  -- 書き込み。on conflict対象は現在実際に効いているunique(user_id)制約に
  -- 一致させている（ファイル冒頭コメント参照）。
  insert into public.user_roles (user_id, role)
  values (v_uid, 'salon')
  on conflict (user_id) do nothing;

  -- ★0028で追加: 初回のみ会社・店舗・両担当者・対応表を作成する。
  -- 冪等性の判定はsalon_onboarding_assignmentsの存在有無のみで行う
  -- （organization_members.roleは一切見ない。理由はファイル冒頭コメント参照）。
  v_already_onboarded := exists (
    select 1 from public.salon_onboarding_assignments where user_id = v_uid
  );

  if not v_already_onboarded then
    insert into public.salon_organizations (name, status)
    values (coalesce(nullif(trim(p_salon_name), ''), '未設定サロン'), 'active')
    returning id into v_organization_id;

    insert into public.organization_members (organization_id, user_id, role)
    values (v_organization_id, v_uid, 'company_owner');

    insert into public.salon_stores (organization_id, store_name, status, usage_status, prefecture, city)
    values (
      v_organization_id,
      coalesce(nullif(trim(p_salon_name), ''), '未設定サロン'),
      'active',
      'active',
      p_prefecture,
      nullif(trim(p_city), '')
    )
    returning id into v_store_id;

    insert into public.store_members (store_id, user_id, role)
    values (v_store_id, v_uid, 'store_manager');

    -- 新規登録経路: legacy_salon_user_idは書き込まない（NULLのまま）。
    insert into public.salon_onboarding_assignments (user_id, organization_id, store_id)
    values (v_uid, v_organization_id, v_store_id);
  end if;

  return v_profile;
end;
$$;
comment on function public.save_salon_profile is 'サロンプロフィール保存の唯一の経路。SECURITY DEFINER関数。avatar検証・トランザクション範囲・profile_version/onboarding_step更新・エラーハンドリングはsave_stylist_profile()と完全に同一構造。0028で(0)処理開始直後にprofiles.role=salon（かつuser_rolesが既にあるなら値がsalonであること）をDB側で検証するrole guardを追加し、(1)0014で欠落していたuser_roles(salon)書き込みを復元し、(2)初回成功時のみsalon_organizations/organization_members(company_owner)/salon_stores/store_members(store_manager)/salon_onboarding_assignmentsを1件ずつ作成する処理を追加した。冪等性はsalon_onboarding_assignments（membership roleとは別概念の専用対応表）の存在有無で判定する（company_owner等のroleの有無・legacy_salon_user_id・会社名一致・新規unique制約は一切使わない）。引数シグネチャ・戻り値・salon_profiles/profilesへの既存書き込み内容は0014から変更していない。クライアントからの直接書き込みは許可しない。';

-- ----------------------------------------------------------------------------
-- 関数属性の確認（0014からの非退行確認用コメント）:
--   language plpgsql            … 0014と同一
--   security definer            … 0014と同一
--   set search_path = public, storage, pg_temp … 0014と同一
--   引数の型シグネチャ(12引数、型・順序とも) … 0014と同一のため、
--     0014で付与済みの以下のrevoke/grantがそのまま引き継がれる
--     （再付与は不要。0024と同じ考え方）:
--       revoke all on function public.save_salon_profile(
--         text, text, text, text, text, text, text[], text, text,
--         public.profile_visibility, text, text
--       ) from public, anon;
--       grant execute on function public.save_salon_profile(...) to authenticated;
-- ----------------------------------------------------------------------------

commit;
