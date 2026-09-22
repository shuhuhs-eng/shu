-- ============================================================================
-- Beauty Reach — 0014_salon_photos_hotpepper
--
-- サロン画像（内装・雰囲気、各最大3枚）・HOTPEPPER Beauty URLのバックエンド
-- 基盤。今回はmigrationとバックエンド設計のみ（アップロードUI・詳細ページ
-- 表示・signed URL発行は次ステップ）。
--
-- ★既存の avatars バケット・ポリシー、既存migration(0001〜0013)は一切
-- 変更しない（新規追加のみ）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. salon_profiles.hotpepper_url
--
-- CHECK制約でDBレベルの検証を担保する（テーブル自体への書き込みは既存どおり
-- save_salon_profile() RPC経由のみで、直接GRANTは無いため、これは
-- 「唯一の書き込み経路であるRPCにバグがあっても、DB自体が不正な値を
-- 拒否する」という多重防御の位置づけ）。null・空文字は許可、https の
-- beauty.hotpepper.jp 配下のURLのみ許可する。既存の instagram_handle 等の
-- 列・制約には一切触れていない。
-- ----------------------------------------------------------------------------
alter table public.salon_profiles
  add column hotpepper_url text
  check (
    hotpepper_url is null
    or hotpepper_url = ''
    or hotpepper_url ~ '^https://beauty\.hotpepper\.jp/.+$'
  );
comment on column public.salon_profiles.hotpepper_url is 'HOTPEPPER Beauty サロンページURL（任意）。NULL・空文字（未登録）または https://beauty.hotpepper.jp/ 配下のURLのみ許可（CHECK制約）。書き込みはsave_salon_profile()経由のみ（RPC内部でも空文字はnullif()によりNULLへ正規化してから保存するが、CHECK制約自体も空文字を独立して許可するため、RPCを経由しない万一の直接操作でも一貫した挙動になる）。';

-- ----------------------------------------------------------------------------
-- 2. salon_photos テーブル。
-- サロンの内装(interior)・雰囲気(atmosphere)画像、各カテゴリ最大3枚。
-- storage_path は必ず {salon_user_id}/{category}/{filename} 形式
-- （add_salon_photo()内で検証・強制する。下記5参照）。
--
-- ★最大3枚保証の設計（安全性再検証の結果、AFTER INSERT COUNTトリガー方式
-- から変更）: sort_order を 0〜2 の3値のみに制限するCHECK制約と、
-- unique(salon_user_id, category, sort_order) を組み合わせることで、
-- 1つの(salon_user_id, category)の組み合わせにつき、取りうるsort_order値が
-- {0,1,2}の3つしか無い以上、行数がDB構造そのものによって最大3行に
-- 限定される。これはPostgreSQLのUNIQUE制約（内部的にインデックスで
-- 排他制御される）に基づくため、並行INSERTを含めて完全にDBレベルで
-- 保証できる。
--
-- （旧: AFTER INSERTでcount(*)を見て3件超なら例外にする方式は、
-- 2つのトランザクションが同時に「現在2件・自分の1件を足して3件以内」と
-- それぞれ判定してコミットしてしまうと合計4件になり得るTOCTOU
-- （time-of-check to time-of-use）レース条件が理論上あり得たため、
-- この設計には採用しない。トリガー関数・トリガー自体は作らない。）
-- ----------------------------------------------------------------------------
create table public.salon_photos (
  id             uuid primary key default gen_random_uuid(),
  salon_user_id  uuid not null references public.profiles(id) on delete cascade,
  category       text not null check (category in ('interior', 'atmosphere')),
  storage_path   text not null unique,
  sort_order     integer not null check (sort_order between 0 and 2),
  created_at     timestamptz not null default now(),
  unique (salon_user_id, category, sort_order)
);
comment on table public.salon_photos is 'サロンの内装・雰囲気画像。sort_orderは0〜2のCHECK制約＋unique(salon_user_id, category, sort_order)により、1カテゴリにつき最大3行までしか物理的に存在できない（並行INSERTを含めてDB構造そのもので保証。AFTER INSERTトリガーには依存しない）。書き込みはadd_salon_photo()/update_salon_photo_sort_order()/delete_salon_photo() RPC経由のみ。RLSはSELECTも本人のみ（美容師からの直接SELECTは今回許可しない。PUBLICサロンの閲覧は将来、サーバー側でsigned URLを発行する別経路を想定）。';

