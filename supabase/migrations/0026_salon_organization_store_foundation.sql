-- ============================================================================
-- Beauty Reach — 0026_salon_organization_store_foundation
--
-- サロン側を本来の「法人(会社) × 複数店舗」設計へ戻すための最小基盤。
-- docs/requirements-v1.0.md 5章「サロンの法人・店舗構造」・
-- docs/salon-personality-design.md 2章で設計済みだった
-- salon_organizations / salon_stores 系を、今回初めて実テーブルとして作成する。
--
-- ★今回のスコープ（重要・厳守）:
--   ・会社(salon_organizations)・会社担当者(organization_members)・
--     店舗(salon_stores)・店舗担当者(store_members) の「箱」を新設するのみ。
--   ・既存salon_profiles等からのバックフィル（既存1サロン=1会社+1店舗への
--     自動変換）は行わない（0027で分離して実施する）。
--   ・どのRPC・どの画面からも、この4テーブルを参照する処理は一切追加しない。
--     参照ゼロ＝既存機能への影響ゼロを機械的に保証する。
--   ・既存migration(0001〜0025)は一切編集していない。
--
-- ★既存user_rolesとの関係（重要）: organization_members.role /
-- store_members.role は、既存public.user_role enum（stylist/salon/admin、
-- 0008でuser_id単位のunique制約あり＝1 auth user = 1roleが確定事項）とは
-- 完全に別軸。既存enumへ値を追加せず、新しいtext列として独立させている。
-- 「salon roleを持つユーザーが、同時にどの会社の何担当か」を表現するのが
-- この4テーブルの役割であり、user_roles自体は今回1文字も変更しない。
--
-- ★権限モデル（今回実装するis_store_accessibleの設計判断・修正版）:
--   「会社そのものを閲覧できるか」(is_organization_member)と
--   「会社配下の店舗を操作できるか」(is_store_accessible)を明確に分離する。
--   store_id へのアクセスを許可する条件は以下のOR:
--     (a) そのstoreのorganization_idにorganization_membersの行を持ち、
--         かつそのroleがcompany_owner/company_admin/recruiting_adminの
--         いずれかである（全店舗へ自動的にアクセスできるのはこの3roleのみ。
--         area_managerはorganization_membersに所属していても、これだけでは
--         全店舗へアクセスできない）。
--     (b) そのstore_idにstore_membersの行を直接持つ
--         （store_manager・recruiter・viewer、および複数店舗を横断する
--         area_managerも、担当する店舗ごとにこの行を複数持つことで表現する。
--         例: 60店舗の会社でarea_managerが横浜・藤沢等の15店舗を担当する
--         場合、その15店舗分のstore_members行を持たせる）。
--   is_organization_member()自体は、organization_membersに行を持つ全員
--   （area_manager含む）に対してtrueを返す（会社情報の閲覧は許可する）。
--   全店舗操作の可否だけをroleで絞り込むのがis_store_accessible()の役割。
--   将来さらに細分化が必要になった場合は、is_store_accessible()を
--   create or replaceで拡張する（このファイル自体は今後編集しない）。
--
-- ★role候補の扱い: organization_members.role /
-- store_members.role はCHECK制約で候補値に絞っているが、これは最終確定
-- ではなく「今回の最小基盤としての初期候補」。将来値を追加・変更する場合は
-- 0022のstylist_match_profiles拡張と同じ手順
-- （drop constraint if exists → add constraint）で0027以降に対応する。
-- salon_organizations.status / salon_stores.status は用途未確定のため、
-- あえてCHECK制約を付けていない（デフォルト'active'のみ確定）。
-- salon_stores.usage_status は意味が明確に確定しているためCHECK制約を付けた。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. salon_organizations（会社・契約主体）
-- ----------------------------------------------------------------------------
create table public.salon_organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(trim(name)) between 1 and 100),
  status     text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.salon_organizations is
  '会社・契約主体。将来、契約プラン・請求・Stripe・店舗利用枠・成功報酬をこの単位に紐づける想定（0026時点ではその列は持たない）。書き込みは将来のSECURITY DEFINER RPC経由のみとし、クライアントからの直接INSERT/UPDATE/DELETEは許可しない。';
comment on column public.salon_organizations.status is
  '会社の状態。0026時点では意味・候補値を確定していないためCHECK制約を付けていない（デフォルトはactiveのみ）。用途が確定した時点で別migrationでCHECK制約を追加する想定。';

