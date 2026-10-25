-- ============================================================================
-- Beauty Reach — 0049_subscription_invoice_documents
--
-- Phase 49: 月額カード決済の「支払履歴」と「適格請求書（Beauty Reach独自PDF）」のDB基盤。
-- PDFレンダリング・Storage保存・メール送付・webhookからの呼び出しは作らない（次Phase）。
--
-- ★成功報酬のinvoice_documentsは流用しない。
--   invoice_documents は success_fee_id と1:1（トリガーもfeeの状態に固定）。月額は
--   「Stripe invoice 1件＝1取引」なので別の取引単位として分離する。
--
-- ★構成
--   1. subscription_invoice_payments   月額カード決済の支払履歴（Stripe invoice 1件＝1行・追記専用）。
--                                      決済時のtax snapshot（0048）・請求書番号・対象期間を持つ。
--   2. subscription_invoice_documents  発行した適格請求書PDFのmetadata＋発行時snapshot（発行後は変更・削除不可）。
--   3. subscription_invoice_document_events  発行・ダウンロードの記録（追記専用）。
--
-- ★請求書番号は成功報酬と同じ BR-YYYY-NNNNNN 全社共通カウンタ（0045 allocate_invoice_number）を共用。
--   支払の記録時（invoice.paid）に採番する（成功報酬が請求確定時に採番するのと同じ）。
--   一意性は同一カウンタから払い出すことで両テーブル間でも保証される。
--
-- ★金額の正（二重課税なし）
--   Stripe invoiceの支払額(amount_paid) ＝ organization_subscriptions の税込total_amount（0048の決済時snapshot）
--   のときだけ支払履歴に記録する。一致しない・snapshotが無い・通貨が違う場合は何も記録せず
--   stripe_integrity_issues に残す（請求書を出さない）。税額は再計算しない。
--
-- ★適格請求書の記載事項（消費税法57条の4）を発行時snapshotに保持する：
--   発行事業者の名称・登録番号／取引年月日／取引内容／税率ごとの対価の額と適用税率／税率ごとの消費税額／
--   書類の交付を受ける事業者の名称。加えて 対象期間・支払方法(カード)・Stripe参照 を保持する。
--   振込先は不要（カード決済済みのため）。発行事業者・請求先はビリング設定(0046)の値を発行時にsnapshot。
--
-- ★権限：テーブルは全てRLS有効・権限なし。必ずSECURITY DEFINER RPC経由。
--   webhook系: service_role のみ ／ 発行系: platform admin（手動・再発行）と service_role（自動発行）
--   閲覧: platform admin、または対象会社の company_owner / company_admin。
--
-- ★既存 0001〜0048 は編集しない。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. subscription_invoice_payments（月額カード決済の支払履歴）
-- ----------------------------------------------------------------------------
create table public.subscription_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.salon_organizations(id) on delete restrict,
  stripe_invoice_id text not null check (stripe_invoice_id ~ '^in_[A-Za-z0-9_]+$'),
  stripe_subscription_id text not null check (stripe_subscription_id ~ '^sub_[A-Za-z0-9_]+$'),
  stripe_payment_intent_id text check (stripe_payment_intent_id is null or stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  invoice_number text not null check (invoice_number ~ '^BR-[0-9]{4}-[0-9]{6}$'),
  -- 対象期間：period_start 以上 period_end 未満（Stripeのサブスクリプション期間）。
  period_start timestamptz not null,
  period_end timestamptz not null,
  -- 決済時のtax snapshot（0048 organization_subscriptions の値をコピー。ここで再計算しない）。
  amount_excl_tax integer not null check (amount_excl_tax > 0),
  tax_rate numeric(5,2) not null check (tax_rate >= 0 and tax_rate <= 100),
  tax_amount integer not null check (tax_amount >= 0),
  total_amount integer not null,
  stripe_amount_paid integer not null,
  currency text not null default 'jpy' check (currency = 'jpy'),
  paid_at timestamptz not null,
  livemode boolean not null,
  created_at timestamptz not null default now(),
  constraint subscription_invoice_payments_invoice_unique unique (stripe_invoice_id),
  constraint subscription_invoice_payments_number_unique unique (invoice_number),
  constraint subscription_invoice_payments_period check (period_end > period_start),
  constraint subscription_invoice_payments_total check (
    total_amount = amount_excl_tax + tax_amount and stripe_amount_paid = total_amount)
);
create index subscription_invoice_payments_org_idx
  on public.subscription_invoice_payments (organization_id, period_start desc);
