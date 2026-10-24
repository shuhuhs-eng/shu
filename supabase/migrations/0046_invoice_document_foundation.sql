-- ============================================================================
-- 0046_invoice_document_foundation.sql
--
-- 請求書PDF発行のためのDB基盤。PDFレンダリング・Storage upload・ダウンロードUI・メール送付・
-- Stripe・自動督促は作らない（Phase 41以降）。0045の請求書番号・金額・税計算は変更しない。
--
-- ★構成
--   1. billing_issuer_settings        発行事業者設定（platform全体で1行）。値はmigrationにhardcodeしない。
--   2. organization_billing_profiles  会社ごとの請求先情報（1 organization = 1 profile）。
--                                     salon_organizations.name は表示名として維持し、コピーしない。
--   3. invoice_documents              発行した請求書PDFのmetadata＋発行時snapshot（発行後は変更・削除不可）。
--   4. 監査（追記専用）                 設定・請求先の変更は「変更された項目名」だけを残す（口座番号などの
--                                     値は監査ログへ複製しない）。PDFの発行・ダウンロードも記録する。
--
-- ★発行の流れ（PDF生成コードはPhase 41）
--   a. get_invoice_issue_readiness(fee)   発行できるか／不足項目を返す（platform admin）
--   b. prepare_invoice_document(fee)      DBが作るsnapshot3種・保存先パス・snapshot_digest を返す
--   c. （アプリ）snapshotだけからPDFを生成 → private bucketの指定パスへ保存 → SHA-256を計算
--   d. register_invoice_document(fee, snapshot_digest, file_sha256)
--        DBがsnapshotを再計算し、digestが一致した場合だけ記録する。bとdの間に発行事業者・請求先が
--        変更されていたら失敗する（＝PDFに載った内容と保存されたsnapshotが必ず一致する）。
--
-- ★発行できる条件：fee_status が invoiced または paid、請求書番号・支払期限・税率・金額が揃っている、
--   発行事業者の正式名称・登録番号・住所が登録済み、請求先の正式名称が登録済み、未発行。
--   不足時は発行せず、不足項目のコードを返す（日本語化はUI）。
--   振込先（銀行名・支店名・口座種別・口座番号・口座名義の5項目）も必須。発行後のPDFは変更できないため、
--   振込先の無い正式な請求書を作らない。郵便番号の未登録だけは warnings に出す。
-- ★0045以前の旧請求（請求書番号なし）は発行しない（番号を振らない）。旧請求データのまま維持する。
-- ★請求書には美容師の個人名を載せない。内部ではhiring_processとの紐付けを維持する（fee経由）。
--
-- ★権限
--   発行事業者設定: platform admin のみ（読み書き）。会社側は設定値を直接読み書きできない。
--   請求先情報: platform admin、または対象会社の company_owner / company_admin（読み書き）。
--   PDFの正式発行（register）: platform admin のみ。
--   PDFの閲覧可否: platform admin、または対象会社の company_owner / company_admin のみ。
--   テーブルは全て RLS有効・権限なし。必ずSECURITY DEFINER RPC経由。
--
-- ★Storage: bucketの作成・アクセス制御はPhase 41。保存先パスは invoices/<organization_id>/<請求書番号>.pdf
--   をDBが決める。公開URLは使わない。
--
-- ★既存 0001〜0045 は編集しない。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. 共通ヘルパー（内部用）
-- ----------------------------------------------------------------------------
-- p_changes から文字列項目を取り出す（trim・空はnull・長さ検査）。キーが無い場合の扱いは呼び出し側。
create or replace function public.billing_json_text(p_changes jsonb, p_key text, p_max integer)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v jsonb := p_changes -> p_key;
  t text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) <> 'string' then raise exception '% must be a string', p_key; end if;
  t := nullif(btrim(v #>> '{}'), '');
  if t is not null and char_length(t) > p_max then raise exception '% is too long', p_key; end if;
  return t;
end;
$$;
revoke all on function public.billing_json_text(jsonb, text, integer) from public, anon, authenticated;

-- 項目ごとの最大文字数（テーブルのCHECK制約と同じ値。超えたときに分かりやすいエラーにするため）。
create or replace function public.billing_field_max_length(p_key text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_key
    when 'legal_name' then 200
    when 'address' then 300
    when 'phone' then 40
    when 'email' then 254
    when 'billing_email' then 254
    when 'bank_account_number' then 30
    else 100
  end;
$$;
revoke all on function public.billing_field_max_length(text) from public, anon, authenticated;

-- 郵便番号：7桁（ハイフン有無・全角数字可）を NNN-NNNN に整える。不正なら例外。
create or replace function public.billing_normalize_postal_code(p_value text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  d text;
begin
  if p_value is null then return null; end if;
  d := translate(regexp_replace(p_value, '[\s\-−ー‐]', '', 'g'), '０１２３４５６７８９', '0123456789');
  if d !~ '^[0-9]{7}$' then raise exception 'invalid postal code'; end if;
  return substr(d, 1, 3) || '-' || substr(d, 4);
end;
$$;
revoke all on function public.billing_normalize_postal_code(text) from public, anon, authenticated;

-- 適格請求書発行事業者登録番号：T + 13桁（全角・小文字・空白・ハイフン可）を T0000000000000 に整える。
create or replace function public.billing_normalize_registration_number(p_value text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  d text;
begin
  if p_value is null then return null; end if;
  d := upper(translate(regexp_replace(p_value, '[\s\-−ー‐]', '', 'g'), '０１２３４５６７８９Ｔｔ', '0123456789TT'));
  if d !~ '^T[0-9]{13}$' then raise exception 'invalid invoice registration number'; end if;
  return d;
end;
$$;
revoke all on function public.billing_normalize_registration_number(text) from public, anon, authenticated;

-- 会社の請求先情報を扱える人：platform admin、または対象会社の company_owner / company_admin。
create or replace function public.can_manage_organization_billing_profile(p_organization_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then return false; end if;
  if public.is_platform_admin() then return true; end if;
  return exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'salon')
     and exists (
       select 1 from public.organization_members om
       where om.organization_id = p_organization_id and om.user_id = auth.uid()
         and om.role in ('company_owner', 'company_admin')
     );
end;
$$;
revoke all on function public.can_manage_organization_billing_profile(uuid) from public, anon, authenticated;

-- 追記専用・削除不可の共通trigger関数。
create or replace function public.billing_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;
revoke all on function public.billing_append_only() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. billing_issuer_settings（発行事業者設定・platform全体で1行）
-- ----------------------------------------------------------------------------
create table public.billing_issuer_settings (
  id boolean primary key default true check (id),  -- 常にtrue＝1行だけ
  legal_name text check (legal_name is null or char_length(legal_name) between 1 and 200),
  postal_code text check (postal_code is null or postal_code ~ '^[0-9]{3}-[0-9]{4}$'),
  address text check (address is null or char_length(address) between 1 and 300),
  invoice_registration_number text
    check (invoice_registration_number is null or invoice_registration_number ~ '^T[0-9]{13}$'),
  phone text check (phone is null or char_length(phone) between 1 and 40),
  email text check (email is null or (char_length(email) between 3 and 254 and email like '%_@_%')),
  bank_name text check (bank_name is null or char_length(bank_name) between 1 and 100),
  bank_branch_name text check (bank_branch_name is null or char_length(bank_branch_name) between 1 and 100),
  bank_account_type text check (bank_account_type is null or bank_account_type in ('ordinary', 'checking', 'savings')),
  bank_account_number text check (bank_account_number is null or bank_account_number ~ '^[0-9]{1,12}$'),
  bank_account_holder text check (bank_account_holder is null or char_length(bank_account_holder) between 1 and 100),
  updated_by_user_id uuid,  -- FK無し（履歴識別子）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.billing_issuer_settings is
  '請求書の発行事業者設定（platform全体で1行）。platform adminのみRPC経由で登録・変更。過去に発行した請求書へは反映されない（発行時snapshot）。';
alter table public.billing_issuer_settings enable row level security;
revoke all on public.billing_issuer_settings from public, anon, authenticated;

create or replace function public.billing_issuer_settings_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then raise exception 'billing_issuer_settings cannot be deleted'; end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.billing_issuer_settings_guard() from public, anon, authenticated;
create trigger trg_billing_issuer_settings_guard
  before update or delete on public.billing_issuer_settings
  for each row execute function public.billing_issuer_settings_guard();

-- 変更履歴：変更された項目名だけを残す（口座番号などの値は複製しない）。
create table public.billing_issuer_settings_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('created', 'updated')),
  changed_fields text[] not null,
  actor_user_id uuid,
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now()
);
alter table public.billing_issuer_settings_events enable row level security;
revoke all on public.billing_issuer_settings_events from public, anon, authenticated;
create trigger trg_billing_issuer_settings_events_append_only
  before update or delete on public.billing_issuer_settings_events
  for each row execute function public.billing_append_only();

-- ----------------------------------------------------------------------------
-- 3. organization_billing_profiles（会社ごとの請求先情報）
-- ----------------------------------------------------------------------------
create table public.organization_billing_profiles (
  organization_id uuid primary key references public.salon_organizations(id) on delete restrict,
  legal_name text not null check (char_length(legal_name) between 1 and 200),
  postal_code text not null check (postal_code ~ '^[0-9]{3}-[0-9]{4}$'),
  address text not null check (char_length(address) between 1 and 300),
  department_name text check (department_name is null or char_length(department_name) between 1 and 100),
  contact_name text check (contact_name is null or char_length(contact_name) between 1 and 100),
  billing_email text check (billing_email is null or (char_length(billing_email) between 3 and 254 and billing_email like '%_@_%')),
  updated_by_user_id uuid,  -- FK無し（履歴識別子）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.organization_billing_profiles is
  '請求書の宛名・住所などの正式な請求先情報（1会社1行）。salon_organizations.name（表示名）からコピーしない。書き込みはRPC経由のみ。';
alter table public.organization_billing_profiles enable row level security;
revoke all on public.organization_billing_profiles from public, anon, authenticated;

create or replace function public.organization_billing_profiles_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then raise exception 'organization_billing_profiles cannot be deleted'; end if;
  if new.organization_id <> old.organization_id then
    raise exception 'organization_id cannot be changed';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.organization_billing_profiles_guard() from public, anon, authenticated;
create trigger trg_organization_billing_profiles_guard
  before update or delete on public.organization_billing_profiles
  for each row execute function public.organization_billing_profiles_guard();

create table public.organization_billing_profile_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.salon_organizations(id) on delete restrict,
  event_type text not null check (event_type in ('created', 'updated')),
  changed_fields text[] not null,
  actor_user_id uuid,
  created_at timestamptz not null default now()
);
create index organization_billing_profile_events_org_idx
  on public.organization_billing_profile_events(organization_id, created_at);
alter table public.organization_billing_profile_events enable row level security;
revoke all on public.organization_billing_profile_events from public, anon, authenticated;
create trigger trg_organization_billing_profile_events_append_only
  before update or delete on public.organization_billing_profile_events
  for each row execute function public.billing_append_only();

-- ----------------------------------------------------------------------------
-- 4. invoice_documents（発行した請求書PDFのmetadata＋発行時snapshot。発行後は変更・削除不可）
-- ----------------------------------------------------------------------------
create table public.invoice_documents (
  id uuid primary key default gen_random_uuid(),
  success_fee_id uuid not null references public.hiring_success_fees(id) on delete restrict,
  organization_id uuid not null references public.salon_organizations(id) on delete restrict,
  invoice_number text not null check (invoice_number ~ '^BR-[0-9]{4}-[0-9]{6}$'),
  storage_path text not null
    check (storage_path ~ '^invoices/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/BR-[0-9]{4}-[0-9]{6}\.pdf$'),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  issuer_snapshot jsonb not null check (jsonb_typeof(issuer_snapshot) = 'object'),
  recipient_snapshot jsonb not null check (jsonb_typeof(recipient_snapshot) = 'object'),
  invoice_content_snapshot jsonb not null check (jsonb_typeof(invoice_content_snapshot) = 'object'),
  generated_at timestamptz not null default now(),
  generated_by_user_id uuid not null,  -- FK無し（履歴識別子）
  created_at timestamptz not null default now(),
  -- ★1請求につき正式発行は1つ。請求書番号・保存先も一意。
  constraint invoice_documents_fee_unique unique (success_fee_id),
  constraint invoice_documents_number_unique unique (invoice_number),
  constraint invoice_documents_path_unique unique (storage_path)
);
comment on table public.invoice_documents is
  '発行した請求書PDF（1請求1件）。snapshot3種とSHA-256は発行後に変更・削除できない。直接アクセス不可。';
alter table public.invoice_documents enable row level security;
revoke all on public.invoice_documents from public, anon, authenticated;

-- 発行内容が請求（fee）と一致していることをDB側でも保証し、発行後の更新・削除を禁止する。
create or replace function public.invoice_documents_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_fee public.hiring_success_fees;
begin
  if tg_op <> 'INSERT' then
    raise exception 'invoice_documents is immutable';
  end if;
  select * into v_fee from public.hiring_success_fees where id = new.success_fee_id;
  if v_fee.id is null
     or v_fee.fee_status not in ('invoiced', 'paid')
     or v_fee.invoice_number is distinct from new.invoice_number
     or v_fee.organization_id <> new.organization_id then
    raise exception 'invoice document does not match the success fee';
  end if;
  if new.storage_path <> 'invoices/' || new.organization_id::text || '/' || new.invoice_number || '.pdf' then
    raise exception 'invalid storage path';
  end if;
  return new;
end;
$$;
revoke all on function public.invoice_documents_guard() from public, anon, authenticated;
create trigger trg_invoice_documents_guard
  before insert or update or delete on public.invoice_documents
  for each row execute function public.invoice_documents_guard();
create trigger trg_invoice_documents_no_truncate
  before truncate on public.invoice_documents
  for each statement execute function public.billing_append_only();

-- PDFの発行・ダウンロードの記録（追記専用）。
create table public.invoice_document_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.invoice_documents(id) on delete restrict,
  event_type text not null check (event_type in ('issued', 'downloaded')),
  actor_user_id uuid,
  created_at timestamptz not null default now()
);
create index invoice_document_events_doc_idx on public.invoice_document_events(document_id, created_at);
alter table public.invoice_document_events enable row level security;
revoke all on public.invoice_document_events from public, anon, authenticated;
create trigger trg_invoice_document_events_append_only
  before update or delete on public.invoice_document_events
  for each row execute function public.billing_append_only();

-- ----------------------------------------------------------------------------
-- 5. 発行事業者設定のRPC（platform adminのみ）
-- ----------------------------------------------------------------------------
create or replace function public.get_admin_billing_issuer_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s public.billing_issuer_settings;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select * into s from public.billing_issuer_settings where id;
  if s.id is null then
    return jsonb_build_object('has_settings', false);
  end if;
  return jsonb_build_object(
    'has_settings', true,
    'legal_name', s.legal_name, 'postal_code', s.postal_code, 'address', s.address,
    'invoice_registration_number', s.invoice_registration_number,
    'phone', s.phone, 'email', s.email,
    'bank_name', s.bank_name, 'bank_branch_name', s.bank_branch_name,
    'bank_account_type', s.bank_account_type, 'bank_account_number', s.bank_account_number,
    'bank_account_holder', s.bank_account_holder,
    'updated_at', s.updated_at
  );
end;
$$;
revoke all on function public.get_admin_billing_issuer_settings() from public, anon;
grant execute on function public.get_admin_billing_issuer_settings() to authenticated;

-- p_changes: legal_name / postal_code / address / invoice_registration_number / phone / email /
--            bank_name / bank_branch_name / bank_account_type / bank_account_number / bank_account_holder
--   （送られた項目だけを更新。null・空文字で削除。未知の項目は拒否）
create or replace function public.admin_update_billing_issuer_settings(
  p_changes jsonb,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_cur public.billing_issuer_settings;
  v_existed boolean;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_key text;
  v_allowed text[] := array['legal_name', 'postal_code', 'address', 'invoice_registration_number',
    'phone', 'email', 'bank_name', 'bank_branch_name', 'bank_account_type', 'bank_account_number',
    'bank_account_holder'];
  v_old jsonb;
  v_new jsonb;
  v_changed text[] := '{}';
  v_value text;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then raise exception 'changes must be an object'; end if;
  if v_reason is not null and char_length(v_reason) > 500 then raise exception 'reason too long'; end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any (v_allowed)) then raise exception 'unknown field: %', v_key; end if;
  end loop;

  select * into v_cur from public.billing_issuer_settings where id for update;
  v_existed := v_cur.id is not null;
  v_old := case when v_existed then to_jsonb(v_cur) else '{}'::jsonb end;
  v_new := v_old;

  foreach v_key in array v_allowed loop
    if p_changes ? v_key then
      v_value := public.billing_json_text(p_changes, v_key, public.billing_field_max_length(v_key));
      v_value := case v_key
        when 'postal_code' then public.billing_normalize_postal_code(v_value)
        when 'invoice_registration_number' then public.billing_normalize_registration_number(v_value)
        when 'bank_account_number' then translate(v_value, '０１２３４５６７８９', '0123456789')
        else v_value end;
      if v_key = 'bank_account_type' and v_value is not null and v_value not in ('ordinary', 'checking', 'savings') then
        raise exception 'invalid bank account type';
      end if;
      if v_key = 'bank_account_number' and v_value is not null and v_value !~ '^[0-9]{1,12}$' then
        raise exception 'invalid bank account number';
      end if;
      if v_key = 'email' and v_value is not null and v_value not like '%_@_%' then
        raise exception 'invalid email';
      end if;
      v_new := v_new || jsonb_build_object(v_key, v_value);
      if (v_old -> v_key) is distinct from (v_new -> v_key)
         and not ((v_old -> v_key) is null and (v_new -> v_key) = 'null'::jsonb) then
        v_changed := v_changed || v_key;
      end if;
    end if;
  end loop;

  if coalesce(array_length(v_changed, 1), 0) = 0 and v_existed then
    return jsonb_build_object('changed_fields', '[]'::jsonb);
  end if;

  insert into public.billing_issuer_settings (
    id, legal_name, postal_code, address, invoice_registration_number, phone, email,
    bank_name, bank_branch_name, bank_account_type, bank_account_number, bank_account_holder,
    updated_by_user_id
  ) values (
    true, v_new ->> 'legal_name', v_new ->> 'postal_code', v_new ->> 'address',
    v_new ->> 'invoice_registration_number', v_new ->> 'phone', v_new ->> 'email',
    v_new ->> 'bank_name', v_new ->> 'bank_branch_name', v_new ->> 'bank_account_type',
    v_new ->> 'bank_account_number', v_new ->> 'bank_account_holder', v_uid
  )
  on conflict (id) do update set
    legal_name = excluded.legal_name, postal_code = excluded.postal_code, address = excluded.address,
    invoice_registration_number = excluded.invoice_registration_number,
    phone = excluded.phone, email = excluded.email,
    bank_name = excluded.bank_name, bank_branch_name = excluded.bank_branch_name,
    bank_account_type = excluded.bank_account_type, bank_account_number = excluded.bank_account_number,
    bank_account_holder = excluded.bank_account_holder, updated_by_user_id = excluded.updated_by_user_id;

  insert into public.billing_issuer_settings_events (event_type, changed_fields, actor_user_id, reason)
  values (case when v_existed then 'updated' else 'created' end, v_changed, v_uid, v_reason);

  return jsonb_build_object('changed_fields', to_jsonb(v_changed));
end;
$$;
revoke all on function public.admin_update_billing_issuer_settings(jsonb, text) from public, anon;
grant execute on function public.admin_update_billing_issuer_settings(jsonb, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. 会社の請求先情報のRPC（platform admin / 対象会社の company_owner・company_admin）
-- ----------------------------------------------------------------------------
create or replace function public.get_organization_billing_profile(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  p public.organization_billing_profiles;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.can_manage_organization_billing_profile(p_organization_id) then
    raise exception 'organization not found or not accessible';
  end if;
  select * into p from public.organization_billing_profiles where organization_id = p_organization_id;
  if p.organization_id is null then
    return jsonb_build_object('has_profile', false, 'organization_id', p_organization_id);
  end if;
  return jsonb_build_object(
    'has_profile', true, 'organization_id', p.organization_id,
    'legal_name', p.legal_name, 'postal_code', p.postal_code, 'address', p.address,
    'department_name', p.department_name, 'contact_name', p.contact_name,
    'billing_email', p.billing_email, 'updated_at', p.updated_at
  );
end;
$$;
revoke all on function public.get_organization_billing_profile(uuid) from public, anon;
grant execute on function public.get_organization_billing_profile(uuid) to authenticated;

-- p_changes: legal_name / postal_code / address / department_name / contact_name / billing_email
--   新規作成時は legal_name・postal_code・address が必須。salon_organizations.name からは補完しない。
create or replace function public.update_organization_billing_profile(
  p_organization_id uuid,
  p_changes jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_cur public.organization_billing_profiles;
  v_existed boolean;
  v_key text;
  v_allowed text[] := array['legal_name', 'postal_code', 'address', 'department_name', 'contact_name', 'billing_email'];
  v_required text[] := array['legal_name', 'postal_code', 'address'];
  v_old jsonb;
  v_new jsonb;
  v_changed text[] := '{}';
  v_value text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.salon_organizations where id = p_organization_id)
     or not public.can_manage_organization_billing_profile(p_organization_id) then
    raise exception 'organization not found or not accessible';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then raise exception 'changes must be an object'; end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any (v_allowed)) then raise exception 'unknown field: %', v_key; end if;
  end loop;

  select * into v_cur from public.organization_billing_profiles
  where organization_id = p_organization_id for update;
  v_existed := v_cur.organization_id is not null;
  v_old := case when v_existed then to_jsonb(v_cur) else '{}'::jsonb end;
  v_new := v_old;

  foreach v_key in array v_allowed loop
    if p_changes ? v_key then
      v_value := public.billing_json_text(p_changes, v_key, public.billing_field_max_length(v_key));
      if v_key = 'postal_code' then v_value := public.billing_normalize_postal_code(v_value); end if;
      if v_key = 'billing_email' and v_value is not null and v_value not like '%_@_%' then
        raise exception 'invalid email';
      end if;
      v_new := v_new || jsonb_build_object(v_key, v_value);
      if (v_old -> v_key) is distinct from (v_new -> v_key)
         and not ((v_old -> v_key) is null and (v_new -> v_key) = 'null'::jsonb) then
        v_changed := v_changed || v_key;
      end if;
    end if;
  end loop;

  foreach v_key in array v_required loop
    if (v_new ->> v_key) is null then raise exception '% is required', v_key; end if;
  end loop;

  if v_existed and coalesce(array_length(v_changed, 1), 0) = 0 then
    return jsonb_build_object('changed_fields', '[]'::jsonb);
  end if;

  insert into public.organization_billing_profiles (
    organization_id, legal_name, postal_code, address, department_name, contact_name, billing_email,
    updated_by_user_id
  ) values (
    p_organization_id, v_new ->> 'legal_name', v_new ->> 'postal_code', v_new ->> 'address',
    v_new ->> 'department_name', v_new ->> 'contact_name', v_new ->> 'billing_email', v_uid
  )
  on conflict (organization_id) do update set
    legal_name = excluded.legal_name, postal_code = excluded.postal_code, address = excluded.address,
    department_name = excluded.department_name, contact_name = excluded.contact_name,
    billing_email = excluded.billing_email, updated_by_user_id = excluded.updated_by_user_id;

  insert into public.organization_billing_profile_events (organization_id, event_type, changed_fields, actor_user_id)
  values (p_organization_id, case when v_existed then 'updated' else 'created' end, v_changed, v_uid);

  return jsonb_build_object('changed_fields', to_jsonb(v_changed));
end;
$$;
revoke all on function public.update_organization_billing_profile(uuid, jsonb) from public, anon;
grant execute on function public.update_organization_billing_profile(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. 発行状態の計算（内部）：不足項目・警告・snapshot・保存先パスを1か所で作る
-- ----------------------------------------------------------------------------
create or replace function public.invoice_snapshot_digest(p_issuer jsonb, p_recipient jsonb, p_content jsonb)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select encode(sha256(convert_to(p_issuer::text || E'\n' || p_recipient::text || E'\n' || p_content::text, 'UTF8')), 'hex');
$$;
revoke all on function public.invoice_snapshot_digest(jsonb, jsonb, jsonb) from public, anon, authenticated;

-- 戻り値: { already_issued, historical, missing[], warnings[], issuer_snapshot, recipient_snapshot,
--           invoice_content_snapshot, storage_path, snapshot_digest }（snapshotは不足が無いときだけ）
create or replace function public.invoice_issue_state(p_success_fee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  f public.hiring_success_fees;
  i public.billing_issuer_settings;
  r public.organization_billing_profiles;
  v_store_name text;
  v_missing text[] := '{}';
  v_warnings text[] := '{}';
  v_already boolean;
  v_historical boolean;
  v_issuer jsonb;
  v_recipient jsonb;
  v_content jsonb;
  v_path text;
begin
  select * into f from public.hiring_success_fees where id = p_success_fee_id;
  if f.id is null then raise exception 'success fee not found'; end if;
  v_already := exists (select 1 from public.invoice_documents d where d.success_fee_id = f.id);
  v_historical := f.fee_status in ('invoiced', 'paid') and f.invoice_number is null;

  if f.fee_status not in ('invoiced', 'paid') then v_missing := array_append(v_missing, 'fee_not_invoiced'); end if;
  if v_historical then v_missing := array_append(v_missing, 'historical_invoice'); end if;
  if f.fee_status in ('invoiced', 'paid') and not v_historical then
    if f.due_date is null then v_missing := array_append(v_missing, 'due_date'); end if;
    if f.tax_rate is null then v_missing := array_append(v_missing, 'tax_rate'); end if;
  end if;
  if f.fee_amount is null or f.tax_amount is null or f.total_amount is null then
    v_missing := array_append(v_missing, 'amounts');
  end if;

  select * into i from public.billing_issuer_settings where id;
  if i.legal_name is null then v_missing := array_append(v_missing, 'issuer_legal_name'); end if;
  if i.invoice_registration_number is null then v_missing := array_append(v_missing, 'issuer_registration_number'); end if;
  if i.address is null then v_missing := array_append(v_missing, 'issuer_address'); end if;
  if i.postal_code is null then v_warnings := array_append(v_warnings, 'issuer_postal_code'); end if;
  -- ★振込先（5項目）は必須。発行後のPDFは変更できないため、振込先の無い正式な請求書を作らない。
  if i.bank_name is null then v_missing := array_append(v_missing, 'issuer_bank_name_missing'); end if;
  if i.bank_branch_name is null then v_missing := array_append(v_missing, 'issuer_bank_branch_name_missing'); end if;
  if i.bank_account_type is null then v_missing := array_append(v_missing, 'issuer_bank_account_type_missing'); end if;
  if i.bank_account_number is null then v_missing := array_append(v_missing, 'issuer_bank_account_number_missing'); end if;
  if i.bank_account_holder is null then v_missing := array_append(v_missing, 'issuer_bank_account_holder_missing'); end if;

  select * into r from public.organization_billing_profiles where organization_id = f.organization_id;
  if r.organization_id is null then v_missing := array_append(v_missing, 'recipient_legal_name'); end if;

  if coalesce(array_length(v_missing, 1), 0) > 0 then
    return jsonb_build_object('already_issued', v_already, 'historical', v_historical,
                              'missing', to_jsonb(v_missing), 'warnings', to_jsonb(v_warnings));
  end if;

  select s.store_name into v_store_name from public.salon_stores s where s.id = f.store_id;

  v_issuer := jsonb_build_object(
    'legal_name', i.legal_name, 'postal_code', i.postal_code, 'address', i.address,
    'invoice_registration_number', i.invoice_registration_number,
    'phone', i.phone, 'email', i.email,
    'bank', jsonb_build_object(
      'bank_name', i.bank_name, 'branch_name', i.bank_branch_name,
      'account_type', i.bank_account_type, 'account_number', i.bank_account_number,
      'account_holder', i.bank_account_holder)
  );
  v_recipient := jsonb_build_object(
    'legal_name', r.legal_name, 'postal_code', r.postal_code, 'address', r.address,
    'department_name', r.department_name, 'contact_name', r.contact_name
  );
  -- ★美容師の個人名は載せない（店舗名・採用成立日・1名のみ）。
  v_content := jsonb_build_object(
    'invoice_number', f.invoice_number,
    'invoiced_at', f.invoiced_at,
    'invoice_date', (f.invoiced_at at time zone 'Asia/Tokyo')::date,
    'due_date', f.due_date,
    'currency', f.currency,
    'fee_amount', f.fee_amount,
    'tax_rate', f.tax_rate,
    'tax_amount', f.tax_amount,
    'total_amount', f.total_amount,
    'tax_breakdown', jsonb_build_array(jsonb_build_object(
      'tax_rate', f.tax_rate, 'taxable_amount', f.fee_amount, 'tax_amount', f.tax_amount)),
    'store_name', v_store_name,
    'hired_at', f.hired_at,
    'hired_date', (f.hired_at at time zone 'Asia/Tokyo')::date,
    'line_items', jsonb_build_array(jsonb_build_object(
      'description', '美容師採用成功報酬', 'store_name', v_store_name,
      'hired_date', (f.hired_at at time zone 'Asia/Tokyo')::date,
      'quantity', 1, 'unit', '名', 'amount', f.fee_amount))
  );
  v_path := 'invoices/' || f.organization_id::text || '/' || f.invoice_number || '.pdf';

  return jsonb_build_object(
    'already_issued', v_already, 'historical', false,
    'missing', '[]'::jsonb, 'warnings', to_jsonb(v_warnings),
    'issuer_snapshot', v_issuer, 'recipient_snapshot', v_recipient,
    'invoice_content_snapshot', v_content, 'storage_path', v_path,
    'snapshot_digest', public.invoice_snapshot_digest(v_issuer, v_recipient, v_content)
  );
end;
$$;
revoke all on function public.invoice_issue_state(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8. PDF発行のRPC（platform adminのみ）
-- ----------------------------------------------------------------------------
-- 発行できるか／不足項目（コード）／警告。snapshot本体は返さない。
create or replace function public.get_invoice_issue_readiness(p_success_fee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  s := public.invoice_issue_state(p_success_fee_id);
  return jsonb_build_object(
    'ready', jsonb_array_length(s -> 'missing') = 0 and not (s ->> 'already_issued')::boolean,
    'already_issued', (s ->> 'already_issued')::boolean,
    'historical', (s ->> 'historical')::boolean,
    'missing', s -> 'missing',
    'warnings', s -> 'warnings'
  );
end;
$$;
revoke all on function public.get_invoice_issue_readiness(uuid) from public, anon;
grant execute on function public.get_invoice_issue_readiness(uuid) to authenticated;

-- PDF生成に使うsnapshot・保存先パス・digestを返す（状態は変えない）。
create or replace function public.prepare_invoice_document(p_success_fee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  s := public.invoice_issue_state(p_success_fee_id);
  if (s ->> 'already_issued')::boolean then raise exception 'invoice document already issued'; end if;
  if jsonb_array_length(s -> 'missing') > 0 then raise exception 'invoice is not ready to issue'; end if;
  return s - 'already_issued' - 'historical' - 'missing';
end;
$$;
revoke all on function public.prepare_invoice_document(uuid) from public, anon;
grant execute on function public.prepare_invoice_document(uuid) to authenticated;

-- 発行を記録する。snapshotはここでDBが再計算し、PDF生成時のdigestと一致した場合だけ保存する。
create or replace function public.register_invoice_document(
  p_success_fee_id uuid,
  p_snapshot_digest text,
  p_file_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  f public.hiring_success_fees;
  s jsonb;
  v_sha text := lower(btrim(coalesce(p_file_sha256, '')));
  v_doc public.invoice_documents;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if v_sha !~ '^[0-9a-f]{64}$' then raise exception 'invalid file hash'; end if;

  -- 同じ請求の同時発行を直列化する。
  select * into f from public.hiring_success_fees where id = p_success_fee_id for update;
  if f.id is null then raise exception 'success fee not found'; end if;

  s := public.invoice_issue_state(p_success_fee_id);
  if (s ->> 'already_issued')::boolean then raise exception 'invoice document already issued'; end if;
  if jsonb_array_length(s -> 'missing') > 0 then raise exception 'invoice is not ready to issue'; end if;
  if p_snapshot_digest is distinct from (s ->> 'snapshot_digest') then
    raise exception 'invoice snapshot has changed; regenerate the document';
  end if;

  insert into public.invoice_documents (
    success_fee_id, organization_id, invoice_number, storage_path, file_sha256,
    issuer_snapshot, recipient_snapshot, invoice_content_snapshot, generated_by_user_id
  ) values (
    f.id, f.organization_id, f.invoice_number, s ->> 'storage_path', v_sha,
    s -> 'issuer_snapshot', s -> 'recipient_snapshot', s -> 'invoice_content_snapshot', v_uid
  ) returning * into v_doc;

  insert into public.invoice_document_events (document_id, event_type, actor_user_id)
  values (v_doc.id, 'issued', v_uid);

  return jsonb_build_object('document_id', v_doc.id, 'invoice_number', v_doc.invoice_number,
                            'storage_path', v_doc.storage_path, 'generated_at', v_doc.generated_at);
end;
$$;
revoke all on function public.register_invoice_document(uuid, text, text) from public, anon;
grant execute on function public.register_invoice_document(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. 発行済みPDFの閲覧RPC
-- ----------------------------------------------------------------------------
-- 運営者：一覧（snapshot本体は返さない。操作者idも返さない）。
create or replace function public.get_admin_invoice_documents(p_organization_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'document_id', d.id, 'success_fee_id', d.success_fee_id, 'organization_id', d.organization_id,
      'invoice_number', d.invoice_number, 'file_sha256', d.file_sha256, 'generated_at', d.generated_at
    ) order by d.generated_at desc)
    from public.invoice_documents d
    where p_organization_id is null or d.organization_id = p_organization_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_admin_invoice_documents(uuid) from public, anon;
grant execute on function public.get_admin_invoice_documents(uuid) to authenticated;

-- 運営者：発行時snapshot（監査・再確認用）。
create or replace function public.get_admin_invoice_document(p_document_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  d public.invoice_documents;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select * into d from public.invoice_documents where id = p_document_id;
  if d.id is null then raise exception 'invoice document not found'; end if;
  return jsonb_build_object(
    'document_id', d.id, 'success_fee_id', d.success_fee_id, 'organization_id', d.organization_id,
    'invoice_number', d.invoice_number, 'storage_path', d.storage_path, 'file_sha256', d.file_sha256,
    'issuer_snapshot', d.issuer_snapshot, 'recipient_snapshot', d.recipient_snapshot,
    'invoice_content_snapshot', d.invoice_content_snapshot, 'generated_at', d.generated_at
  );
end;
$$;
revoke all on function public.get_admin_invoice_document(uuid) from public, anon;
grant execute on function public.get_admin_invoice_document(uuid) to authenticated;

-- 会社側：自社（company_owner / company_admin）の発行済み請求書の一覧。snapshot・hash・保存先は返さない。
create or replace function public.get_company_invoice_documents(p_organization_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;
  if p_organization_id is not null and not exists (
    select 1 from public.organization_members om
    where om.organization_id = p_organization_id and om.user_id = v_uid
      and om.role in ('company_owner', 'company_admin')
  ) then
    raise exception 'organization not found or not accessible';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'document_id', d.id, 'success_fee_id', d.success_fee_id, 'organization_id', d.organization_id,
      'invoice_number', d.invoice_number, 'generated_at', d.generated_at
    ) order by d.generated_at desc)
    from public.invoice_documents d
    where (p_organization_id is null or d.organization_id = p_organization_id)
      and exists (
        select 1 from public.organization_members om
        where om.organization_id = d.organization_id and om.user_id = v_uid
          and om.role in ('company_owner', 'company_admin')
      )
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_company_invoice_documents(uuid) from public, anon;
grant execute on function public.get_company_invoice_documents(uuid) to authenticated;

-- ダウンロードの権限確認と記録。Storageから取得する前に必ずこのRPCを通す（Phase 41）。
-- platform admin、または対象会社の company_owner / company_admin のみ。
create or replace function public.authorize_invoice_document_download(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  d public.invoice_documents;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into d from public.invoice_documents where id = p_document_id;
  if d.id is null
     or not (
       public.is_platform_admin()
       or (
         exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon')
         and exists (
           select 1 from public.organization_members om
           where om.organization_id = d.organization_id and om.user_id = v_uid
             and om.role in ('company_owner', 'company_admin')
         )
       )
     ) then
    raise exception 'invoice document not found or not accessible';
  end if;
  insert into public.invoice_document_events (document_id, event_type, actor_user_id)
  values (d.id, 'downloaded', v_uid);
  return jsonb_build_object('document_id', d.id, 'invoice_number', d.invoice_number,
                            'storage_path', d.storage_path, 'file_sha256', d.file_sha256);
end;
$$;
revoke all on function public.authorize_invoice_document_download(uuid) from public, anon;
grant execute on function public.authorize_invoice_document_download(uuid) to authenticated;

commit;
