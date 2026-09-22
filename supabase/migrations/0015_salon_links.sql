-- ============================================================================
-- Beauty Reach — 0015_salon_links
--
-- サロンの複数外部リンク（HOTPEPPER Beauty／公式ホームページ／求人・自社LP／
-- Instagram／その他、最大5件）と、美容師向けサロン詳細画面での
-- ①サロンロゴ（既存avatars）②サロン写真（既存0014 salon_photos）
-- ③外部リンク（本migrationで新設）の公開取得を実現する。
--
-- ★既存の salon_profiles.instagram_handle・salon_profiles.hotpepper_url は
-- 削除・変更しない（後方互換を維持。salon_linksは「追加で登録できる」
-- 新しい仕組みであり、既存2項目の代替ではない）。
-- ★既存migration(0001〜0014)・既存テーブル・既存RPC（calculate_stylist_salon_match・
-- get_public_salon_culture_detail・save_salon_profile・add_salon_photo等）は
-- 一切変更しない（新規追加のみ）。
-- ★既存の avatars バケット設定（public/file_size_limit/allowed_mime_types）・
-- 既存4ポリシー（avatars_select_own等）も一切変更しない。新しい閲覧用
-- ポリシーを1つ追加するのみ（下記5）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. salon_links テーブル。
-- サロン本人はRLSで直接INSERT/UPDATE/DELETE可能（0014のsalon_photosとは
-- 異なり、RPC経由に限定しない設計。書き込みロジック自体は
-- lib/salon-links/actions.ts のServer Action側で、空きsort_orderの算出・
-- 5件上限チェックを行った上でこのテーブルへ書き込む）。
--
-- 最大5件の保証: sort_orderを0〜4の5値のみに制限するCHECK制約と、
-- unique(salon_user_id, sort_order) を組み合わせる（0014のsalon_photosの
-- 「sort_order CHECK + UNIQUE」という、並行INSERTを含めてDB構造そのもので
-- 上限を保証する設計を踏襲）。
-- ----------------------------------------------------------------------------
create table public.salon_links (
  id             uuid primary key default gen_random_uuid(),
  salon_user_id  uuid not null references public.profiles(id) on delete cascade,
  link_type      text not null check (link_type in ('website', 'recruit', 'instagram', 'hotpepper', 'other')),
  label          text,
  url            text not null,
  sort_order     integer not null check (sort_order between 0 and 4),
  created_at     timestamptz not null default now(),
  unique (salon_user_id, sort_order)
);
comment on table public.salon_links is 'サロンの外部リンク（HOTPEPPER Beauty／公式ホームページ／求人・自社LP／Instagram／その他）。最大5件。sort_orderは0〜4のCHECK制約＋unique(salon_user_id, sort_order)により、並行INSERTを含めてDB構造そのもので上限を保証する。既存salon_profiles.instagram_handle/hotpepper_urlとは独立したデータであり、それらを置き換えるものではない（両方が同時に存在しうる）。RLSでサロン本人が直接CRUD可能。美容師からの直接SELECTはRLSで許可しない（get_public_salon_links() RPC経由のみ）。';

alter table public.salon_links enable row level security;

-- サロン本人はSELECT/INSERT/UPDATE/DELETEすべて可能（自分の行のみ）。
create policy salon_links_select_own on public.salon_links
  for select using (salon_user_id = auth.uid());
create policy salon_links_insert_own on public.salon_links
  for insert with check (salon_user_id = auth.uid());
create policy salon_links_update_own on public.salon_links
  for update using (salon_user_id = auth.uid()) with check (salon_user_id = auth.uid());
create policy salon_links_delete_own on public.salon_links
  for delete using (salon_user_id = auth.uid());

grant select, insert, update, delete on public.salon_links to authenticated;