comment on table public.subscription_invoice_payments is
  '月額カード決済の支払履歴（Stripe invoice 1件＝1行）。決済時のtax snapshotと請求書番号を持つ。追記専用。直接アクセス不可。';
alter table public.subscription_invoice_payments enable row level security;
revoke all on public.subscription_invoice_payments from public, anon, authenticated, service_role;
create trigger trg_subscription_invoice_payments_append_only
  before update or delete on public.subscription_invoice_payments
  for each row execute function public.billing_append_only();
create trigger trg_subscription_invoice_payments_no_truncate
  before truncate on public.subscription_invoice_payments
  for each statement execute function public.billing_append_only();

-- ----------------------------------------------------------------------------
-- 2. subscription_invoice_documents（発行した適格請求書PDF）
-- ----------------------------------------------------------------------------
create table public.subscription_invoice_documents (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.subscription_invoice_payments(id) on delete restrict,
  organization_id uuid not null references public.salon_organizations(id) on delete restrict,
  invoice_number text not null check (invoice_number ~ '^BR-[0-9]{4}-[0-9]{6}$'),
  storage_path text not null
    check (storage_path ~ '^invoices/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/BR-[0-9]{4}-[0-9]{6}\.pdf$'),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  issuer_snapshot jsonb not null check (jsonb_typeof(issuer_snapshot) = 'object'),
  recipient_snapshot jsonb not null check (jsonb_typeof(recipient_snapshot) = 'object'),
  invoice_content_snapshot jsonb not null check (jsonb_typeof(invoice_content_snapshot) = 'object'),
  generated_at timestamptz not null default now(),
  generated_by_user_id uuid,  -- null＝自動発行（システム）。FK無し（履歴識別子）
  created_at timestamptz not null default now(),
  constraint subscription_invoice_documents_payment_unique unique (payment_id),
  constraint subscription_invoice_documents_number_unique unique (invoice_number),
  constraint subscription_invoice_documents_path_unique unique (storage_path)
);
comment on table public.subscription_invoice_documents is
  '月額カード決済ごとに発行する適格請求書PDF（1支払1件）。snapshot3種とSHA-256は発行後に変更・削除できない。直接アクセス不可。';
alter table public.subscription_invoice_documents enable row level security;
revoke all on public.subscription_invoice_documents from public, anon, authenticated, service_role;

create or replace function public.subscription_invoice_documents_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  p public.subscription_invoice_payments;
begin
  if tg_op <> 'INSERT' then
    raise exception 'subscription_invoice_documents is immutable';
  end if;
  select * into p from public.subscription_invoice_payments where id = new.payment_id;
  if p.id is null or p.invoice_number is distinct from new.invoice_number
     or p.organization_id <> new.organization_id then
    raise exception 'invoice document does not match the payment';
  end if;
  if new.storage_path <> 'invoices/' || new.organization_id::text || '/' || new.invoice_number || '.pdf' then
    raise exception 'invalid storage path';
  end if;
  return new;
end;
$$;
revoke all on function public.subscription_invoice_documents_guard() from public, anon, authenticated;
create trigger trg_subscription_invoice_documents_guard
  before insert or update or delete on public.subscription_invoice_documents
  for each row execute function public.subscription_invoice_documents_guard();
create trigger trg_subscription_invoice_documents_no_truncate
  before truncate on public.subscription_invoice_documents
  for each statement execute function public.billing_append_only();

create table public.subscription_invoice_document_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.subscription_invoice_documents(id) on delete restrict,
  event_type text not null check (event_type in ('issued', 'downloaded')),
  actor_user_id uuid,
  created_at timestamptz not null default now()
);
create index subscription_invoice_document_events_doc_idx
  on public.subscription_invoice_document_events (document_id, created_at);
alter table public.subscription_invoice_document_events enable row level security;
revoke all on public.subscription_invoice_document_events from public, anon, authenticated, service_role;
create trigger trg_subscription_invoice_document_events_append_only
  before update or delete on public.subscription_invoice_document_events
  for each row execute function public.billing_append_only();

