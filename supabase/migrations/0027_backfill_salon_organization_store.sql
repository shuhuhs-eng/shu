-- ============================================================================
-- Beauty Reach — 0027_backfill_salon_organization_store
--
-- 0026で新設した「箱」（salon_organizations / organization_members /
-- salon_stores / store_members）へ、既存salon_profilesの各行を
-- 「会社1件 + 会社担当者(company_owner)1件 + 店舗1件 + 店舗担当者
-- (store_manager)1件」として複製するバックフィル。
--
-- ★スコープ（重要・厳守）:
--   ・既存salon_profilesはUPDATE/DELETEしない（読み取り専用の参照元）。
--   ・既存migration(0001〜0026)は一切編集していない。0026が作った
--     テーブルへのカラム追加はこのファイル内のALTER TABLEで行う
--     （0022がstylist_match_profiles等へ列追加したのと同じ手法。
--     0026ファイル自体は1文字も変更していない）。
--   ・save_salon_profile・onboarding・salon UI・scouts・salary_offers・
--     matching・salon_scout_quotas・notifications・salon_culture_profiles・
--     stylist_salon_interestsは一切参照・変更しない
--     （「既存1サロンを新構造にも複製する」だけがこのmigrationの仕事）。
--   ・ドライラン確認済み（salon_profiles=1件・user_roles(salon)=1件・
--     その他不整合0件・0026新テーブルは全て0件）を前提に設計している。
--
-- ★冪等性の設計（最重要）: 「同じ会社・店舗を重複作成しない」保証を、
-- 単純な名前一致ではなく、salon_organizations / salon_stores に新設する
-- legacy_salon_user_id（nullable・unique。あえてauth.usersへのFKは付けない）
-- で行う。
--   ・この列が非NULLの行は「salon_profilesからの自動バックフィルで
--     作られた会社/店舗である」ことを示す一意なマーカーになる。
--   ・UNIQUE制約により、同じsalon_profiles.user_idから複数回
--     バックフィルを実行しても、2件目以降は`on conflict ... do nothing`
--     で確実にスキップされる（同名の会社・店舗が将来別途手動作成されても
--     legacy_salon_user_idはNULLのままなので誤って衝突しない）。
--   ・別テーブル（migration専用mappingテーブル）を新設する案もあったが、
--     「この会社/店舗がどの旧salon_user_idから生まれたか」は将来の
--     サポート調査・監査でもそのまま役立つ情報のため、salon_organizations /
--     salon_stores自身の列として持たせる方を採用した（独立テーブルより
--     JOINが単純になる）。
--   ・auth.usersへのFKを付けない理由: この列は日々の業務ロジックが参照する
--     関係ではなく、「移行元がどのsalon_user_idだったか」を恒久的に記録する
--     provenance（移行元識別子）である。FKを付けると、将来そのauth.users
--     行が削除された際にon delete set null等でこの値が失われ、移行履歴を
--     追跡できなくなってしまう。そのため意図的にFK制約なしのuuid列とし、
--     UNIQUE制約のみを維持する。
--   ・organization_members / store_membersには新しい列を追加していない。
--     これらのINSERTは「legacy_salon_user_idで一意に解決したorganization_id /
--     store_id」と「user_id」の組でon conflictするため、既存の主キー
--     (organization_id, user_id) / (store_id, user_id)がそのまま冪等性を
--     保証する（新しいtracking列は不要）。
--
-- ★salon_name欠損への備え: ドライラン結果ではsalon_name='GV'で欠損は
-- 無かったが、salon_organizations.name / salon_stores.store_nameは
-- 0026でnot null + 1〜100文字のCHECK制約付きのため、将来別環境で
-- このmigrationが再利用される場合に備え、salon_nameがNULL/空文字の行は
-- '未設定サロン'にフォールバックする（salon_profiles自体は変更しない、
-- INSERT先の値だけの話）。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. 0026で作成済みのテーブルへ、バックフィル追跡用の列を追加する
--    （0026ファイル自体は編集していない。create or replace同様、既存
--    migrationへのcolumn追加は0022の前例と同じ手法）。
-- ----------------------------------------------------------------------------
alter table public.salon_organizations
  add column legacy_salon_user_id uuid unique;