-- ----------------------------------------------------------------------------
-- 2. organization_members（会社に所属する担当者）
-- ----------------------------------------------------------------------------
create table public.organization_members (
  organization_id uuid not null references public.salon_organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null check (role in ('company_owner', 'company_admin', 'recruiting_admin', 'area_manager')),
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);
comment on table public.organization_members is
  '会社に所属する担当者（本部採用担当・エリア担当等）。既存user_roles（stylist/salon/adminのどのroleを持つか、1 auth user = 1role）とは完全に別軸。1ユーザーにつき1会社1行（主キーがorganization_id×user_id）。書き込みは将来のSECURITY DEFINER RPC経由のみ。';
comment on column public.organization_members.role is
  '0026時点の初期候補（company_owner/company_admin/recruiting_admin/area_manager）。最終確定ではなく、将来drop constraint→add constraintで拡張する前提。';

-- ----------------------------------------------------------------------------
-- 3. salon_stores（個別店舗・マッチング対象単位）
-- ----------------------------------------------------------------------------
create table public.salon_stores (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.salon_organizations(id) on delete cascade,
  store_name      text not null check (char_length(trim(store_name)) between 1 and 100),
  status          text not null default 'active',
  -- usage_status: 会社が保有する店舗のうち、Beauty Reachの採用機能を
  -- 実際に使っている店舗かどうか。将来「契約店舗枠」を超えてactiveにできない
  -- 制御はbilling/subscription側で行う想定で、0026では上限チェックを持たない。
  usage_status    text not null default 'inactive' check (usage_status in ('inactive', 'active')),
  prefecture      text,
  city            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.salon_stores is
  '個別店舗。AIマッチング・スカウト・メッセージ・条件提示・採用管理の対象単位（将来接続）。会社は保有する全店舗を登録できるが、usage_status=activeの店舗のみBeauty Reachの採用機能をONにできる想定（例: 保有60店舗・契約枠15店舗）。0026では詳細プロフィール列（住所詳細・SNS・写真等）はまだ持たず、既存salon_profilesからの移設は0027以降で扱う。書き込みは将来のSECURITY DEFINER RPC経由のみ。';
comment on column public.salon_stores.status is
  '店舗自体の状態。0026時点では意味・候補値を確定していないためCHECK制約を付けていない（デフォルトはactiveのみ）。';
comment on column public.salon_stores.usage_status is
  'inactive=会社に存在するがBeauty Reach採用機能未使用／active=採用機能利用中（求職者への公開・店舗単位マッチング・スカウト等の対象）。契約店舗枠の上限そのものは将来billing/subscription側で管理する。';

-- ----------------------------------------------------------------------------
-- 4. store_members（個別店舗を操作できる担当者）
-- ----------------------------------------------------------------------------
create table public.store_members (
  store_id   uuid not null references public.salon_stores(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('store_manager', 'recruiter', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);
comment on table public.store_members is
  '個別店舗を操作できる担当者（店長・採用担当・閲覧のみ等）。複数店舗を横断するエリア担当は、担当する店舗ごとにこの行を複数持つことで表現する（area_manager専用のroleはここには設けない）。書き込みは将来のSECURITY DEFINER RPC経由のみ。';
comment on column public.store_members.role is
  '0026時点の初期候補（store_manager/recruiter/viewer）。最終確定ではなく、将来drop constraint→add constraintで拡張する前提。';

-- ----------------------------------------------------------------------------
-- 5. index（membership・RLSアクセス判定で必要な最小限のみ）
-- ----------------------------------------------------------------------------
-- organization_members・store_membersは主キーの先頭列（organization_id /
-- store_id）は既にインデックス済みのため、逆方向（user_id起点）の検索用に
-- 追加する。salon_storesはorganization_id起点で店舗一覧を引く・
-- is_store_accessible()内のJOINで使うために追加する。
create index organization_members_user_id_idx on public.organization_members(user_id);
create index store_members_user_id_idx on public.store_members(user_id);
create index salon_stores_organization_id_idx on public.salon_stores(organization_id);

-- ----------------------------------------------------------------------------
-- 6. アクセス判定関数（将来の全RPC・RLSポリシーが共通利用する）
--    既存is_platform_admin()（0021）と同じ設計: language sql・stable・
--    security definer・search_path固定・authenticatedのみexecute可。
-- ----------------------------------------------------------------------------
create or replace function public.is_organization_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = auth.uid()
  );
$$;
comment on function public.is_organization_member(uuid) is
  '呼び出し本人(auth.uid())が指定organization_idの会社に所属しているか（roleを問わず、company_owner/company_admin/recruiting_admin/area_managerのいずれでもtrue）。「会社そのものの情報を閲覧できるか」の判定用であり、「会社配下の全店舗を操作できるか」はis_store_accessible()で別途判定する（area_managerは会社は見えるが、全店舗の操作権は持たない）。SECURITY DEFINERでorganization_members自体のRLSをバイパスして判定するため、RLSポリシー内から安全に呼び出せる。';
revoke all on function public.is_organization_member(uuid) from public, anon;
grant execute on function public.is_organization_member(uuid) to authenticated;

create or replace function public.is_store_accessible(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.salon_stores s
    where s.id = p_store_id
      and (
        -- 全店舗アクセス可能なのはcompany_owner/company_admin/recruiting_admin
        -- のみ。area_managerはここに含めない（organization_membersに
        -- 所属しているだけでは全店舗へアクセスできない）。
        exists (
          select 1 from public.organization_members om
          where om.organization_id = s.organization_id
            and om.user_id = auth.uid()
            and om.role in ('company_owner', 'company_admin', 'recruiting_admin')
        )
        -- area_manager・store_manager・recruiter・viewerは、担当する
        -- store_id分だけstore_membersに行を持つことでアクセス範囲を表現する。
        or exists (
          select 1 from public.store_members sm
          where sm.store_id = s.id and sm.user_id = auth.uid()
        )
      )
  );
$$;
comment on function public.is_store_accessible(uuid) is
  '呼び出し本人(auth.uid())が指定store_idへアクセスできるか。organization_membersのroleがcompany_owner/company_admin/recruiting_adminの場合のみ所属会社の全店舗にアクセス可（area_managerはここに含めない）。それ以外（area_manager含む）は、store_membersに当該store_idの行を直接持つ場合にのみアクセス可。「会社を見られる」(is_organization_member)と「会社の全店舗を操作できる」は別軸であり、本関数はarea_managerに全店舗アクセスを与えない。SECURITY DEFINERで関連テーブルのRLSをバイパスして判定するため、salon_stores自体のRLSポリシー内から安全に呼び出せる。';
revoke all on function public.is_store_accessible(uuid) from public, anon;
grant execute on function public.is_store_accessible(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. RLS（4テーブルすべて有効化。書き込みは将来のSECURITY DEFINER RPC経由の
--    みとし、クライアントからの直接INSERT/UPDATE/DELETEは一切許可しない
--    ＝insert/update/delete用のpolicy・grantを意図的に一切作らない）。
-- ----------------------------------------------------------------------------
alter table public.salon_organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.salon_stores enable row level security;
alter table public.store_members enable row level security;

create policy salon_organizations_select_member on public.salon_organizations
  for select using (public.is_organization_member(id));

create policy organization_members_select_own on public.organization_members
  for select using (user_id = auth.uid());

create policy salon_stores_select_accessible on public.salon_stores
  for select using (public.is_store_accessible(id));

create policy store_members_select_own on public.store_members
  for select using (user_id = auth.uid());

-- Supabaseのdefault privilegesによる意図しない付与に備え、既存テーブル
-- （scouts・salary_offers等）と同じ方針で明示的にrevoke all→grant selectのみ。
-- anonymousは一切アクセス不可（grant自体を行わない）。
revoke all on public.salon_organizations from anon, authenticated;
grant select on public.salon_organizations to authenticated;
revoke all on public.organization_members from anon, authenticated;
grant select on public.organization_members to authenticated;
revoke all on public.salon_stores from anon, authenticated;
grant select on public.salon_stores to authenticated;
revoke all on public.store_members from anon, authenticated;
grant select on public.store_members to authenticated;

-- ----------------------------------------------------------------------------
-- 8. updated_at trigger（既存の共通ヘルパーpublic.set_updated_at()を流用。
--    organization_members/store_membersはupdated_at列を持たないため対象外）。
-- ----------------------------------------------------------------------------
create trigger trg_salon_organizations_updated before update on public.salon_organizations
  for each row execute function public.set_updated_at();
create trigger trg_salon_stores_updated before update on public.salon_stores
  for each row execute function public.set_updated_at();

commit;