alter table public.salon_photos enable row level security;

-- SELECTも本人のみ（美容師から salon_photos を直接自由にSELECTできるようには
-- しない。PUBLICサロンの写真閲覧は、将来サーバー側でsigned URLを発行する
-- 専用の経路を別途用意する想定）。
create policy salon_photos_select_own on public.salon_photos
  for select using (salon_user_id = auth.uid());

grant select on public.salon_photos to authenticated;
-- INSERT/UPDATE/DELETEはいずれもGRANTしない。書き込みは
-- add_salon_photo()/update_salon_photo_sort_order()/delete_salon_photo()のみ。

-- ----------------------------------------------------------------------------
-- 3. Storage bucket: salon-photos（private。既存avatarsバケットは無変更）。
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('salon-photos', 'salon-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- 4. Storage policies: salon-photos。既存avatarsの4ポリシー（本人フォルダ
-- （storage.foldername(name)の第1階層 = auth.uid()）のみselect/insert/
-- update/delete可）と同じ設計パターンを踏襲する。
-- storage_pathは {salon_user_id}/{category}/{filename} 形式のため、
-- 第1階層は引き続きsalon_user_id（=auth.uid()）であり、既存パターンが
-- そのまま適用できる。
-- ----------------------------------------------------------------------------
create policy salon_photos_storage_select_own on storage.objects
  for select using (
    bucket_id = 'salon-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy salon_photos_storage_insert_own on storage.objects
  for insert with check (
    bucket_id = 'salon-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy salon_photos_storage_update_own on storage.objects
  for update using (
    bucket_id = 'salon-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy salon_photos_storage_delete_own on storage.objects
  for delete using (
    bucket_id = 'salon-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ----------------------------------------------------------------------------
-- 5. validate_and_normalize_salon_photo_path(): 既存
-- validate_and_normalize_avatar_path() と同じ考え方の内部ヘルパー。
--   ・pathが {caller_uid}/{category}/... 形式であること
--   ・storage.objects に実在し、ownerが caller であること
--   ・pathの第2階層（category）が渡されたp_categoryと一致すること
-- を確認する。クライアントには一切GRANTしない（add_salon_photo()から
-- 内部的に呼ばれる）。
-- ----------------------------------------------------------------------------
create or replace function public.validate_and_normalize_salon_photo_path(
  p_uid uuid,
  p_category text,
  p_storage_path text
) returns text
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_path text := nullif(trim(p_storage_path), '');
  v_folder_uid text;
  v_folder_category text;
begin
  if v_path is null then
    raise exception 'storage_path is required';
  end if;

  v_folder_uid := split_part(v_path, '/', 1);
  v_folder_category := split_part(v_path, '/', 2);

  if v_folder_uid <> p_uid::text then
    raise exception 'invalid storage_path: must be under caller''s own folder';
  end if;

  if v_folder_category <> p_category then
    raise exception 'invalid storage_path: category segment does not match p_category';
  end if;

  if not exists (
    select 1 from storage.objects
    where bucket_id = 'salon-photos' and name = v_path and owner = p_uid
  ) then
    raise exception 'salon photo object not found or not owned by caller';
  end if;

  return v_path;
end;
$$;
comment on function public.validate_and_normalize_salon_photo_path is 'storage_pathが本人フォルダ配下の実在オブジェクトであり、category階層が一致することを検証する内部ヘルパー（validate_and_normalize_avatar_path()と同じ設計思想）。add_salon_photo()から呼ばれる。クライアントへは公開しない。';

revoke all on function public.validate_and_normalize_salon_photo_path(uuid, text, text) from public;
revoke all on function public.validate_and_normalize_salon_photo_path(uuid, text, text) from anon;
revoke all on function public.validate_and_normalize_salon_photo_path(uuid, text, text) from authenticated;

-- ----------------------------------------------------------------------------
-- 6. add_salon_photo(): 写真登録の唯一の経路。
--   ・auth.uid()確認、user_rolesでcaller=salon role確認
--     （save_salon_profile()完了後、既にuser_rolesにsalonが記録済みである
--     前提。0011〜0013と同じ確認パターン）。
--   ・category('interior'/'atmosphere')・p_sort_order(0〜2)・storage_path
--     所有権を検証。
--   ・カテゴリごとの現在の枚数を数え、3枚以上ならここで分かりやすいエラーを
--     返す（最大3枚という保証自体は、salon_photosのsort_order CHECK制約
--     ＋unique(salon_user_id, category, sort_order)がDB構造そのもので
--     並行INSERTを含めて担保しているため、このCOUNTチェックは「保証」では
--     なく「ユーザー向けに分かりやすいエラーメッセージを早期に返す」ための
--     ものと位置づける）。
-- ----------------------------------------------------------------------------
create or replace function public.add_salon_photo(
  p_category text,
  p_storage_path text,
  p_sort_order integer
) returns public.salon_photos
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_path text;
  v_count integer;
  v_row public.salon_photos;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.user_roles where user_id = v_uid and role = 'salon'
  ) then
    raise exception 'caller is not a salon';
  end if;

  if p_category not in ('interior', 'atmosphere') then
    raise exception 'invalid category: must be interior or atmosphere';
  end if;

  if p_sort_order is null or p_sort_order < 0 or p_sort_order > 2 then
    raise exception 'invalid sort_order: must be between 0 and 2';
  end if;

  select count(*) into v_count from public.salon_photos
    where salon_user_id = v_uid and category = p_category;
  if v_count >= 3 then
    raise exception 'category "%" already has the maximum of 3 photos', p_category;
  end if;

  v_path := public.validate_and_normalize_salon_photo_path(v_uid, p_category, p_storage_path);

  insert into public.salon_photos (salon_user_id, category, storage_path, sort_order)
  values (v_uid, p_category, v_path, p_sort_order)
  returning * into v_row;

  return v_row;
end;
$$;
comment on function public.add_salon_photo is 'サロン写真の登録。caller=salon role・storage_pathの本人所有権・categoryの整合性・sort_order(0〜2)を確認した上で登録する。最大3枚という保証自体は、salon_photosのsort_order CHECK制約＋unique(salon_user_id, category, sort_order)がDB構造そのもので並行INSERTを含めて担保する。ここでのcount(*)チェックはユーザー向けに分かりやすいエラーを早期に返すためのもの。SECURITY DEFINER、固定search_path。';

revoke all on function public.add_salon_photo(text, text, integer) from public;
revoke all on function public.add_salon_photo(text, text, integer) from anon;
grant execute on function public.add_salon_photo(text, text, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. update_salon_photo_sort_order(): 並び順のみ更新可能（category・
-- storage_pathは作成後変更不可。既存diagnosis_ai_outputs/
-- salon_culture_ai_outputsの「識別キーは不変」という設計思想を踏襲）。
-- ----------------------------------------------------------------------------
create or replace function public.update_salon_photo_sort_order(
  p_photo_id uuid,
  p_sort_order integer
) returns public.salon_photos
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.salon_photos;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.user_roles where user_id = v_uid and role = 'salon'
  ) then
    raise exception 'caller is not a salon';
  end if;

  if p_sort_order is null or p_sort_order < 0 or p_sort_order > 2 then
    raise exception 'invalid sort_order: must be between 0 and 2';
  end if;

  update public.salon_photos
    set sort_order = p_sort_order
    where id = p_photo_id and salon_user_id = v_uid
    returning * into v_row;

  if not found then
    raise exception 'salon photo not found or not owned by caller';
  end if;

  return v_row;
end;
$$;
comment on function public.update_salon_photo_sort_order is 'サロン写真の並び順のみを更新する。caller=salon role・所有権を確認する。category/storage_pathは変更できない。SECURITY DEFINER、固定search_path。';

revoke all on function public.update_salon_photo_sort_order(uuid, integer) from public;
revoke all on function public.update_salon_photo_sort_order(uuid, integer) from anon;
grant execute on function public.update_salon_photo_sort_order(uuid, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. delete_salon_photo(): DB行の削除。Storage上のオブジェクト自体の削除は
-- 対象外（クライアントが自身のフォルダに対して直接 storage.objects の
-- DELETEポリシー（上記4）経由で削除する想定。アップロード/削除UIは今回の
-- 実装範囲外のため、ここではDB行の削除のみを提供する）。
-- ----------------------------------------------------------------------------
create or replace function public.delete_salon_photo(
  p_photo_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.user_roles where user_id = v_uid and role = 'salon'
  ) then
    raise exception 'caller is not a salon';
  end if;

  delete from public.salon_photos
    where id = p_photo_id and salon_user_id = v_uid;

  if not found then
    raise exception 'salon photo not found or not owned by caller';
  end if;
end;
$$;
comment on function public.delete_salon_photo is 'サロン写真のDB行を削除する（Storage上のオブジェクト自体の削除は含まない。クライアントが自身のフォルダに対する既存のDELETE storageポリシー経由で別途削除する想定）。caller=salon role・所有権を確認する。SECURITY DEFINER、固定search_path。';

revoke all on function public.delete_salon_photo(uuid) from public;
revoke all on function public.delete_salon_photo(uuid) from anon;
grant execute on function public.delete_salon_photo(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. save_salon_profile() へ hotpepper_url を追加する。
--
-- ★重要: 単純に `create or replace function` で引数を1つ追加すると、
-- PostgreSQLは引数の型リストが異なる関数を「別のオーバーロード」として
-- 新規作成してしまい、既存の11引数版が残ってしまう（「唯一の書き込み
-- 経路」という既存設計が崩れる）。そのため、まず既存の11引数版を明示的に
-- DROPしてから、12引数版（p_hotpepper_url text default null を末尾に追加）
-- を作り直す。
--
-- p_hotpepper_url にデフォルト値nullを与えているため、既存の呼び出し元
-- （lib/salon/actions.ts、今回は変更しない）がこの新しい引数を渡さなくても
-- 既存の呼び出しはそのまま動作し続ける（プロフィールUI・Server Actionは
-- 今回変更しない、という要件を満たすための設計）。
--
-- 既存ロジック（avatar検証・トランザクション範囲・profile_version/
-- onboarding_step更新等）は一切変更していない。追加したのは
-- hotpepper_urlの検証（CHECK制約で最終防御しているが、ここでもraise
-- exceptionで分かりやすいエラーを返す）と、salon_profilesへの
-- upsert対象へのhotpepper_url追加のみ。
-- ----------------------------------------------------------------------------
drop function if exists public.save_salon_profile(
  text, text, text, text, text, text, text[], text, text, public.profile_visibility, text
);

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
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if v_hotpepper_url is not null and v_hotpepper_url !~ '^https://beauty\.hotpepper\.jp/.+$' then
    raise exception 'invalid hotpepper_url: must be an https://beauty.hotpepper.jp/ URL';
  end if;

  v_avatar_path := public.validate_and_normalize_avatar_path(v_uid, p_avatar_path);

  -- 対象行をロックしてから更新する（同一ユーザーからの同時保存要求を直列化）。
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

  return v_profile;
end;
$$;
comment on function public.save_salon_profile is 'サロンプロフィール保存の唯一の経路。SECURITY DEFINER関数。avatar検証・トランザクション範囲・profile_version/onboarding_step更新・エラーハンドリングはsave_stylist_profile()と完全に同一構造。差分は書き込み先テーブル（salon_profilesのみ。stylist側のstylist_private・user_settings.scout_enabledに相当するテーブルは無い）のみ。salon_profilesはupsertのため、handle_new_user()での事前作成が無くても初回保存として動作する。クライアントからの直接書き込みは許可しない。0014でp_hotpepper_url（デフォルトnull、既存呼び出し元への後方互換のため）を追加した。';

revoke all on function public.save_salon_profile(
  text, text, text, text, text, text, text[], text, text, public.profile_visibility, text, text
) from public;
revoke all on function public.save_salon_profile(
  text, text, text, text, text, text, text[], text, text, public.profile_visibility, text, text
) from anon;
grant execute on function public.save_salon_profile(
  text, text, text, text, text, text, text[], text, text, public.profile_visibility, text, text
) to authenticated;