-- ----------------------------------------------------------------------------
-- 3. webhook: 月額invoice支払の記録（service_roleのみ・冪等）
-- ----------------------------------------------------------------------------
create or replace function public.record_subscription_invoice_payment(
  p_customer_id text, p_subscription_id text, p_stripe_invoice_id text, p_payment_intent_id text,
  p_amount_paid integer, p_currency text, p_period_start timestamptz, p_period_end timestamptz,
  p_paid_at timestamptz, p_livemode boolean, p_event_id text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_sub public.organization_subscriptions;
  v_existing public.subscription_invoice_payments;
  v_number text;
  v_pay public.subscription_invoice_payments;
begin
  if p_stripe_invoice_id is null or p_stripe_invoice_id !~ '^in_[A-Za-z0-9_]+$' then
    raise exception 'invalid invoice id';
  end if;
  if p_amount_paid is null or p_period_start is null or p_period_end is null or p_paid_at is null then
    raise exception 'invoice facts required';
  end if;

  select * into v_sub from public.organization_subscriptions s
  where s.stripe_subscription_id = p_subscription_id and s.stripe_customer_id = p_customer_id for update;
  if v_sub.organization_id is null then
    return jsonb_build_object('result', 'subscription_not_synced');
  end if;

  -- 同じStripe invoiceの再送は冪等（番号を二重に採番しない）。
  select * into v_existing from public.subscription_invoice_payments where stripe_invoice_id = p_stripe_invoice_id;
  if v_existing.id is not null then
    return jsonb_build_object('result', 'already_recorded', 'payment_id', v_existing.id,
                              'invoice_number', v_existing.invoice_number);
  end if;

  if p_amount_paid = 0 then
    return jsonb_build_object('result', 'ignored_zero_amount');
  end if;
  if lower(coalesce(p_currency, '')) <> 'jpy' then
    perform public.stripe_log_issue('currency_mismatch', 'critical', v_sub.organization_id, null, null,
      p_event_id, p_stripe_invoice_id, 'subscription invoice currency is not jpy');
    return jsonb_build_object('result', 'integrity_issue');
  end if;
  -- 決済時snapshot（税込）とStripeの支払額が一致するときだけ記録する。税は再計算しない。
  if v_sub.total_amount is null or v_sub.amount_excl_tax is null
     or v_sub.tax_rate is null or v_sub.tax_amount is null
     or p_amount_paid <> v_sub.total_amount then
    perform public.stripe_log_issue('amount_mismatch', 'critical', v_sub.organization_id, null, null,
      p_event_id, p_stripe_invoice_id,
      'subscription invoice amount does not match the tax-inclusive amount confirmed at checkout');
    return jsonb_build_object('result', 'integrity_issue');
  end if;

  v_number := public.allocate_invoice_number(extract(year from (p_paid_at at time zone 'Asia/Tokyo'))::integer);
  insert into public.subscription_invoice_payments (
    organization_id, stripe_invoice_id, stripe_subscription_id, stripe_payment_intent_id, invoice_number,
    period_start, period_end, amount_excl_tax, tax_rate, tax_amount, total_amount, stripe_amount_paid,
    paid_at, livemode
  ) values (
    v_sub.organization_id, p_stripe_invoice_id, p_subscription_id, p_payment_intent_id, v_number,
    p_period_start, p_period_end, v_sub.amount_excl_tax, v_sub.tax_rate, v_sub.tax_amount, v_sub.total_amount,
    p_amount_paid, p_paid_at, coalesce(p_livemode, false)
  ) returning * into v_pay;

  return jsonb_build_object('result', 'recorded', 'payment_id', v_pay.id, 'invoice_number', v_pay.invoice_number,
                            'organization_id', v_pay.organization_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. 発行状態の計算（内部）：不足項目・警告・snapshot・保存先パスを1か所で作る
-- ----------------------------------------------------------------------------
create or replace function public.subscription_invoice_issue_state(p_payment_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  p public.subscription_invoice_payments;
  i public.billing_issuer_settings;
  r public.organization_billing_profiles;
  v_missing text[] := '{}';
  v_warnings text[] := '{}';
  v_already boolean;
  v_issuer jsonb;
  v_recipient jsonb;
  v_content jsonb;
  v_path text;
begin
  select * into p from public.subscription_invoice_payments where id = p_payment_id;
  if p.id is null then raise exception 'subscription invoice payment not found'; end if;
  v_already := exists (select 1 from public.subscription_invoice_documents d where d.payment_id = p.id);

  select * into i from public.billing_issuer_settings where id;
  if i.legal_name is null then v_missing := array_append(v_missing, 'issuer_legal_name'); end if;
  if i.invoice_registration_number is null then v_missing := array_append(v_missing, 'issuer_registration_number'); end if;
  if i.address is null then v_missing := array_append(v_missing, 'issuer_address'); end if;
  if i.postal_code is null then v_warnings := array_append(v_warnings, 'issuer_postal_code'); end if;
  -- 振込先はカード決済済みのため不要。

  select * into r from public.organization_billing_profiles where organization_id = p.organization_id;
  if r.organization_id is null then v_missing := array_append(v_missing, 'recipient_legal_name'); end if;

  if coalesce(array_length(v_missing, 1), 0) > 0 then
    return jsonb_build_object('already_issued', v_already,
                              'missing', to_jsonb(v_missing), 'warnings', to_jsonb(v_warnings));
  end if;

  v_issuer := jsonb_build_object(
    'legal_name', i.legal_name, 'postal_code', i.postal_code, 'address', i.address,
    'invoice_registration_number', i.invoice_registration_number,
    'phone', i.phone, 'email', i.email);
  v_recipient := jsonb_build_object(
    'legal_name', r.legal_name, 'postal_code', r.postal_code, 'address', r.address,
    'department_name', r.department_name, 'contact_name', r.contact_name);
  v_content := jsonb_build_object(
    'document_kind', 'subscription_card',
    'invoice_number', p.invoice_number,
    'invoice_date', (p.paid_at at time zone 'Asia/Tokyo')::date,
    -- 取引年月日：役務提供の期間（開始日〜終了日。period_endは翌期開始のため前日を終了日とする）。
    'transaction_date', (p.period_start at time zone 'Asia/Tokyo')::date,
    'service_period_start', (p.period_start at time zone 'Asia/Tokyo')::date,
    'service_period_end', ((p.period_end at time zone 'Asia/Tokyo')::date - 1),
    'currency', p.currency,
    'amount_excl_tax', p.amount_excl_tax,
    'tax_rate', p.tax_rate,
    'tax_amount', p.tax_amount,
    'total_amount', p.total_amount,
    'tax_breakdown', jsonb_build_array(jsonb_build_object(
      'tax_rate', p.tax_rate, 'taxable_amount', p.amount_excl_tax, 'tax_amount', p.tax_amount)),
    'line_items', jsonb_build_array(jsonb_build_object(
      'description', 'Beauty Reach 月額利用料', 'quantity', 1, 'unit', 'か月', 'amount', p.amount_excl_tax)),
    'payment', jsonb_build_object(
      'method', 'credit_card', 'status', 'paid', 'paid_at', p.paid_at,
      'stripe_invoice_id', p.stripe_invoice_id, 'stripe_payment_intent_id', p.stripe_payment_intent_id)
  );
  v_path := 'invoices/' || p.organization_id::text || '/' || p.invoice_number || '.pdf';

  return jsonb_build_object(
    'already_issued', v_already, 'missing', '[]'::jsonb, 'warnings', to_jsonb(v_warnings),
    'issuer_snapshot', v_issuer, 'recipient_snapshot', v_recipient,
    'invoice_content_snapshot', v_content, 'storage_path', v_path,
    'snapshot_digest', public.invoice_snapshot_digest(v_issuer, v_recipient, v_content),
    'organization_id', p.organization_id, 'invoice_number', p.invoice_number
  );
end;
$$;
revoke all on function public.subscription_invoice_issue_state(uuid) from public, anon, authenticated, service_role;

-- 内部：発行の登録（snapshotはここでDBが再計算し、PDF生成時のdigestと一致した場合だけ保存）。
create or replace function public.subscription_invoice_register(
  p_payment_id uuid, p_snapshot_digest text, p_file_sha256 text, p_actor uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  p public.subscription_invoice_payments;
  s jsonb;
  v_sha text := lower(btrim(coalesce(p_file_sha256, '')));
  v_doc public.subscription_invoice_documents;
begin
  if v_sha !~ '^[0-9a-f]{64}$' then raise exception 'invalid file hash'; end if;
  -- 同じ支払の同時発行を直列化する。
  select * into p from public.subscription_invoice_payments where id = p_payment_id for share;
  if p.id is null then raise exception 'subscription invoice payment not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p.id::text, 49));

  s := public.subscription_invoice_issue_state(p_payment_id);
  if (s ->> 'already_issued')::boolean then raise exception 'invoice document already issued'; end if;
  if jsonb_array_length(s -> 'missing') > 0 then raise exception 'invoice is not ready to issue'; end if;
  if p_snapshot_digest is distinct from (s ->> 'snapshot_digest') then
    raise exception 'invoice snapshot has changed; regenerate the document';
  end if;

  insert into public.subscription_invoice_documents (
    payment_id, organization_id, invoice_number, storage_path, file_sha256,
    issuer_snapshot, recipient_snapshot, invoice_content_snapshot, generated_by_user_id
  ) values (
    p.id, p.organization_id, p.invoice_number, s ->> 'storage_path', v_sha,
    s -> 'issuer_snapshot', s -> 'recipient_snapshot', s -> 'invoice_content_snapshot', p_actor
  ) returning * into v_doc;

  insert into public.subscription_invoice_document_events (document_id, event_type, actor_user_id)
  values (v_doc.id, 'issued', p_actor);

  return jsonb_build_object('document_id', v_doc.id, 'invoice_number', v_doc.invoice_number,
                            'storage_path', v_doc.storage_path, 'generated_at', v_doc.generated_at);
end;
$$;
revoke all on function public.subscription_invoice_register(uuid, text, text, uuid) from public, anon, authenticated, service_role;

-- 自動発行（service_role）：prepare / register
create or replace function public.service_prepare_subscription_invoice(p_payment_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare s jsonb;
begin
  s := public.subscription_invoice_issue_state(p_payment_id);
  if (s ->> 'already_issued')::boolean then return jsonb_build_object('result', 'already_issued'); end if;
  if jsonb_array_length(s -> 'missing') > 0 then
    return jsonb_build_object('result', 'not_ready', 'missing', s -> 'missing');
  end if;
  return jsonb_build_object('result', 'ready') || (s - 'already_issued' - 'missing');
end;
$$;
create or replace function public.service_register_subscription_invoice(
  p_payment_id uuid, p_snapshot_digest text, p_file_sha256 text
) returns jsonb
language sql security definer set search_path = public, pg_temp
as $$
  select public.subscription_invoice_register(p_payment_id, p_snapshot_digest, p_file_sha256, null);
$$;

-- 手動発行・再試行（platform admin）：prepare / register / readiness
create or replace function public.get_subscription_invoice_issue_readiness(p_payment_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare s jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  s := public.subscription_invoice_issue_state(p_payment_id);
  return jsonb_build_object('already_issued', s -> 'already_issued', 'missing', s -> 'missing', 'warnings', s -> 'warnings');
end;
$$;
create or replace function public.prepare_subscription_invoice_document(p_payment_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare s jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  s := public.subscription_invoice_issue_state(p_payment_id);
  if (s ->> 'already_issued')::boolean then raise exception 'invoice document already issued'; end if;
  if jsonb_array_length(s -> 'missing') > 0 then raise exception 'invoice is not ready to issue'; end if;
  return s - 'already_issued' - 'missing';
end;
$$;
create or replace function public.register_subscription_invoice_document(
  p_payment_id uuid, p_snapshot_digest text, p_file_sha256 text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  return public.subscription_invoice_register(p_payment_id, p_snapshot_digest, p_file_sha256, auth.uid());
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. 閲覧RPC
-- ----------------------------------------------------------------------------
-- 運営者：月額カード決済の履歴（発行状態つき）。
create or replace function public.get_admin_subscription_invoices(p_organization_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'payment_id', p.id, 'organization_id', p.organization_id, 'invoice_number', p.invoice_number,
      'stripe_invoice_id', p.stripe_invoice_id, 'period_start', p.period_start, 'period_end', p.period_end,
      'amount_excl_tax', p.amount_excl_tax, 'tax_rate', p.tax_rate, 'tax_amount', p.tax_amount,
      'total_amount', p.total_amount, 'paid_at', p.paid_at,
      'document_id', d.id, 'document_generated_at', d.generated_at
    ) order by p.paid_at desc)
    from public.subscription_invoice_payments p
    left join public.subscription_invoice_documents d on d.payment_id = p.id
    where p_organization_id is null or p.organization_id = p_organization_id
  ), '[]'::jsonb);
end;
$$;

-- 会社側：自社の月額支払履歴（Stripe参照は返さない）。
create or replace function public.get_company_subscription_invoices(p_organization_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon')
     or not exists (
       select 1 from public.organization_members om
       where om.organization_id = p_organization_id and om.user_id = v_uid
         and om.role in ('company_owner', 'company_admin')) then
    raise exception 'organization not found or not accessible';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'payment_id', p.id, 'invoice_number', p.invoice_number,
      'period_start', p.period_start, 'period_end', p.period_end,
      'amount_excl_tax', p.amount_excl_tax, 'tax_rate', p.tax_rate, 'tax_amount', p.tax_amount,
      'total_amount', p.total_amount, 'paid_at', p.paid_at, 'payment_method', 'credit_card',
      'document_id', d.id
    ) order by p.paid_at desc)
    from public.subscription_invoice_payments p
    left join public.subscription_invoice_documents d on d.payment_id = p.id
    where p.organization_id = p_organization_id
  ), '[]'::jsonb);
end;
$$;

-- ダウンロードの権限確認と記録（Storage取得前に必ず通す）。
create or replace function public.authorize_subscription_invoice_download(p_document_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  d public.subscription_invoice_documents;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into d from public.subscription_invoice_documents where id = p_document_id;
  if d.id is null
     or not (
       public.is_platform_admin()
       or (
         exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon')
         and exists (
           select 1 from public.organization_members om
           where om.organization_id = d.organization_id and om.user_id = v_uid
             and om.role in ('company_owner', 'company_admin'))
       )
     ) then
    raise exception 'invoice document not found or not accessible';
  end if;
  insert into public.subscription_invoice_document_events (document_id, event_type, actor_user_id)
  values (d.id, 'downloaded', v_uid);
  return jsonb_build_object('document_id', d.id, 'invoice_number', d.invoice_number,
                            'storage_path', d.storage_path, 'file_sha256', d.file_sha256);
end;
$$;

-- 自動発行が止まっている支払（発行事業者/請求先の未設定など）の一覧（運営向け）。
create or replace function public.get_admin_unissued_subscription_invoices()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'payment_id', p.id, 'organization_id', p.organization_id, 'invoice_number', p.invoice_number,
      'paid_at', p.paid_at, 'missing', public.subscription_invoice_issue_state(p.id) -> 'missing'
    ) order by p.paid_at)
    from public.subscription_invoice_payments p
    where not exists (select 1 from public.subscription_invoice_documents d where d.payment_id = p.id)
  ), '[]'::jsonb);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. 実行権限