comment on column public.salon_organizations.legacy_salon_user_id is
  '0027バックフィルで自動生成された行のみ非NULL。旧salon_profiles.user_idを保持し、「このsalon_user_idは既にどのorganizationへ移行済みか」を一意に判別するためのマーカー兼冪等キー。手動作成された会社ではNULLのまま。auth.usersへのFKはあえて付けない（通常の業務FKではなく移行元を恒久的に記録するprovenance列のため、参照先ユーザーが将来削除されてもこの値をNULL化・履歴消失させたくない）。';

alter table public.salon_stores
  add column legacy_salon_user_id uuid unique;
comment on column public.salon_stores.legacy_salon_user_id is
  '0027バックフィルで自動生成された行のみ非NULL。旧salon_profiles.user_idを保持し、「このsalon_user_idは既にどのstoreへ移行済みか」を一意に判別するためのマーカー兼冪等キー。手動作成された店舗ではNULLのまま。auth.usersへのFKはあえて付けない（通常の業務FKではなく移行元を恒久的に記録するprovenance列のため、参照先ユーザーが将来削除されてもこの値をNULL化・履歴消失させたくない）。';

-- ----------------------------------------------------------------------------
-- 2. salon_organizations: 未移行のsalon_profiles行につき1組織を作成。
--    既にlegacy_salon_user_idが一致する組織があれば何もしない（冪等）。
-- ----------------------------------------------------------------------------
insert into public.salon_organizations (name, status, legacy_salon_user_id)
select
  coalesce(nullif(trim(sp.salon_name), ''), '未設定サロン'),
  'active',
  sp.user_id
from public.salon_profiles sp
on conflict (legacy_salon_user_id) do nothing;

-- ----------------------------------------------------------------------------
-- 3. organization_members: 上で解決した組織へ、本人をcompany_ownerとして
--    追加する。organization_id×user_idの既存主キーが冪等性を保証する。
-- ----------------------------------------------------------------------------
insert into public.organization_members (organization_id, user_id, role)
select so.id, so.legacy_salon_user_id, 'company_owner'
from public.salon_organizations so
where so.legacy_salon_user_id is not null
on conflict (organization_id, user_id) do nothing;

-- ----------------------------------------------------------------------------
-- 4. salon_stores: 各組織につき1店舗を作成。今回の既存サロンはBeauty Reachを
--    現に利用中のため usage_status='active' とする（ご指示どおり）。
--    prefecture/cityはsalon_profilesの値をそのままコピーし、NULLはNULLの
--    まま許容する。
-- ----------------------------------------------------------------------------
insert into public.salon_stores (organization_id, store_name, status, usage_status, prefecture, city, legacy_salon_user_id)
select
  so.id,
  coalesce(nullif(trim(sp.salon_name), ''), '未設定サロン'),
  'active',
  'active',
  sp.prefecture,
  sp.city,
  sp.user_id
from public.salon_profiles sp
join public.salon_organizations so on so.legacy_salon_user_id = sp.user_id
on conflict (legacy_salon_user_id) do nothing;

-- ----------------------------------------------------------------------------
-- 5. store_members: 上で解決した店舗へ、本人をstore_managerとして追加する。
--    store_id×user_idの既存主キーが冪等性を保証する。
-- ----------------------------------------------------------------------------
insert into public.store_members (store_id, user_id, role)
select ss.id, ss.legacy_salon_user_id, 'store_manager'
from public.salon_stores ss
where ss.legacy_salon_user_id is not null
on conflict (store_id, user_id) do nothing;

commit;
