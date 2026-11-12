-- ============================================================================
-- 0057（レビュー用ドラフト。未適用・未コミット）:
--   新規登録・既存サロンの「店舗プロフィール」の整合性
-- ============================================================================
-- 背景（実コードで確認済み。docs/store-profile-sync-and-photos.md）:
--   旧 save_salon_profile() は salon_profiles に保存し、初回に会社・店舗を作るが、
--   salon_store_profiles（美容師向け表示の元）の行は作らない。そのため、新規登録しただけのサロンは
--   美容師向けの店舗表示（get_public_salon_store_detail / get_public_salon_stores）に出ない。
--
-- この変更の内容（既存の表・列・RLS・権限は変更しない。関数の再定義・追加と、既存データの補完、記録用テーブル1つの追加）:
--   1) save_salon_profile() の再定義: 0028 の本体に、「本当に新しい会社・店舗を作った初回登録のときだけ、
--      その新しい店舗の店舗プロフィールを、入力された内容で作る」INSERT を、初回登録ブロックの中に1つ足すだけ。
--      ・既存ユーザーの再保存では一切作らない（既存分の補完は下の 3) に一本化）。
--      ・公開設定は、その保存で利用者が選んだ値をそのまま使う。
--      引数・戻り値・権限は同一（再GRANT不要）。
--   2) update_salon_logo() の新規追加: 「ロゴ・写真・リンクを編集」画面からロゴ(profiles.avatar_path)だけを更新する。
--      salon_profiles（サロン名・所在地・紹介文・公開設定など）には一切触れないため、画面を開いた時点の古い値で
--      最新の内容を巻き戻すことがない。権限は authenticated のみに明示付与。
--   3) 既存データの補完（1回だけ・冪等）: 店舗プロフィール未作成で、旧プロフィールとの対応が一意に確認できる
--      店舗だけを対象に、旧プロフィールの内容をコピーして店舗プロフィールを作る。
--
-- 補完の対象条件（すべて満たす店舗のみ）:
--   ・salon_store_profiles に行が無い
--   ・salon_onboarding_assignments に、その店舗を指す行がちょうど1つ（= 旧ユーザーが一意）
--   ・その対応の organization_id が店舗の organization_id と一致
--   ・salon_stores.legacy_salon_user_id が NULL、またはその旧ユーザーと一致
--   ・その旧ユーザーの salon_profiles が存在する
--   対象外（自動補完しない。audit-store-profiles.sql の分類 B/C/D として別に報告）:
--   ・対応表に載らない店舗（2店舗目以降）、対応が複数・不一致の店舗、旧プロフィールが無い店舗
--
-- コピーする項目: salon_name, prefecture, city, street_address, culture_description,
--                 employee_size_code, target_specialties, bio, hotpepper_url
-- コピーしない項目:
--   ・instagram_handle（外部リンク salon_links へ移行済み。店舗プロフィールに列が無い）
--   ・サロンロゴ（profiles.avatar_path）、写真（salon_photos）、外部リンク（salon_links）
--   ・旧プロフィールの公開設定が PUBLIC の場合は、コピーせず PRIVATE にする（LIMITED / PRIVATE はそのまま）。
--
-- 補完で追加した行の記録（salon_store_profile_backfill_0057）:
--   店舗ID・作成した行の created_at / updated_at・保存列全体のハッシュ・補完元の旧ユーザーと旧公開設定を残す。
--   RLS有効・ポリシー無し・anon/authenticated/service_role の権限をすべて剥奪（アプリからは読み書き不可）。
--   取り消しは「現在の行の created_at・updated_at・保存列がすべて記録と一致する行」だけが対象。
--   補完後に1度でも更新された行（値を元へ戻した場合も updated_at が変わる）、削除後に作り直された行
--   （created_at が変わる）は対象にならない。手順: docs/review-0057/backfill-recheck-and-rollback.sql。
--
-- やらないこと: 旧プロフィールの削除・更新、店舗プロフィールの上書き、旧⇔新の双方向同期、
--               RLS・GRANT の変更（新規関数・新規表への明示付与を除く）、写真の割り当て。
-- ============================================================================

begin;

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

    -- ★0057で追加（これだけが新しい処理）: 今この保存で新しく作った店舗にだけ、入力内容から店舗プロフィールを作る。
    --   ・既存ユーザーの再保存（v_already_onboarded = true）では、ここに来ないので何も作らない。
    --   ・公開設定は、この保存で利用者自身が選んだ値をそのまま使う（作成によって勝手に公開しない）。
    --   ・以降の旧プロフィール保存は店舗プロフィールを更新しない（双方向同期はしない）。
    insert into public.salon_store_profiles (
      store_id, salon_name, visibility, prefecture, city, street_address,
      culture_description, employee_size_code, target_specialties, bio, hotpepper_url
    ) values (
      v_store_id, p_salon_name, p_visibility, p_prefecture, nullif(trim(p_city), ''),
      nullif(trim(p_street_address), ''), nullif(trim(p_culture_description), ''),
      p_employee_size_code, p_target_specialties, nullif(trim(p_bio), ''), v_hotpepper_url
    );
  end if;

  return v_profile;
