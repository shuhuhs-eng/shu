-- ============================================================================
-- Beauty Reach — 0029_salon_store_profile_culture_foundation
--
-- 法人・複数店舗対応 Phase 3A。店舗単位のプロフィール/カルチャー診断を
-- 保持する新テーブル2つ（salon_store_profiles / salon_store_culture_profiles）
-- を新設する「DB基盤のみ」のmigration。
--
-- ★採用した方針（推奨C案）:
--   ・既存 salon_profiles / salon_culture_profiles は一切変更・削除しない
--     （1 user = 1 row の互換テーブルとしてそのまま残す）。
--   ・新テーブルは store_id を主軸（PK/UNIQUE）とし、auth userをPKにしない。
--     これにより1会社60店舗・同一company_ownerが複数店舗を持つ構成に
--     対応できる（旧テーブルの1ユーザー1行という制約を新テーブルは持たない）。
--   ・旧テーブルへの同期（dual-write）は行わない。新テーブルは新テーブルの
--     中だけで完結する（将来Phase 4でScout/matchingがstore_id対応した時点で
--     新テーブルを正として接続する）。
--
-- ★GV backfillの範囲（重要・ユーザー指定ルール）:
--   salon_profiles/salon_culture_profilesは「1 user = 1 row」のため、
--   本質的に「このuserの店舗はどれか」を一意に表現できるのは
--   salon_onboarding_assignments.store_id（＝初回オンボーディングで
--   作成された店舗）だけである。このmigrationのbackfillは
--   salon_onboarding_assignmentsをcanonical mappingとして使い、
--   salon_profiles/salon_culture_profilesの各1行をその「初期店舗」にのみ
--   コピーする。2店舗目以降という概念はそもそも旧テーブル側に存在しない
--   （旧テーブルにそれを表現する行自体が無い）ため、「2店舗目以降を
--   旧テーブルへ同期しない」という制約は、salon_onboarding_assignmentsを
--   唯一のbackfillソースにする設計そのものによって構造的に満たされる。
--
-- ★AI output（salon_culture_ai_outputs相当）について:
--   今回は新設しない（Phase 3B以降へ延期）。既存salon_culture_ai_outputsの
--   FK（salon_culture_profiles(id)）には一切触れていない。店舗単位のAI解説
--   対応表（salon_store_culture_ai_outputs相当）は、salon_store_culture_profiles
--   が存在すればいつでも後から追加できる完全加算的な変更であり、今回
--   無理に含める必要が無い。Phase 3Aのスコープ（DB基盤のみ・新規登録時の
--   自動生成はまだ実装しない）では店舗単位のAI解説を生成する経路自体が
--   まだ存在しないため、今回は見送るのが最も安全と判断した。
--
-- ★新規登録フローへの影響:
--   save_salon_profile()・save_salon_culture_profile()は今回一切変更しない。
--   新テーブルへの自動生成（新規サロン登録時にsalon_store_profiles等を
--   同時作成する処理）はPhase 3Bで実装する。
--
-- ★既存migration(0001〜0028)は一切編集していない。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. salon_store_profiles（店舗単位プロフィール。store_idが主軸）
--
-- 既存salon_profiles（0001・0014）の店舗固有項目（【Phase3調査】A/B/C分類で
-- B=店舗固有・C=店舗寄りと判定した列）をそのまま引き継ぐ。型・CHECK制約も
-- 既存salon_profilesと同一にしている。instagram_handleは0015でsalon_linksへ
-- 移行済みのlegacy列のため、新テーブルには含めない。
--
-- store_idはPKかつsalon_stores(id)へのFK。auth user（company_owner等）を
-- PKにしない＝1店舗1profileを保証し、1ユーザーが複数店舗分の行を持てる
-- ようにする（旧salon_profilesのuser_id PKが抱えていた複数店舗非対応の
-- 問題を解消する、今回の新設テーブルの核心的な設計変更）。
-- 店舗削除時にそのプロフィールも意味を失うため on delete cascade とする
-- （既存salon_profiles.user_id→profiles(id) on delete cascadeと同じ考え方）。
-- ----------------------------------------------------------------------------
create table public.salon_store_profiles (
  store_id             uuid primary key references public.salon_stores(id) on delete cascade,
  salon_name           text check (salon_name is null or char_length(salon_name) <= 60),
  visibility           public.profile_visibility not null default 'PRIVATE',
  prefecture           text,
  city                 text,
  street_address       text,
  culture_description  text check (culture_description is null or char_length(culture_description) <= 2000),
  employee_size_code   text references public.employee_size_master(code),
  target_specialties   text[] not null default '{}',
  bio                  text check (bio is null or char_length(bio) <= 1000),
  hotpepper_url        text check (
    hotpepper_url is null
    or hotpepper_url = ''
    or hotpepper_url ~ '^https://beauty\.hotpepper\.jp/.+$'
  ),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.salon_store_profiles is '店舗単位のプロフィール（法人・複数店舗対応 Phase 3A）。store_idが主軸のPKであり、auth userはPKにしない＝1ユーザーが複数店舗分の行を持てる。既存salon_profiles（1 user = 1 row、互換用に無変更で残す）とは独立したテーブル。型・CHECK制約は既存salon_profilesと同一（instagram_handleは0015でsalon_linksへ移行済みのため含めない）。書き込みは将来のPhase 3B SECURITY DEFINER RPC経由のみとし、今回はクライアントへの直接INSERT/UPDATE/DELETE権限を一切付与しない。';
comment on column public.salon_store_profiles.store_id is '主軸キー。salon_stores(id)への1:1。店舗が削除された場合はこのプロフィールも意味を失うためon delete cascade。';

create trigger trg_salon_store_profiles_updated
  before update on public.salon_store_profiles
  for each row execute function public.set_updated_at();

alter table public.salon_store_profiles enable row level security;

-- SELECTのみ、既存0026のis_store_accessible()をsingle source of truthとして
-- 利用する（権限ロジックを複製しない）。INSERT/UPDATE/DELETEポリシーは
-- 意図的に作らない（Phase 3BのSECURITY DEFINER RPC経由のみに限定する）。
-- visibility=PUBLICの美容師向け公開RLSはPhase 4で別途検討する（今回は
-- サロン管理側のアクセスのみ）。
create policy salon_store_profiles_select_accessible on public.salon_store_profiles
  for select using (public.is_store_accessible(store_id));

revoke all on public.salon_store_profiles from anon, authenticated;
grant select on public.salon_store_profiles to authenticated;

-- ----------------------------------------------------------------------------
-- 2. salon_store_culture_profiles（店舗単位の12軸カルチャー診断）
--
-- 既存salon_culture_profiles（0005・0009）の型・CHECK・enumをそのまま
-- 引き継ぐ。salon_user_id（旧: auth user単位の所有キー）は持ち込まず、
-- 所有主体はstore_id（UNIQUE、1店舗1行）とする。回答者個人の情報は
-- 既存同様 respondent_user_id / respondent_role で保持する（所有キーとは
-- 別軸）。
--
-- idをPKとし、store_idをUNIQUEにしている（既存salon_culture_profilesの
-- 「id PK + salon_user_id UNIQUE」という構造をそのまま踏襲し、store_id軸へ
-- 置き換えただけ）。
-- ----------------------------------------------------------------------------
create table public.salon_store_culture_profiles (
  id                  uuid primary key default gen_random_uuid(),
  store_id            uuid not null unique references public.salon_stores(id) on delete cascade,
  status              public.salon_culture_status not null default 'draft',
  respondent_role     public.salon_culture_respondent_role,
  respondent_user_id  uuid references public.profiles(id),
  current_step        integer not null default 0,
  answers              jsonb not null default '{}'::jsonb,
  culture_axes         jsonb,
  value_priorities     text[] check (value_priorities is null or array_length(value_priorities, 1) = 3),
  comment              text check (comment is null or char_length(comment) <= 500),
  ai_summary           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.salon_store_culture_profiles is '店舗単位の「サロンらしさ」12軸診断（法人・複数店舗対応 Phase 3A）。所有主体はstore_id（UNIQUE、1店舗1行）であり、salon_user_idは持ち込まない。回答者個人の情報はrespondent_user_id/respondent_roleで別途保持する。既存salon_culture_profiles（1 user = 1 row、互換用に無変更で残す）とは独立したテーブル。型・CHECK・enum（salon_culture_status/salon_culture_respondent_role）は既存salon_culture_profilesと同一。AI解説（salon_culture_ai_outputs相当）の店舗単位版は今回新設しない（Phase 3B以降へ延期。既存salon_culture_ai_outputsのFKには一切影響しない）。書き込みは将来のPhase 3B SECURITY DEFINER RPC経由のみ。';
comment on column public.salon_store_culture_profiles.store_id is '主軸キー。salon_stores(id)への1:1（UNIQUE）。店舗削除時にこの診断も意味を失うためon delete cascade。';

create trigger trg_salon_store_culture_profiles_updated
  before update on public.salon_store_culture_profiles
  for each row execute function public.set_updated_at();

alter table public.salon_store_culture_profiles enable row level security;

create policy salon_store_culture_profiles_select_accessible on public.salon_store_culture_profiles
  for select using (public.is_store_accessible(store_id));

revoke all on public.salon_store_culture_profiles from anon, authenticated;
grant select on public.salon_store_culture_profiles to authenticated;

-- ----------------------------------------------------------------------------
-- 3. 既存データのbackfill（GV等、salon_onboarding_assignmentsが持つ
--    「初期店舗」にのみコピーする）。
--
-- ★canonical mappingはsalon_onboarding_assignments（user_id PK×organization_id
--   ×store_id）のみを使う。legacy_salon_user_idは使用しない（ユーザー指定）。
-- ★このJOINの構造そのものが「2店舗目以降は対象にならない」を保証する:
--   salon_onboarding_assignmentsはuser_id PKのため、1ユーザーにつき
--   store_idはちょうど1件しか存在しない（＝初回オンボーディングで作成された
--   店舗のみ）。2店舗目以降はそもそもこのテーブルに行を持たないため、
--   このbackfillのJOIN対象に入ってくることが構造的にあり得ない。
-- ★冪等性: store_id（PK/UNIQUE）に対するon conflict do nothingにより、
--   このmigrationが何らかの理由で再実行されても重複行は作られない
--   （通常は1回のみ適用される前提のため、過剰な仕組みは設けない）。
-- ----------------------------------------------------------------------------
insert into public.salon_store_profiles (
  store_id, salon_name, visibility, prefecture, city, street_address,
  culture_description, employee_size_code, target_specialties, bio,
  hotpepper_url, created_at, updated_at
)
select
  soa.store_id,
  sp.salon_name, sp.visibility, sp.prefecture, sp.city, sp.street_address,
  sp.culture_description, sp.employee_size_code, sp.target_specialties, sp.bio,
  sp.hotpepper_url, sp.created_at, sp.updated_at
from public.salon_profiles sp
join public.salon_onboarding_assignments soa on soa.user_id = sp.user_id
on conflict (store_id) do nothing;

insert into public.salon_store_culture_profiles (
  store_id, status, respondent_role, respondent_user_id, current_step,
  answers, culture_axes, value_priorities, comment, ai_summary,
  created_at, updated_at
)
select
  soa.store_id,
  scp.status, scp.respondent_role, scp.respondent_user_id, scp.current_step,
  scp.answers, scp.culture_axes, scp.value_priorities, scp.comment, scp.ai_summary,
  scp.created_at, scp.updated_at
from public.salon_culture_profiles scp
join public.salon_onboarding_assignments soa on soa.user_id = scp.salon_user_id
on conflict (store_id) do nothing;

commit;