-- ----------------------------------------------------------------------------
-- 1b. 既存 salon_profiles.hotpepper_url / instagram_handle の一回限りの
-- backfill。今後、外部リンクの編集はUI上でsalon_linksの1箇所に統一するため
-- （新UIからはinstagram_handle/hotpepper_url専用の入力欄を無くす）、既存値を
-- 失わないよう、新設したばかりのsalon_linksへコピーしておく。
--
-- ★salon_profiles.instagram_handle / hotpepper_url 列自体はこのmigrationでも
-- 一切変更・削除しない（後方互換のため列としては残す。UI側で今後これらの
-- 列を編集する入力欄が無くなるだけ）。
--
-- 安全性:
--   ・null/空文字の場合は対象外（該当行を生成しない）。
--   ・同一(salon_user_id, link_type)の行が既に存在する場合は作成しない
--     （NOT EXISTSで確認。このmigration内で salon_links は今しがた新設した
--     ばかりで元々0件のため実害は無いが、防御的に必ず確認する）。
--   ・sort_orderはサロンごとに0から採番するため、0〜4のCHECK制約・
--     unique(salon_user_id, sort_order)制約を壊さない（1サロンにつき
--     最大2行＝hotpepper・instagramのみのbackfillのため、0/1のみ使用）。
--   ・instagram_handle は "@" もURLも含まない値（既存validation:
--     /^[A-Za-z0-9._]*$/）のため、salon_linksのinstagram用URL形式
--     （https://(www.)?instagram.com/...）に変換してから格納する。
--   ・hotpepper_url は元々 https://beauty.hotpepper.jp/... 形式のため、
--     そのままurlへコピーするだけでよい。
-- ----------------------------------------------------------------------------
insert into public.salon_links (salon_user_id, link_type, label, url, sort_order)
select
  x.user_id,
  x.link_type,
  null,
  x.url,
  row_number() over (partition by x.user_id order by x.priority) - 1
from (
  select sp.user_id, 'hotpepper'::text as link_type, sp.hotpepper_url as url, 0 as priority
  from public.salon_profiles sp
  where sp.hotpepper_url is not null and sp.hotpepper_url <> ''
  union all
  select sp.user_id, 'instagram'::text as link_type,
    ('https://www.instagram.com/' || sp.instagram_handle || '/') as url, 1 as priority
  from public.salon_profiles sp
  where sp.instagram_handle is not null and sp.instagram_handle <> ''
) x
where not exists (
  select 1 from public.salon_links sl
  where sl.salon_user_id = x.user_id and sl.link_type = x.link_type
);

-- ----------------------------------------------------------------------------
-- 2. get_public_salon_links(): PUBLICサロンの外部リンクを美容師へ返す。
-- salon_linksテーブル自体への直接SELECTは美容師には許可していない
-- （RLSは本人のみ）ため、この専用RPCが唯一の閲覧経路になる。
-- calculate_stylist_salon_match()・get_public_salon_culture_detail()と
-- 同じ認可パターン（caller=stylist role・対象=salon role・対象visibility=PUBLIC）。
-- ----------------------------------------------------------------------------
create or replace function public.get_public_salon_links(
  p_salon_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stylist_uid uuid := auth.uid();
  v_links jsonb;
begin
  if v_stylist_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.user_roles where user_id = v_stylist_uid and role = 'stylist'
  ) then
    raise exception 'caller is not a stylist';
  end if;

  if not exists (
    select 1 from public.user_roles where user_id = p_salon_user_id and role = 'salon'
  ) then
    raise exception 'target is not a salon';
  end if;

  if not exists (
    select 1 from public.salon_profiles
    where user_id = p_salon_user_id and visibility = 'PUBLIC'
  ) then
    raise exception 'target salon is not public';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', sl.id,
      'link_type', sl.link_type,
      'label', sl.label,
      'url', sl.url,
      'sort_order', sl.sort_order
    ) order by sl.sort_order
  ), '[]'::jsonb)
  into v_links
  from public.salon_links sl
  where sl.salon_user_id = p_salon_user_id;

  return v_links;
end;
$$;
comment on function public.get_public_salon_links is '美容師向けサロン詳細画面用。引数は対象salon_user_idのみ、呼び出し美容師はauth.uid()から取得。caller=stylist role・対象=salon role・対象visibility=PUBLICを確認した上で、そのサロンのsalon_links（id/link_type/label/url/sort_order）をsort_order順のjsonb配列で返す（0件ならば空配列）。PRIVATE/LIMITEDサロンの場合は例外にする。SECURITY DEFINER、固定search_path。';