end;
$$;

-- ----------------------------------------------------------------------------
-- ロゴだけを更新する関数（「ロゴ・写真・リンクを編集」画面用）
-- ----------------------------------------------------------------------------
create or replace function public.update_salon_logo(p_avatar_path text)
returns public.profiles
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_profile_role public.user_role;
  v_avatar_path text;
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select role into v_profile_role from public.profiles where id = v_uid;
  if v_profile_role is null or v_profile_role <> 'salon' then
    raise exception 'caller did not sign up as salon';
  end if;

  -- サロンとして登録を完了している（save_salon_profile 済み）ことを要求する。
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then
    raise exception 'salon registration not completed';
  end if;

  v_avatar_path := public.validate_and_normalize_avatar_path(v_uid, p_avatar_path);

  perform 1 from public.profiles where id = v_uid for update;

  -- 更新するのは profiles.avatar_path（と profile_version）だけ。salon_profiles / salon_store_profiles には触れない。
  update public.profiles
    set avatar_path     = v_avatar_path,
        profile_version = profile_version + 1
    where id = v_uid
    returning * into v_profile;

  return v_profile;
end;
$$;
comment on function public.update_salon_logo(text) is 'サロンロゴ(profiles.avatar_path)だけを更新する。サロン名・所在地・紹介文・公開設定などの旧プロフィール項目には触れない（古い画面の値で最新内容を巻き戻さないため）。';

revoke all on function public.update_salon_logo(text) from public, anon, authenticated, service_role;
grant execute on function public.update_salon_logo(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 既存データの補完の記録
-- ----------------------------------------------------------------------------
create table if not exists public.salon_store_profile_backfill_0057 (
  store_id            uuid primary key references public.salon_stores(id) on delete cascade,
  backfilled_at       timestamptz not null default now(),
  row_created_at      timestamptz not null,   -- 補完で作った行の created_at（削除後の作り直しを検知）
  row_updated_at      timestamptz not null,   -- 補完で作った行の updated_at（その後の更新を、値を戻した場合も含めて検知）
  content_hash        text not null,          -- 保存列全体（visibility含む）のハッシュ
  source_user_id      uuid not null,          -- 補完元の旧ユーザー
  source_visibility   public.profile_visibility not null  -- 補完元の旧プロフィールの公開設定
);
comment on table public.salon_store_profile_backfill_0057 is '0057の補完で作成した店舗プロフィールの記録。誤補完を、その後に編集・再作成された行を消さずに取り消すためだけに使う。アプリからは参照しない（RLS有効・ポリシー無し・権限無し）。';
alter table public.salon_store_profile_backfill_0057 enable row level security;
revoke all on public.salon_store_profile_backfill_0057 from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 既存データの補完（対応が一意な店舗のみ。既存の店舗プロフィールは上書きしない）
-- ----------------------------------------------------------------------------
with src as (
  select ss.id as store_id, sp.user_id as source_user_id, sp.visibility as source_visibility,
         sp.salon_name, sp.prefecture, sp.city, sp.street_address, sp.culture_description,
         sp.employee_size_code, sp.target_specialties, sp.bio, sp.hotpepper_url
  from public.salon_stores ss
  join (
    select store_id, min(user_id::text)::uuid as user_id, min(organization_id::text)::uuid as organization_id
    from public.salon_onboarding_assignments
    group by store_id
    having count(*) = 1
  ) a on a.store_id = ss.id
  join public.salon_profiles sp on sp.user_id = a.user_id
  where not exists (select 1 from public.salon_store_profiles x where x.store_id = ss.id)
    and a.organization_id = ss.organization_id
    and (ss.legacy_salon_user_id is null or ss.legacy_salon_user_id = a.user_id)
),
ins as (
  insert into public.salon_store_profiles (
    store_id, salon_name, visibility, prefecture, city, street_address,
    culture_description, employee_size_code, target_specialties, bio, hotpepper_url
  )
  select store_id, salon_name,
         case when source_visibility = 'PUBLIC' then 'PRIVATE'::public.profile_visibility else source_visibility end,
         prefecture, city, street_address, culture_description,
         employee_size_code, target_specialties, bio, hotpepper_url
  from src
  on conflict (store_id) do nothing
  returning *
)
insert into public.salon_store_profile_backfill_0057
  (store_id, row_created_at, row_updated_at, content_hash, source_user_id, source_visibility)
select i.store_id, i.created_at, i.updated_at,
       md5(row(i.salon_name, i.visibility, i.prefecture, i.city, i.street_address, i.culture_description,
               i.employee_size_code, i.target_specialties, i.bio, i.hotpepper_url)::text),
       src.source_user_id, src.source_visibility
from ins i
join src on src.store_id = i.store_id
on conflict (store_id) do nothing;

commit;