-- ----------------------------------------------------------------------------
revoke all on function public.record_subscription_invoice_payment(text, text, text, text, integer, text, timestamptz, timestamptz, timestamptz, boolean, text) from public, anon, authenticated;
revoke all on function public.service_prepare_subscription_invoice(uuid) from public, anon, authenticated;
revoke all on function public.service_register_subscription_invoice(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_subscription_invoice_issue_readiness(uuid) from public, anon;
revoke all on function public.prepare_subscription_invoice_document(uuid) from public, anon;
revoke all on function public.register_subscription_invoice_document(uuid, text, text) from public, anon;
revoke all on function public.get_admin_subscription_invoices(uuid) from public, anon;
revoke all on function public.get_company_subscription_invoices(uuid) from public, anon;
revoke all on function public.authorize_subscription_invoice_download(uuid) from public, anon;
revoke all on function public.get_admin_unissued_subscription_invoices() from public, anon;

grant execute on function public.record_subscription_invoice_payment(text, text, text, text, integer, text, timestamptz, timestamptz, timestamptz, boolean, text) to service_role;
grant execute on function public.service_prepare_subscription_invoice(uuid) to service_role;
grant execute on function public.service_register_subscription_invoice(uuid, text, text) to service_role;
grant execute on function public.get_subscription_invoice_issue_readiness(uuid) to authenticated;
grant execute on function public.prepare_subscription_invoice_document(uuid) to authenticated;
grant execute on function public.register_subscription_invoice_document(uuid, text, text) to authenticated;
grant execute on function public.get_admin_subscription_invoices(uuid) to authenticated;
grant execute on function public.get_company_subscription_invoices(uuid) to authenticated;
grant execute on function public.authorize_subscription_invoice_download(uuid) to authenticated;
grant execute on function public.get_admin_unissued_subscription_invoices() to authenticated;

commit;