revoke all on function public.get_public_salon_links(uuid) from public;
revoke all on function public.get_public_salon_links(uuid) from anon;
grant execute on function public.get_public_salon_links(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. get_public_salon_photos(): PUBLICサロンの写真メタデータ（id/category/
-- storage_path/sort_orderのみ）を美容師へ返す。0014のsalon_photosテーブル
-- 自体は変更しない。RLSは本人のみSELECTのまま（新規ポリシー追加もしない）。
-- storage_pathを受け取ったNext.js側が、signed URLをサーバーサイドで
-- 別途生成する（本RPCはpublic URLも生成しない。生成できるのはpathのみ）。
-- ----------------------------------------------------------------------------
create or replace function public.get_public_salon_photos(
  p_salon_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stylist_uid uuid := auth.uid();
  v_photos jsonb;
begin
  if v_stylist_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.user_roles where user_id = v_stylist_uid and role = 'stylist'
  ) then
    raise exception 'caller is not a stylist';
  end if;

  if not exists (
    select 1 from public.user_roles where user_id = p_salon_user_id and role = 'salon'
  ) then
    raise exception 'target is not a salon';
  end if;

  if not exists (
    select 1 from public.salon_profiles
    where user_id = p_salon_user_id and visibility = 'PUBLIC'
  ) then
    raise exception 'target salon is not public';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', sp.id,
      'category', sp.category,
      'storage_path', sp.storage_path,
      'sort_order', sp.sort_order
    ) order by sp.category, sp.sort_order
  ), '[]'::jsonb)
  into v_photos
  from public.salon_photos sp
  where sp.salon_user_id = p_salon_user_id;

  return v_photos;
end;
$$;
comment on function public.get_public_salon_photos is '美容師向けサロン詳細画面用。引数は対象salon_user_idのみ、呼び出し美容師はauth.uid()から取得。caller=stylist role・対象=salon role・対象visibility=PUBLICを確認した上で、そのサロンのsalon_photos（id/category/storage_path/sort_orderのみ。回答内容等は含まない）をjsonb配列で返す（0件ならば空配列）。storage_pathからのsigned URL発行はNext.js側（呼び出し元）が行う。既存salon_photosのRLS（本人のみSELECT）は変更していない。SECURITY DEFINER、固定search_path。';

revoke all on function public.get_public_salon_photos(uuid) from public;
revoke all on function public.get_public_salon_photos(uuid) from anon;
grant execute on function public.get_public_salon_photos(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. avatarsバケットへ、PUBLICサロンのロゴ画像のみ美容師が閲覧できる
-- 新規ポリシーを1つ追加する。
--
-- ★重要: 既存4ポリシー（avatars_select_own/avatars_insert_own/
-- avatars_update_own/avatars_delete_own）・既存バケット設定
-- （public=false/file_size_limit/allowed_mime_types）は一切変更しない
-- （新規ポリシーの追加のみ）。stylist側のavatarには一切影響しない
-- （このポリシーはsalon_profilesのみをJOINしており、salon_profilesに
-- 該当行が無いstylistのアバターパスはこの条件を満たさない）。
--
-- avatarPathは "{userId}/avatar.webp" という固定形式
-- （components/profile/avatar-uploader.tsx）のため、
-- (storage.foldername(name))[1] が salon_profiles.user_id と一致し、
-- そのサロンがvisibility='PUBLICであれば、authenticatedユーザーは誰でも
-- そのオブジェクトをSELECT（createSignedUrlの前提となる読み取り権限）
-- できるようにする。
-- ----------------------------------------------------------------------------
create policy avatars_select_public_salon_logo on storage.objects
  for select using (
    bucket_id = 'avatars'
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'stylist'
    )
    and exists (
      select 1
      from public.salon_profiles sp
      join public.profiles p on p.id = sp.user_id
      where sp.user_id::text = (storage.foldername(name))[1]
        and sp.visibility = 'PUBLIC'
        and p.avatar_path = name
    )
  );
comment on policy avatars_select_public_salon_logo on storage.objects is '0015: PUBLICサロンが「現在profiles.avatar_pathとして登録している、その1枚のロゴ画像」のみを、ログイン済みのstylist roleユーザーに限りSELECT（signed URL発行の前提）を許可する最小権限ポリシー。p.avatar_path = name の完全一致条件により、そのuser_idフォルダ配下の全オブジェクトではなく、現在プロフィールに使用中の1枚だけに限定する（過去にアップロードして差し替えた未使用のavatarオブジェクトは、avatar_pathが更新された時点でこの条件を満たさなくなり、読めなくなる）。callerがuser_rolesでrole=stylistであることを確認するため、stylist以外の認証ユーザー（他のsalonアカウント等）はこのポリシーの対象外。既存のavatars_select_own（本人のみ）はそのまま維持されており、このポリシーはOR条件として追加されるだけ。stylist側のアバターにはsalon_profilesに該当行が存在しないため一切影響しない。PRIVATE/LIMITEDサロンのロゴはvisibility条件を満たさないため読めない。';
