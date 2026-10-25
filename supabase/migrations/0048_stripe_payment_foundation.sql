-- ============================================================================
-- Beauty Reach — 0048_stripe_payment_foundation
--
-- Phase 48: Stripe カード決済基盤（月額自動課金 / 成功報酬のカード払い /
-- 追加Scout枠のカード購入）。
--
-- ★既存 0001〜0047 は一切編集しない。既存の契約・成功報酬・請求書・銀行振込の
--   テーブル/関数/トリガー/RLSは無変更（hiring_success_fees・
--   organization_contract_settings・invoice_documents等へのALTERも無い）。
--   新規テーブル・新規関数のみを追加する。
--
-- ★カード番号・CVC・有効期限・PaymentMethodの詳細はDBに保存しない。
--   保持するのはStripeのID（Customer / Subscription / Checkout Session /
--   PaymentIntent / PaymentMethod）と、Beauty Reach側の状態のみ。
--   カードの表示用情報（Visa •••• 4242 等）は画面表示のたびにサーバー側から
--   Stripe APIで取得し、DBには保存しない。
--
-- ★金額・organization_id・success_fee_idはクライアントを信用しない。
--   決済開始RPC（begin_*）がDBの値から「期待金額」を確定して
--   stripe_checkout_recordsに保存し、webhook適用RPC（apply_*）がStripeの
--   実請求額とDBの値の三者一致を確認できた場合のみ状態を更新する。
--   一致しない場合は paid にせず stripe_integrity_issues へ記録する。
--
-- ★税のルール（Beauty Reach全体で統一）:
--   ・契約の月額料金(organization_contract_settings.monthly_fee)と追加スカウト枠の商品価格は
--     「税抜」金額。Stripeへ請求するのは税込 total_amount（税額は DB が floor で確定）。
--   ・税率の既定は 10.00%（billing_default_tax_rate）、1円未満は切り捨て（billing_tax_amount）。
--   ・決済開始時に 税抜/税率/税額/税込 を stripe_checkout_records にsnapshotし、
--     Subscription・購入記録へ引き継ぐ。クライアントから税額・金額は受け取らない。
--   ・成功報酬は 0045 の fee_amount / tax_rate / tax_amount / total_amount を正本とし、
--     0048 では再計算しない（snapshotへコピーするだけ）。
--   ・Stripe側で税を二重に加算しない（Stripe Tax / automatic_tax / tax_rates は使わない。
--     Checkoutの金額 = DBの税込 total_amount が最終決済額）。
--
-- ★権限モデル:
--   ・新規テーブルは全てRLS有効・ポリシー無し・anon/authenticated/service_role
--     からテーブル権限をrevoke（アクセスは全てSECURITY DEFINER RPC経由）。
--   ・会社向けRPC: authenticated。company_owner/company_admin のみ
--     （recruiting_adminを含むその他のroleは不可）。
--   ・webhook適用RPC: service_role のみ（authenticated/anonは実行不可）。
--   ・platform admin向けRPC: authenticated + is_platform_admin()。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. テーブル
-- ----------------------------------------------------------------------------

-- 1 organization = 1 Stripe Customer。
create table public.organization_payment_accounts (
  organization_id uuid primary key references public.salon_organizations(id) on delete restrict,
  stripe_customer_id text not null unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  livemode boolean not null,
  default_payment_method_available boolean not null default false,
  stripe_default_payment_method_id text check (stripe_default_payment_method_id is null or stripe_default_payment_method_id ~ '^pm_[A-Za-z0-9]+$'),
  payment_method_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_payment_accounts_pm_consistency
    check (default_payment_method_available or stripe_default_payment_method_id is null)
);
comment on table public.organization_payment_accounts is
  '会社(organization)とStripe Customerの1対1対応。カード情報は保持しない（IDと「支払い方法が登録済みか」の真偽値のみ）。livemodeはtest/liveの取り違え防止。';

-- 月額利用料金のStripe Subscription（1 organization = 最大1件）。
-- 「契約状態(organization_contract_settings.contract_status)」とは別物の「決済状態」を持つ。
create table public.organization_subscriptions (
  organization_id uuid primary key references public.salon_organizations(id) on delete restrict,
  stripe_customer_id text not null check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text not null unique check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  subscription_status text not null check (subscription_status in
    ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')),
  payment_state text not null check (payment_state in ('pending','active','past_due','payment_failed','cancelled')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  -- 決済時点の税snapshot（決済開始時にDBが確定したもの。契約額が後で変わっても変わらない）。
  amount_excl_tax integer check (amount_excl_tax is null or amount_excl_tax > 0),
  tax_rate numeric(5,2) check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 100)),
  tax_amount integer check (tax_amount is null or tax_amount >= 0),
  total_amount integer check (total_amount is null or total_amount > 0),
  -- Stripe上で現在請求される1回あたりの税込額（Stripeから取得した観測値）。snapshotと食い違えば不整合。
  stripe_total_amount integer check (stripe_total_amount is null or stripe_total_amount >= 0),
  last_payment_status text check (last_payment_status is null or last_payment_status in ('succeeded','failed')),
  last_payment_at timestamptz,
  last_payment_failed_at timestamptz,
  synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_subscriptions_tax_snapshot check (
    (amount_excl_tax is null and tax_rate is null and tax_amount is null and total_amount is null)
    or (amount_excl_tax is not null and tax_rate is not null and tax_amount is not null and total_amount = amount_excl_tax + tax_amount)
  )
);
comment on table public.organization_subscriptions is
  'Stripe Subscriptionの同期コピー（webhookが正）。payment_stateは契約状態と分離した決済状態。contract_statusはこのテーブルから変更しない。';

-- 追加Scout枠の商品定義。「何件でいくら」は事業判断のため、この migration では
-- 1行もseedしない（active=trueの行が無い限り購入できない）。
create table public.scout_credit_packages (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 1 and 100),
  credits_count integer not null check (credits_count > 0 and credits_count <= 100000),
  price_excl_tax integer not null check (price_excl_tax > 0),
  tax_rate numeric(5,2) not null default 10.00 check (tax_rate >= 0 and tax_rate <= 100),
  currency text not null default 'JPY' check (currency = 'JPY'),
  active boolean not null default false,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.scout_credit_packages is
  '追加Scout枠の商品（何件でいくら）。事業判断が確定するまでseedしない（0件のまま）。price_excl_taxは税抜価格。購入時にDBが税額・税込額を確定してsnapshotし、Stripeへ渡すのは税込額。';

-- Stripe Checkout Sessionの「サーバー側で確定した期待値」。
create table public.stripe_checkout_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.salon_organizations(id) on delete restrict,
  purpose text not null check (purpose in ('payment_method_setup','monthly_subscription','success_fee','scout_credits')),
  success_fee_id uuid references public.hiring_success_fees(id) on delete restrict,
  scout_credit_package_id uuid references public.scout_credit_packages(id) on delete restrict,
  credits integer check (credits is null or credits > 0),
  -- expected_amount = Stripeへ請求する税込額(total_amount)。下の4列が決済時点の税snapshot。
  expected_amount integer check (expected_amount is null or expected_amount >= 0),
  amount_excl_tax integer check (amount_excl_tax is null or amount_excl_tax >= 0),
  tax_rate numeric(5,2) check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 100)),
  tax_amount integer check (tax_amount is null or tax_amount >= 0),
  total_amount integer check (total_amount is null or total_amount >= 0),
  currency text not null default 'JPY' check (currency = 'JPY'),
  livemode boolean not null,
  stripe_checkout_session_id text unique check (stripe_checkout_session_id is null or stripe_checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  stripe_payment_intent_id text check (stripe_payment_intent_id is null or stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
  status text not null default 'pending' check (status in ('pending','open','completed','expired','superseded','needs_review')),
  created_by_user_id uuid not null,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_checkout_records_purpose_shape check (
    (purpose = 'payment_method_setup' and success_fee_id is null and scout_credit_package_id is null and credits is null
       and expected_amount is null and amount_excl_tax is null and tax_rate is null and tax_amount is null and total_amount is null)
    or (purpose = 'monthly_subscription' and success_fee_id is null and scout_credit_package_id is null and credits is null)
    or (purpose = 'success_fee' and success_fee_id is not null and scout_credit_package_id is null and credits is null)
    or (purpose = 'scout_credits' and success_fee_id is null and scout_credit_package_id is not null and credits is not null)
  ),
  constraint stripe_checkout_records_tax_snapshot check (
    purpose = 'payment_method_setup'
    or (amount_excl_tax is not null and tax_rate is not null and tax_amount is not null and total_amount is not null
        and total_amount > 0 and total_amount = amount_excl_tax + tax_amount and expected_amount = total_amount)
  )
);
comment on table public.stripe_checkout_records is
  '決済開始時にDBの値から確定した期待金額・対象。webhookはStripeの実請求額をここと突き合わせる。success URLへの到達では何も更新しない。';
-- 同じ成功報酬に対して同時に有効なCheckoutは1つだけ（二重決済防止）。
create unique index stripe_checkout_records_one_active_success_fee
  on public.stripe_checkout_records (success_fee_id)
  where purpose = 'success_fee' and status in ('pending','open');
create unique index stripe_checkout_records_one_active_monthly
  on public.stripe_checkout_records (organization_id)
  where purpose = 'monthly_subscription' and status in ('pending','open');
create index stripe_checkout_records_org_idx on public.stripe_checkout_records (organization_id, created_at desc);

-- 成功報酬のカード決済結果（成功時のみ作成・append-only）。
-- 行が無いpaid = 銀行振込（adminによる既存のpaid操作）。
create table public.success_fee_payments (
  id uuid primary key default gen_random_uuid(),
  success_fee_id uuid not null unique references public.hiring_success_fees(id) on delete restrict,
  organization_id uuid not null references public.salon_organizations(id) on delete restrict,
  checkout_record_id uuid not null unique references public.stripe_checkout_records(id) on delete restrict,
  payment_method text not null default 'card' check (payment_method = 'card'),
  amount integer not null check (amount >= 0),
  stripe_payment_intent_id text check (stripe_payment_intent_id is null or stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
  paid_at timestamptz not null,
  created_at timestamptz not null default now()
);
comment on table public.success_fee_payments is
  '成功報酬のカード決済成功記録（append-only）。success_fee_idがunique＝1つの成功報酬に対するカード決済成功は1回だけ。';
create unique index success_fee_payments_pi_unique
  on public.success_fee_payments (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

-- 追加Scout枠のカード購入結果（成功時のみ作成・append-only）。
create table public.scout_credit_purchases (
  id uuid primary key default gen_random_uuid(),
  checkout_record_id uuid not null unique references public.stripe_checkout_records(id) on delete restrict,
  organization_id uuid not null references public.salon_organizations(id) on delete restrict,
  scout_credit_package_id uuid not null references public.scout_credit_packages(id) on delete restrict,
  credits integer not null check (credits > 0),
  -- 購入時点の税snapshot（total_amountがStripeへ請求した税込額）。
  price_excl_tax integer not null check (price_excl_tax > 0),
  tax_rate numeric(5,2) not null check (tax_rate >= 0 and tax_rate <= 100),
  tax_amount integer not null check (tax_amount >= 0),
  total_amount integer not null check (total_amount > 0),
  stripe_payment_intent_id text check (stripe_payment_intent_id is null or stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
  purchased_at timestamptz not null,
  constraint scout_credit_purchases_tax_consistency check (total_amount = price_excl_tax + tax_amount),
  created_at timestamptz not null default now()
);
comment on table public.scout_credit_purchases is
  '追加Scout枠の購入成功記録（append-only）。checkout_record_idがunique＝同じ決済でcreditを二重加算しない。';
create unique index scout_credit_purchases_pi_unique
  on public.scout_credit_purchases (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

-- Webhook event冪等性。raw payloadは保存しない。
create table public.stripe_webhook_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique check (stripe_event_id ~ '^evt_[A-Za-z0-9_]+$'),
  event_type text not null check (char_length(event_type) between 1 and 100),
  livemode boolean not null,
  attempts integer not null default 1,
  received_at timestamptz not null default now(),
  claimed_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_result text not null default 'processing'
    check (processing_result in ('processing','processed','ignored','failed','integrity_issue')),
  error_code text check (error_code is null or char_length(error_code) <= 64)
);
comment on table public.stripe_webhook_events is
  'Stripe event IDによる冪等性管理。raw payload・個人情報・カード情報は保存しない（event id/type/結果コードのみ）。';
create index stripe_webhook_events_received_idx on public.stripe_webhook_events (received_at desc);

-- Stripeとの不整合・要確認事項（管理画面で確認し、手動で解決済みにする）。
create table public.stripe_integrity_issues (
  id uuid primary key default gen_random_uuid(),
  issue_type text not null check (issue_type in (
    'amount_mismatch','currency_mismatch','duplicate_payment','fee_not_payable',
    'customer_mismatch','organization_mismatch','unknown_checkout_session','unknown_customer',
    'duplicate_subscription','refund_or_dispute')),
  severity text not null check (severity in ('critical','warning')),
  organization_id uuid references public.salon_organizations(id) on delete restrict,
  success_fee_id uuid references public.hiring_success_fees(id) on delete restrict,
  checkout_record_id uuid references public.stripe_checkout_records(id) on delete restrict,
  stripe_event_id text,
  stripe_object_id text,
  detail text check (detail is null or char_length(detail) <= 500),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000)
);
comment on table public.stripe_integrity_issues is
  'Stripe側とDBの不整合記録。通常UIにはStripe技術IDを出さない（詳細adminのみ）。';
-- 同じeventの再送で同じ未解決issueを重複登録しない。
create unique index stripe_integrity_issues_dedupe
  on public.stripe_integrity_issues (issue_type, stripe_event_id)
  where stripe_event_id is not null and resolved_at is null;
create index stripe_integrity_issues_open_idx on public.stripe_integrity_issues (created_at desc) where resolved_at is null;

-- ----------------------------------------------------------------------------
-- 2. RLS / 権限（全テーブル: ポリシー無し＝直接アクセス不可）
-- ----------------------------------------------------------------------------
alter table public.organization_payment_accounts enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.scout_credit_packages enable row level security;
alter table public.stripe_checkout_records enable row level security;
alter table public.success_fee_payments enable row level security;
alter table public.scout_credit_purchases enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.stripe_integrity_issues enable row level security;

revoke all on public.organization_payment_accounts from public, anon, authenticated, service_role;
revoke all on public.organization_subscriptions from public, anon, authenticated, service_role;
revoke all on public.scout_credit_packages from public, anon, authenticated, service_role;
revoke all on public.stripe_checkout_records from public, anon, authenticated, service_role;
revoke all on public.success_fee_payments from public, anon, authenticated, service_role;
revoke all on public.scout_credit_purchases from public, anon, authenticated, service_role;
revoke all on public.stripe_webhook_events from public, anon, authenticated, service_role;
revoke all on public.stripe_integrity_issues from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. トリガー（updated_at / 不変列 / append-only）
-- ----------------------------------------------------------------------------
create trigger trg_organization_payment_accounts_updated before update on public.organization_payment_accounts
  for each row execute function public.set_updated_at();
create trigger trg_organization_subscriptions_updated before update on public.organization_subscriptions
  for each row execute function public.set_updated_at();
create trigger trg_scout_credit_packages_updated before update on public.scout_credit_packages
  for each row execute function public.set_updated_at();
create trigger trg_stripe_checkout_records_updated before update on public.stripe_checkout_records
  for each row execute function public.set_updated_at();

create or replace function public.stripe_payment_accounts_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.organization_id <> old.organization_id
     or new.stripe_customer_id <> old.stripe_customer_id
     or new.livemode <> old.livemode then
    raise exception 'payment account identity cannot be changed';
  end if;
  return new;
end;
$$;
create trigger trg_organization_payment_accounts_guard before update on public.organization_payment_accounts
  for each row execute function public.stripe_payment_accounts_guard();

create or replace function public.stripe_subscriptions_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.organization_id <> old.organization_id then
    raise exception 'subscription organization cannot be changed';
  end if;
  return new;
end;
$$;
create trigger trg_organization_subscriptions_guard before update on public.organization_subscriptions
  for each row execute function public.stripe_subscriptions_guard();

create or replace function public.stripe_checkout_records_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.organization_id <> old.organization_id
     or new.purpose <> old.purpose
     or new.success_fee_id is distinct from old.success_fee_id
     or new.scout_credit_package_id is distinct from old.scout_credit_package_id
     or new.credits is distinct from old.credits
     or new.expected_amount is distinct from old.expected_amount
     or new.amount_excl_tax is distinct from old.amount_excl_tax
     or new.tax_rate is distinct from old.tax_rate
     or new.tax_amount is distinct from old.tax_amount
     or new.total_amount is distinct from old.total_amount
     or new.livemode <> old.livemode
     or new.created_by_user_id <> old.created_by_user_id
     or new.created_at <> old.created_at then
    raise exception 'checkout record expectations cannot be changed';
  end if;
  if old.stripe_checkout_session_id is not null
     and new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id then
    raise exception 'checkout session id cannot be changed';
  end if;
  if old.status = 'completed' and new.status <> 'completed' then
    raise exception 'completed checkout record is final';
  end if;
  return new;
end;
$$;
create trigger trg_stripe_checkout_records_guard before update on public.stripe_checkout_records
  for each row execute function public.stripe_checkout_records_guard();
create trigger trg_stripe_checkout_records_no_delete before delete on public.stripe_checkout_records
  for each row execute function public.billing_append_only();

create trigger trg_success_fee_payments_append_only before update or delete on public.success_fee_payments
  for each row execute function public.billing_append_only();
create trigger trg_scout_credit_purchases_append_only before update or delete on public.scout_credit_purchases
  for each row execute function public.billing_append_only();
create trigger trg_stripe_integrity_issues_no_delete before delete on public.stripe_integrity_issues
  for each row execute function public.billing_append_only();
create trigger trg_organization_payment_accounts_no_delete before delete on public.organization_payment_accounts
  for each row execute function public.billing_append_only();
create trigger trg_organization_subscriptions_no_delete before delete on public.organization_subscriptions
  for each row execute function public.billing_append_only();

-- ----------------------------------------------------------------------------
-- 4. 内部ヘルパー（どのroleにも公開しない。他のSECURITY DEFINER関数からのみ呼ぶ）
-- ----------------------------------------------------------------------------

-- 会社の請求操作者（company_owner / company_admin のみ。platform adminや
-- recruiting_admin等その他のroleは不可）。
create or replace function public.stripe_assert_company_billing_actor(p_organization_id uuid)
returns void
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;
  if p_organization_id is null or not exists (
    select 1 from public.organization_members om
    where om.organization_id = p_organization_id and om.user_id = auth.uid()
      and om.role in ('company_owner', 'company_admin')
  ) then
    raise exception 'organization not found or not accessible';
  end if;
end;
$$;

create or replace function public.stripe_subscription_payment_state(p_status text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case p_status
    when 'active' then 'active'
    when 'trialing' then 'active'
    when 'past_due' then 'past_due'
    when 'unpaid' then 'payment_failed'
    when 'incomplete_expired' then 'payment_failed'
    when 'canceled' then 'cancelled'
    else 'pending'  -- incomplete / paused
  end;
$$;

create or replace function public.stripe_log_issue(
  p_issue_type text, p_severity text, p_organization_id uuid, p_success_fee_id uuid,
  p_checkout_record_id uuid, p_stripe_event_id text, p_stripe_object_id text, p_detail text
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.stripe_integrity_issues (
    issue_type, severity, organization_id, success_fee_id, checkout_record_id,
    stripe_event_id, stripe_object_id, detail
  ) values (
    p_issue_type, p_severity, p_organization_id, p_success_fee_id, p_checkout_record_id,
    p_stripe_event_id, p_stripe_object_id, left(p_detail, 500)
  ) on conflict do nothing;
end;
$$;

-- Checkout開始の共通処理。同一対象に有効なCheckoutが既にあれば再利用（二重決済防止）。
-- organization_payment_accountsの行をFOR UPDATEし、同一会社の決済開始を直列化する。
create or replace function public.stripe_begin_checkout_record(
  p_organization_id uuid, p_purpose text, p_success_fee_id uuid,
  p_package_id uuid, p_credits integer,
  p_excl integer, p_tax_rate numeric, p_tax integer, p_total integer
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_acc public.organization_payment_accounts;
  v_rec public.stripe_checkout_records;
begin
  select * into v_acc from public.organization_payment_accounts
  where organization_id = p_organization_id for update;
  if v_acc.organization_id is null then raise exception 'payment account required'; end if;

  -- 期限切れの有効レコードは失効。セッション未作成のpendingは残り時間が短ければ失効。
  update public.stripe_checkout_records set status = 'expired'
  where organization_id = p_organization_id and status in ('pending', 'open') and expires_at <= now();
  update public.stripe_checkout_records set status = 'expired'
  where organization_id = p_organization_id and status = 'pending'
    and expires_at < now() + interval '31 minutes';

  -- 同一対象でも期待金額が変わっていれば古いレコードは置き換え。
  update public.stripe_checkout_records set status = 'superseded'
  where organization_id = p_organization_id and purpose = p_purpose
    and status in ('pending', 'open')
    and (p_purpose <> 'success_fee' or success_fee_id = p_success_fee_id)
    and (p_purpose <> 'scout_credits' or scout_credit_package_id = p_package_id)
    and (expected_amount is distinct from p_total or tax_rate is distinct from p_tax_rate
         or amount_excl_tax is distinct from p_excl or tax_amount is distinct from p_tax);

  select * into v_rec from public.stripe_checkout_records
  where organization_id = p_organization_id and purpose = p_purpose
    and status in ('pending', 'open')
    and (p_purpose <> 'success_fee' or success_fee_id = p_success_fee_id)
    and (p_purpose <> 'scout_credits' or scout_credit_package_id = p_package_id)
  order by created_at desc limit 1;

  if found then
    return jsonb_build_object(
      'record_id', v_rec.id, 'stripe_customer_id', v_acc.stripe_customer_id,
      'livemode', v_acc.livemode, 'expires_at', v_rec.expires_at,
      'expected_amount', v_rec.expected_amount, 'amount_excl_tax', v_rec.amount_excl_tax,
      'tax_rate', v_rec.tax_rate, 'tax_amount', v_rec.tax_amount, 'total_amount', v_rec.total_amount,
      'reuse_stripe_session_id', v_rec.stripe_checkout_session_id, 'reused', true);
  end if;

  insert into public.stripe_checkout_records (
    organization_id, purpose, success_fee_id, scout_credit_package_id, credits,
    expected_amount, amount_excl_tax, tax_rate, tax_amount, total_amount,
    livemode, status, created_by_user_id, expires_at
  ) values (
    p_organization_id, p_purpose, p_success_fee_id, p_package_id, p_credits,
    p_total, p_excl, p_tax_rate, p_tax, p_total,
    v_acc.livemode, 'pending', auth.uid(), now() + interval '60 minutes'
  ) returning * into v_rec;

  return jsonb_build_object(
    'record_id', v_rec.id, 'stripe_customer_id', v_acc.stripe_customer_id,
    'livemode', v_acc.livemode, 'expires_at', v_rec.expires_at,
    'expected_amount', v_rec.expected_amount, 'amount_excl_tax', v_rec.amount_excl_tax,
    'tax_rate', v_rec.tax_rate, 'tax_amount', v_rec.tax_amount, 'total_amount', v_rec.total_amount,
    'reuse_stripe_session_id', null, 'reused', false);
end;
$$;

revoke all on function public.stripe_assert_company_billing_actor(uuid) from public, anon, authenticated, service_role;
revoke all on function public.stripe_subscription_payment_state(text) from public, anon, authenticated, service_role;
revoke all on function public.stripe_log_issue(text, text, uuid, uuid, uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.stripe_begin_checkout_record(uuid, text, uuid, uuid, integer, integer, numeric, integer, integer) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. 会社向けRPC（authenticated / company_owner・company_admin のみ）
-- ----------------------------------------------------------------------------

-- Stripe Customer取得（サーバー側がStripe API呼び出しに使う。クライアントへは返さない運用）。
create or replace function public.get_organization_stripe_customer(p_organization_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_acc public.organization_payment_accounts;
  v_name text;
begin
  perform public.stripe_assert_company_billing_actor(p_organization_id);
  select * into v_acc from public.organization_payment_accounts where organization_id = p_organization_id;
  select name into v_name from public.salon_organizations where id = p_organization_id;
  return jsonb_build_object(
    'organization_id', p_organization_id,
    'organization_name', v_name,
    'stripe_customer_id', v_acc.stripe_customer_id,
    'livemode', v_acc.livemode);
end;
$$;

-- Stripe Customer作成後の登録（1 organization = 1 Customer。競合時は先勝ち）。
create or replace function public.register_stripe_customer(
  p_organization_id uuid, p_stripe_customer_id text, p_livemode boolean
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_acc public.organization_payment_accounts;
begin
  perform public.stripe_assert_company_billing_actor(p_organization_id);
  if p_stripe_customer_id is null or p_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$' then
    raise exception 'invalid stripe customer id';
  end if;
  if p_livemode is null then raise exception 'livemode required'; end if;

  insert into public.organization_payment_accounts (organization_id, stripe_customer_id, livemode)
  values (p_organization_id, p_stripe_customer_id, p_livemode)
  on conflict (organization_id) do nothing;

  select * into v_acc from public.organization_payment_accounts where organization_id = p_organization_id;
  return jsonb_build_object('stripe_customer_id', v_acc.stripe_customer_id, 'livemode', v_acc.livemode,
                            'created', v_acc.stripe_customer_id = p_stripe_customer_id);
end;
$$;

create or replace function public.begin_payment_method_setup(p_organization_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.stripe_assert_company_billing_actor(p_organization_id);
  return public.stripe_begin_checkout_record(p_organization_id, 'payment_method_setup', null, null, null, null, null, null, null);
end;
$$;

-- 月額: 契約が有効(active)で月額料金が1円以上のときのみ開始できる。
create or replace function public.begin_monthly_subscription_checkout(p_organization_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_c public.organization_contract_settings;
  v_sub public.organization_subscriptions;
  v_rate numeric(5,2) := public.billing_default_tax_rate();
  v_tax integer;
  v_result jsonb;
begin
  perform public.stripe_assert_company_billing_actor(p_organization_id);

  select * into v_c from public.organization_contract_settings where organization_id = p_organization_id;
  if v_c.organization_id is null then raise exception 'contract not found'; end if;
  if v_c.contract_status <> 'active' then raise exception 'contract not active'; end if;
  if v_c.monthly_fee is null then raise exception 'monthly fee not set'; end if;
  if v_c.monthly_fee = 0 then raise exception 'monthly fee is zero'; end if;

  select * into v_sub from public.organization_subscriptions where organization_id = p_organization_id;
  if v_sub.organization_id is not null and v_sub.payment_state <> 'cancelled' then
    raise exception 'subscription already exists';
  end if;

  -- 契約の月額は税抜。税額はDBが確定し、Stripeへ渡すのは税込 total_amount。
  v_tax := public.billing_tax_amount(v_c.monthly_fee, v_rate);
  v_result := public.stripe_begin_checkout_record(
    p_organization_id, 'monthly_subscription', null, null, null,
    v_c.monthly_fee, v_rate, v_tax, v_c.monthly_fee + v_tax);
  return v_result || jsonb_build_object('monthly_fee_excl_tax', v_c.monthly_fee);
end;
$$;

-- 成功報酬のカード払い: 請求済み(invoiced)・合計金額が確定し1円以上のものだけ。
-- 金額は必ずDBのtotal_amount。クライアントから金額は受け取らない。
create or replace function public.begin_success_fee_card_checkout(p_fee_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_fee public.hiring_success_fees;
  v_result jsonb;
begin
  select * into v_fee from public.hiring_success_fees where id = p_fee_id;
  if v_fee.id is null then raise exception 'success fee not found'; end if;
  perform public.stripe_assert_company_billing_actor(v_fee.organization_id);

  -- 請求操作との競合を避けるため、決済レコード作成前に成功報酬をロックして再確認。
  select * into v_fee from public.hiring_success_fees where id = p_fee_id for update;
  if v_fee.fee_status <> 'invoiced' then raise exception 'success fee is not payable'; end if;
  if v_fee.invoice_number is null or v_fee.total_amount is null then
    raise exception 'success fee is not payable';
  end if;
  if v_fee.total_amount <= 0 then raise exception 'nothing to pay'; end if;
  if v_fee.currency <> 'JPY' then raise exception 'unsupported currency'; end if;
  if v_fee.fee_amount is null or v_fee.tax_amount is null or v_fee.tax_rate is null then
    raise exception 'success fee is not payable';
  end if;

  -- 税額は0045で確定済みの値を正本とし、ここでは再計算せずそのままsnapshotへコピーする。
  v_result := public.stripe_begin_checkout_record(
    v_fee.organization_id, 'success_fee', v_fee.id, null, null,
    v_fee.fee_amount, v_fee.tax_rate, v_fee.tax_amount, v_fee.total_amount);
  return v_result || jsonb_build_object(
    'success_fee_id', v_fee.id, 'organization_id', v_fee.organization_id,
    'invoice_number', v_fee.invoice_number, 'total_amount', v_fee.total_amount);
end;
$$;

-- 追加Scout枠の購入開始。契約が停止/解約の会社は購入不可。価格は税抜、税額はDBが確定。
create or replace function public.begin_scout_credit_checkout(p_organization_id uuid, p_package_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_pkg public.scout_credit_packages;
  v_status text;
  v_tax integer;
  v_result jsonb;
begin
  perform public.stripe_assert_company_billing_actor(p_organization_id);

  select * into v_pkg from public.scout_credit_packages where id = p_package_id and active;
  if v_pkg.id is null then raise exception 'scout credit package not available'; end if;

  select contract_status into v_status from public.organization_contract_settings
  where organization_id = p_organization_id;
  if v_status in ('suspended', 'cancelled') then raise exception 'contract not active'; end if;

  v_tax := public.billing_tax_amount(v_pkg.price_excl_tax, v_pkg.tax_rate);
  v_result := public.stripe_begin_checkout_record(
    p_organization_id, 'scout_credits', null, v_pkg.id, v_pkg.credits_count,
    v_pkg.price_excl_tax, v_pkg.tax_rate, v_tax, v_pkg.price_excl_tax + v_tax);
  return v_result || jsonb_build_object('label', v_pkg.label, 'credits', v_pkg.credits_count);
end;
$$;

-- Stripe Checkout Session作成後に、レコードへSession IDを紐付ける（作成者本人のみ）。
create or replace function public.attach_stripe_checkout_session(p_record_id uuid, p_stripe_session_id text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_rec public.stripe_checkout_records;
begin
  if p_stripe_session_id is null or p_stripe_session_id !~ '^cs_[A-Za-z0-9_]+$' then
    raise exception 'invalid checkout session id';
  end if;
  select * into v_rec from public.stripe_checkout_records where id = p_record_id for update;
  if v_rec.id is null then raise exception 'checkout record not found'; end if;
  perform public.stripe_assert_company_billing_actor(v_rec.organization_id);
  if v_rec.created_by_user_id <> auth.uid() then raise exception 'checkout record not found'; end if;

  if v_rec.stripe_checkout_session_id = p_stripe_session_id then
    return jsonb_build_object('record_id', v_rec.id, 'status', v_rec.status);
  end if;
  if v_rec.stripe_checkout_session_id is not null or v_rec.status not in ('pending') then
    raise exception 'checkout record cannot be attached';
  end if;

  update public.stripe_checkout_records
  set stripe_checkout_session_id = p_stripe_session_id, status = 'open'
  where id = v_rec.id;
  return jsonb_build_object('record_id', v_rec.id, 'status', 'open');
end;
$$;

-- 会社の支払い状況（Stripe技術IDは返さない）。
create or replace function public.get_company_payment_overview(p_organization_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_c public.organization_contract_settings;
  v_acc public.organization_payment_accounts;
  v_sub public.organization_subscriptions;
  v_packages jsonb;
  v_startable boolean;
  v_rate numeric(5,2) := public.billing_default_tax_rate();
  v_tax integer;
begin
  perform public.stripe_assert_company_billing_actor(p_organization_id);
  select * into v_c from public.organization_contract_settings where organization_id = p_organization_id;
  select * into v_acc from public.organization_payment_accounts where organization_id = p_organization_id;
  select * into v_sub from public.organization_subscriptions where organization_id = p_organization_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'package_id', p.id, 'label', p.label, 'credits', p.credits_count,
    'price_excl_tax', p.price_excl_tax, 'tax_rate', p.tax_rate,
    'tax_amount', public.billing_tax_amount(p.price_excl_tax, p.tax_rate),
    'total_amount', p.price_excl_tax + public.billing_tax_amount(p.price_excl_tax, p.tax_rate)
  ) order by p.credits_count), '[]'::jsonb) into v_packages
  from public.scout_credit_packages p where p.active;

  v_tax := case when v_c.monthly_fee is null then null else public.billing_tax_amount(v_c.monthly_fee, v_rate) end;

  v_startable := v_c.organization_id is not null and v_c.contract_status = 'active'
    and coalesce(v_c.monthly_fee, 0) > 0
    and (v_sub.organization_id is null or v_sub.payment_state = 'cancelled');

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'has_payment_account', v_acc.organization_id is not null,
    'payment_method_available', coalesce(v_acc.default_payment_method_available, false),
    'contract_status', v_c.contract_status,
    'monthly_fee', v_c.monthly_fee,
    'monthly_tax_rate', v_rate,
    'monthly_tax_amount', v_tax,
    'monthly_total_amount', case when v_tax is null then null else v_c.monthly_fee + v_tax end,
    'monthly_fee_state', case when v_c.organization_id is null or v_c.monthly_fee is null then 'unset'
                              when v_c.monthly_fee = 0 then 'none' else 'set' end,
    'subscription_startable', v_startable,
    'subscription', case when v_sub.organization_id is null then null else jsonb_build_object(
      'payment_state', v_sub.payment_state,
      'subscription_status', v_sub.subscription_status,
      'current_period_start', v_sub.current_period_start,
      'current_period_end', v_sub.current_period_end,
      'cancel_at_period_end', v_sub.cancel_at_period_end,
      'amount_excl_tax', v_sub.amount_excl_tax,
      'tax_rate', v_sub.tax_rate,
      'tax_amount', v_sub.tax_amount,
      'total_amount', v_sub.total_amount,
      'stripe_total_amount', v_sub.stripe_total_amount,
      'last_payment_status', v_sub.last_payment_status,
      'last_payment_at', v_sub.last_payment_at,
      'last_payment_failed_at', v_sub.last_payment_failed_at) end,
    'scout_credit_packages', v_packages,
    'scout_credit_purchasable', coalesce(v_c.contract_status, 'active') not in ('suspended', 'cancelled')
                                and jsonb_array_length(v_packages) > 0);
end;
$$;

-- 成功報酬ごとのカード払い可否・支払方法（既存get_company_success_fees(0045)は無変更。
-- UIはfee_idで両者を結合する）。
create or replace function public.get_company_success_fee_payment_info(p_organization_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.stripe_assert_company_billing_actor(p_organization_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'fee_id', f.id,
    'fee_status', f.fee_status,
    'can_pay_by_card', f.fee_status = 'invoiced' and coalesce(f.total_amount, 0) > 0
                       and f.invoice_number is not null,
    'card_checkout_in_progress', exists (
      select 1 from public.stripe_checkout_records r
      where r.success_fee_id = f.id and r.status in ('pending', 'open') and r.expires_at > now()),
    'payment_method', case when f.fee_status <> 'paid' then null
                           when p.id is not null then 'card' else 'bank_transfer' end
  ) order by f.hired_at desc), '[]'::jsonb) into v_result
  from public.hiring_success_fees f
  left join public.success_fee_payments p on p.success_fee_id = f.id
  where f.organization_id = p_organization_id;
  return v_result;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Webhook適用RPC（service_role のみ）
-- ----------------------------------------------------------------------------

create or replace function public.claim_stripe_webhook_event(
  p_event_id text, p_event_type text, p_livemode boolean
) returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_row public.stripe_webhook_events;
begin
  if p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9_]+$' then raise exception 'invalid event id'; end if;
  if p_event_type is null or p_livemode is null then raise exception 'invalid event'; end if;

  insert into public.stripe_webhook_events (stripe_event_id, event_type, livemode)
  values (p_event_id, p_event_type, p_livemode)
  on conflict (stripe_event_id) do nothing;
  if found then return 'claimed'; end if;

  select * into v_row from public.stripe_webhook_events where stripe_event_id = p_event_id for update;
  if v_row.processing_result in ('processed', 'ignored', 'integrity_issue') then return 'duplicate'; end if;
  if v_row.processing_result = 'processing' and v_row.claimed_at > now() - interval '5 minutes' then
    return 'in_progress';
  end if;
  -- failed、または処理中のまま放置された古い行は再処理する。
  update public.stripe_webhook_events
  set processing_result = 'processing', attempts = attempts + 1, claimed_at = now(), error_code = null
  where id = v_row.id;
  return 'claimed';
end;
$$;

create or replace function public.complete_stripe_webhook_event(
  p_event_id text, p_result text, p_error_code text default null
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_result not in ('processed', 'ignored', 'failed', 'integrity_issue') then
    raise exception 'invalid processing result';
  end if;
  update public.stripe_webhook_events
  set processing_result = p_result,
      error_code = left(p_error_code, 64),
      processed_at = case when p_result = 'failed' then null else now() end
  where stripe_event_id = p_event_id;
  if not found then raise exception 'event not found'; end if;
end;
$$;

-- カード登録(Checkout setup mode)完了の反映。
create or replace function public.apply_payment_method_setup(
  p_checkout_record_id uuid, p_session_id text, p_customer_id text,
  p_payment_method_id text, p_session_status text, p_event_id text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_rec public.stripe_checkout_records;
  v_acc public.organization_payment_accounts;
begin
  select * into v_rec from public.stripe_checkout_records where id = p_checkout_record_id for update;
  if v_rec.id is null or v_rec.purpose <> 'payment_method_setup'
     or (v_rec.stripe_checkout_session_id is not null and v_rec.stripe_checkout_session_id <> p_session_id) then
    perform public.stripe_log_issue('unknown_checkout_session', 'warning', null, null, null, p_event_id, p_session_id,
      'payment method setup: checkout record not found or mismatched');
    return jsonb_build_object('result', 'integrity_issue');
  end if;
  if v_rec.status = 'completed' then return jsonb_build_object('result', 'already_applied'); end if;
  if p_session_status is distinct from 'complete' then return jsonb_build_object('result', 'not_complete'); end if;

  select * into v_acc from public.organization_payment_accounts
  where organization_id = v_rec.organization_id for update;
  if v_acc.organization_id is null or v_acc.stripe_customer_id is distinct from p_customer_id then
    perform public.stripe_log_issue('customer_mismatch', 'critical', v_rec.organization_id, null, v_rec.id,
      p_event_id, p_session_id, 'payment method setup: customer does not match the organization');
    update public.stripe_checkout_records set status = 'needs_review',
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id) where id = v_rec.id;
    return jsonb_build_object('result', 'integrity_issue');
  end if;
  if p_payment_method_id is null or p_payment_method_id !~ '^pm_[A-Za-z0-9]+$' then
    return jsonb_build_object('result', 'not_complete');
  end if;

  update public.organization_payment_accounts
  set default_payment_method_available = true,
      stripe_default_payment_method_id = p_payment_method_id,
      payment_method_checked_at = now()
  where organization_id = v_acc.organization_id;
  update public.stripe_checkout_records
  set status = 'completed', completed_at = now(),
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id)
  where id = v_rec.id;
  return jsonb_build_object('result', 'applied', 'organization_id', v_acc.organization_id);
end;
$$;

-- 支払い方法の有無の再同期（payment_method.detached 等の後、StripeのAPIで確認した結果を反映）。
create or replace function public.set_payment_method_state(
  p_customer_id text, p_available boolean, p_payment_method_id text, p_event_id text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_acc public.organization_payment_accounts;
begin
  select * into v_acc from public.organization_payment_accounts
  where stripe_customer_id = p_customer_id for update;
  if v_acc.organization_id is null then
    perform public.stripe_log_issue('unknown_customer', 'warning', null, null, null, p_event_id, p_customer_id,
      'payment method state: unknown customer');
    return jsonb_build_object('result', 'integrity_issue');
  end if;
  if p_available and (p_payment_method_id is null or p_payment_method_id !~ '^pm_[A-Za-z0-9]+$') then
    raise exception 'payment method id required';
  end if;
  update public.organization_payment_accounts
  set default_payment_method_available = coalesce(p_available, false),
      stripe_default_payment_method_id = case when p_available then p_payment_method_id else null end,
      payment_method_checked_at = now()
  where organization_id = v_acc.organization_id;
  return jsonb_build_object('result', 'applied', 'organization_id', v_acc.organization_id);
end;
$$;

-- 月額サブスクリプションのCheckout完了を記録（状態自体はsnapshotが正）。
create or replace function public.apply_subscription_checkout_completed(
  p_checkout_record_id uuid, p_session_id text, p_customer_id text,
  p_session_status text, p_event_id text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_rec public.stripe_checkout_records;
  v_acc public.organization_payment_accounts;
begin
  select * into v_rec from public.stripe_checkout_records where id = p_checkout_record_id for update;
  if v_rec.id is null or v_rec.purpose <> 'monthly_subscription'
     or (v_rec.stripe_checkout_session_id is not null and v_rec.stripe_checkout_session_id <> p_session_id) then
    perform public.stripe_log_issue('unknown_checkout_session', 'warning', null, null, null, p_event_id, p_session_id,
      'subscription checkout: record not found or mismatched');
    return jsonb_build_object('result', 'integrity_issue');
  end if;
  if v_rec.status = 'completed' then return jsonb_build_object('result', 'already_applied'); end if;
  if p_session_status is distinct from 'complete' then return jsonb_build_object('result', 'not_complete'); end if;

  select * into v_acc from public.organization_payment_accounts where organization_id = v_rec.organization_id;
  if v_acc.organization_id is null or v_acc.stripe_customer_id is distinct from p_customer_id then
    perform public.stripe_log_issue('customer_mismatch', 'critical', v_rec.organization_id, null, v_rec.id,
      p_event_id, p_session_id, 'subscription checkout: customer does not match the organization');
    update public.stripe_checkout_records set status = 'needs_review',
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id) where id = v_rec.id;
    return jsonb_build_object('result', 'integrity_issue');
  end if;

  update public.stripe_checkout_records
  set status = 'completed', completed_at = now(),
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id)
  where id = v_rec.id;
  return jsonb_build_object('result', 'applied', 'organization_id', v_rec.organization_id);
end;
$$;

-- Subscriptionの最新状態を反映（呼び出し側はStripe APIで取得した最新オブジェクトを渡す。
-- 組織はDBのcustomer対応から決め、metadataは信用しない）。
create or replace function public.apply_stripe_subscription_snapshot(
  p_customer_id text, p_subscription_id text, p_status text,
  p_period_start timestamptz, p_period_end timestamptz, p_cancel_at_period_end boolean,
  p_amount integer, p_currency text, p_retrieved_at timestamptz, p_event_id text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_acc public.organization_payment_accounts;
  v_sub public.organization_subscriptions;
  v_state text;
  v_rec public.stripe_checkout_records;
begin
  if p_subscription_id is null or p_subscription_id !~ '^sub_[A-Za-z0-9]+$' then raise exception 'invalid subscription id'; end if;
  if p_status is null or p_status not in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused') then
    raise exception 'invalid subscription status';
  end if;
  if p_retrieved_at is null then raise exception 'retrieved_at required'; end if;

  select * into v_acc from public.organization_payment_accounts
  where stripe_customer_id = p_customer_id for update;
  if v_acc.organization_id is null then
    perform public.stripe_log_issue('unknown_customer', 'critical', null, null, null, p_event_id, p_subscription_id,
      'subscription snapshot: customer is not linked to any organization');
    return jsonb_build_object('result', 'integrity_issue');
  end if;
  if upper(coalesce(p_currency, '')) <> 'JPY' then
    perform public.stripe_log_issue('currency_mismatch', 'critical', v_acc.organization_id, null, null, p_event_id,
      p_subscription_id, 'subscription snapshot: currency is not JPY');
    return jsonb_build_object('result', 'integrity_issue');
  end if;

  v_state := public.stripe_subscription_payment_state(p_status);
  select * into v_sub from public.organization_subscriptions
  where organization_id = v_acc.organization_id for update;

  -- 決済開始時にDBが確定した税snapshot（税込額がStripeの請求額と一致する月額Checkoutレコード）。
  select * into v_rec from public.stripe_checkout_records
  where organization_id = v_acc.organization_id and purpose = 'monthly_subscription'
    and total_amount = p_amount
  order by created_at desc limit 1;

  if v_sub.organization_id is null then
    if v_rec.id is null and p_status not in ('canceled', 'incomplete_expired') then
      perform public.stripe_log_issue('amount_mismatch', 'critical', v_acc.organization_id, null, null,
        p_event_id, p_subscription_id, 'subscription amount does not match any DB-confirmed tax-inclusive monthly amount');
    end if;
    insert into public.organization_subscriptions (
      organization_id, stripe_customer_id, stripe_subscription_id, subscription_status, payment_state,
      current_period_start, current_period_end, cancel_at_period_end, stripe_total_amount, synced_at,
      amount_excl_tax, tax_rate, tax_amount, total_amount)
    values (v_acc.organization_id, p_customer_id, p_subscription_id, p_status, v_state,
            p_period_start, p_period_end, coalesce(p_cancel_at_period_end, false), p_amount, p_retrieved_at,
            v_rec.amount_excl_tax, v_rec.tax_rate, v_rec.tax_amount, v_rec.total_amount);
    return jsonb_build_object('result', 'applied', 'organization_id', v_acc.organization_id, 'payment_state', v_state);
  end if;

  if v_sub.stripe_subscription_id = p_subscription_id then
    if p_retrieved_at < v_sub.synced_at then return jsonb_build_object('result', 'stale'); end if;
    -- Stripe上の請求額が決済時のsnapshotと食い違う → 不整合として記録。自動修正はしない。
    if v_sub.total_amount is not null and p_amount is distinct from v_sub.total_amount
       and p_status not in ('canceled', 'incomplete_expired') then
      perform public.stripe_log_issue('amount_mismatch', 'critical', v_acc.organization_id, null, null,
        p_event_id, p_subscription_id, 'Stripe subscription amount differs from the tax-inclusive amount confirmed at checkout');
    end if;
    update public.organization_subscriptions
    set subscription_status = p_status, payment_state = v_state,
        current_period_start = p_period_start, current_period_end = p_period_end,
        cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
        stripe_total_amount = p_amount, synced_at = p_retrieved_at,
        amount_excl_tax = coalesce(amount_excl_tax, v_rec.amount_excl_tax),
        tax_rate = coalesce(tax_rate, v_rec.tax_rate),
        tax_amount = coalesce(tax_amount, v_rec.tax_amount),
        total_amount = coalesce(total_amount, v_rec.total_amount)
    where organization_id = v_acc.organization_id;
    return jsonb_build_object('result', 'applied', 'organization_id', v_acc.organization_id, 'payment_state', v_state);
  end if;

  -- 別のSubscription ID。
  if p_status in ('canceled', 'incomplete_expired') then
    return jsonb_build_object('result', 'ignored');   -- 古い/終了済みの別Subscription
  end if;
  if v_sub.payment_state = 'cancelled' or v_sub.subscription_status in ('canceled', 'incomplete_expired') then
    update public.organization_subscriptions
    set stripe_subscription_id = p_subscription_id, subscription_status = p_status, payment_state = v_state,
        current_period_start = p_period_start, current_period_end = p_period_end,
        cancel_at_period_end = coalesce(p_cancel_at_period_end, false), stripe_total_amount = p_amount,
        amount_excl_tax = v_rec.amount_excl_tax, tax_rate = v_rec.tax_rate,
        tax_amount = v_rec.tax_amount, total_amount = v_rec.total_amount,
        last_payment_status = null, last_payment_at = null, last_payment_failed_at = null,
        synced_at = p_retrieved_at
    where organization_id = v_acc.organization_id;
    return jsonb_build_object('result', 'applied', 'organization_id', v_acc.organization_id, 'payment_state', v_state);
  end if;

  perform public.stripe_log_issue('duplicate_subscription', 'critical', v_acc.organization_id, null, null,
    p_event_id, p_subscription_id, 'a second live subscription exists for the organization');
  return jsonb_build_object('result', 'integrity_issue');
end;
$$;

-- 月額請求の支払い結果（invoice.paid / invoice.payment_failed）。
create or replace function public.apply_stripe_invoice_result(
  p_customer_id text, p_subscription_id text, p_result text, p_event_at timestamptz,
  p_event_id text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_sub public.organization_subscriptions;
  v_latest timestamptz;
begin
  if p_result not in ('succeeded', 'failed') then raise exception 'invalid result'; end if;
  if p_event_at is null then raise exception 'event time required'; end if;

  select s.* into v_sub from public.organization_subscriptions s
  where s.stripe_subscription_id = p_subscription_id and s.stripe_customer_id = p_customer_id for update;
  if v_sub.organization_id is null then
    return jsonb_build_object('result', 'subscription_not_synced');
  end if;

  v_latest := greatest(coalesce(v_sub.last_payment_at, '-infinity'), coalesce(v_sub.last_payment_failed_at, '-infinity'));
  if p_result = 'succeeded' then
    update public.organization_subscriptions
    set last_payment_at = greatest(coalesce(last_payment_at, p_event_at), p_event_at),
        last_payment_status = case when p_event_at >= v_latest then 'succeeded' else last_payment_status end
    where organization_id = v_sub.organization_id;
  else
    update public.organization_subscriptions
    set last_payment_failed_at = greatest(coalesce(last_payment_failed_at, p_event_at), p_event_at),
        last_payment_status = case when p_event_at >= v_latest then 'failed' else last_payment_status end
    where organization_id = v_sub.organization_id;
  end if;
  return jsonb_build_object('result', 'applied', 'organization_id', v_sub.organization_id);
end;
$$;

-- Checkout Sessionの失効。
create or replace function public.mark_stripe_checkout_expired(p_checkout_record_id uuid, p_session_id text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.stripe_checkout_records set status = 'expired'
  where id = p_checkout_record_id and status in ('pending', 'open')
    and (stripe_checkout_session_id is null or stripe_checkout_session_id = p_session_id);
  return jsonb_build_object('result', case when found then 'applied' else 'ignored' end);
end;
$$;

-- 成功報酬のカード決済成功。Stripeの実額・DBの確定額・決済開始時の期待額の
-- 三者が一致し、成功報酬が請求済み(invoiced)のときだけ paid にする。
create or replace function public.apply_success_fee_card_payment(
  p_checkout_record_id uuid, p_session_id text, p_customer_id text,
  p_payment_intent_id text, p_amount_total integer, p_currency text,
  p_payment_status text, p_event_id text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_rec public.stripe_checkout_records;
  v_acc public.organization_payment_accounts;
  v_fee public.hiring_success_fees;
  v_now timestamptz := now();
  v_pi text := case when p_payment_intent_id ~ '^pi_[A-Za-z0-9]+$' then p_payment_intent_id else null end;
begin
  select * into v_rec from public.stripe_checkout_records where id = p_checkout_record_id for update;
  if v_rec.id is null or v_rec.purpose <> 'success_fee'
     or (v_rec.stripe_checkout_session_id is not null and v_rec.stripe_checkout_session_id <> p_session_id) then
    perform public.stripe_log_issue('unknown_checkout_session', 'critical', null, null, null, p_event_id, p_session_id,
      'success fee payment: checkout record not found or mismatched');
    return jsonb_build_object('result', 'integrity_issue');
  end if;
  if v_rec.status = 'completed' then return jsonb_build_object('result', 'already_applied'); end if;
  if p_payment_status is distinct from 'paid' then return jsonb_build_object('result', 'not_paid'); end if;

  select * into v_acc from public.organization_payment_accounts where organization_id = v_rec.organization_id;
  if v_acc.organization_id is null or v_acc.stripe_customer_id is distinct from p_customer_id then
    perform public.stripe_log_issue('customer_mismatch', 'critical', v_rec.organization_id, v_rec.success_fee_id,
      v_rec.id, p_event_id, p_session_id, 'success fee payment: customer does not match the organization');
    update public.stripe_checkout_records set status = 'needs_review', stripe_payment_intent_id = v_pi,
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id) where id = v_rec.id;
    return jsonb_build_object('result', 'integrity_issue');
  end if;
  if upper(coalesce(p_currency, '')) <> 'JPY' then
    perform public.stripe_log_issue('currency_mismatch', 'critical', v_rec.organization_id, v_rec.success_fee_id,
      v_rec.id, p_event_id, p_session_id, 'success fee payment: currency is not JPY');
    update public.stripe_checkout_records set status = 'needs_review', stripe_payment_intent_id = v_pi,
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id) where id = v_rec.id;
    return jsonb_build_object('result', 'integrity_issue');
  end if;

  select * into v_fee from public.hiring_success_fees where id = v_rec.success_fee_id for update;
  if v_fee.id is null or v_fee.organization_id <> v_rec.organization_id then
    perform public.stripe_log_issue('organization_mismatch', 'critical', v_rec.organization_id, v_rec.success_fee_id,
      v_rec.id, p_event_id, p_session_id, 'success fee payment: fee does not belong to the organization');
    update public.stripe_checkout_records set status = 'needs_review', stripe_payment_intent_id = v_pi,
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id) where id = v_rec.id;
    return jsonb_build_object('result', 'integrity_issue');
  end if;

  if p_amount_total is distinct from v_rec.expected_amount or p_amount_total is distinct from v_fee.total_amount then
    perform public.stripe_log_issue('amount_mismatch', 'critical', v_rec.organization_id, v_fee.id, v_rec.id,
      p_event_id, p_session_id, 'success fee payment: charged amount differs from the confirmed total_amount');
    update public.stripe_checkout_records set status = 'needs_review', stripe_payment_intent_id = v_pi,
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id) where id = v_rec.id;
    return jsonb_build_object('result', 'integrity_issue');
  end if;

  if v_fee.fee_status = 'paid' then
    perform public.stripe_log_issue('duplicate_payment', 'critical', v_rec.organization_id, v_fee.id, v_rec.id,
      p_event_id, p_session_id, 'success fee was already paid; a card payment was also received (refund review needed)');
    update public.stripe_checkout_records set status = 'needs_review', stripe_payment_intent_id = v_pi,
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id) where id = v_rec.id;
    return jsonb_build_object('result', 'integrity_issue');
  end if;
  if v_fee.fee_status <> 'invoiced' then
    perform public.stripe_log_issue('fee_not_payable', 'critical', v_rec.organization_id, v_fee.id, v_rec.id,
      p_event_id, p_session_id, 'card payment received for a success fee that is not in invoiced status');
    update public.stripe_checkout_records set status = 'needs_review', stripe_payment_intent_id = v_pi,
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id) where id = v_rec.id;
    return jsonb_build_object('result', 'integrity_issue');
  end if;

  update public.hiring_success_fees
  set fee_status = 'paid', paid_at = v_now
  where id = v_fee.id;

  insert into public.hiring_success_fee_events (
    success_fee_id, event_type, from_status, to_status,
    fee_amount, tax_amount, total_amount, actor_user_id, note
  ) values (
    v_fee.id, 'paid', 'invoiced', 'paid',
    v_fee.fee_amount, v_fee.tax_amount, v_fee.total_amount, null, 'カード決済（Stripe）で入金確認'
  );

  insert into public.success_fee_payments (
    success_fee_id, organization_id, checkout_record_id, amount, stripe_payment_intent_id, paid_at
  ) values (v_fee.id, v_fee.organization_id, v_rec.id, p_amount_total, v_pi, v_now);

  update public.stripe_checkout_records
  set status = 'completed', completed_at = v_now, stripe_payment_intent_id = v_pi,
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id)
  where id = v_rec.id;

  return jsonb_build_object('result', 'paid', 'success_fee_id', v_fee.id, 'organization_id', v_fee.organization_id);
end;
$$;

-- 追加Scout枠のカード購入成功。決済成功後にのみ additional_credits を加算し、
-- 同一決済では二重加算しない（checkout_record_idのunique + 状態確認）。
create or replace function public.apply_scout_credit_payment(
  p_checkout_record_id uuid, p_session_id text, p_customer_id text,
  p_payment_intent_id text, p_amount_total integer, p_currency text,
  p_payment_status text, p_event_id text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_rec public.stripe_checkout_records;
  v_acc public.organization_payment_accounts;
  v_now timestamptz := now();
  v_pi text := case when p_payment_intent_id ~ '^pi_[A-Za-z0-9]+$' then p_payment_intent_id else null end;
begin
  select * into v_rec from public.stripe_checkout_records where id = p_checkout_record_id for update;
  if v_rec.id is null or v_rec.purpose <> 'scout_credits'
     or (v_rec.stripe_checkout_session_id is not null and v_rec.stripe_checkout_session_id <> p_session_id) then
    perform public.stripe_log_issue('unknown_checkout_session', 'critical', null, null, null, p_event_id, p_session_id,
      'scout credit payment: checkout record not found or mismatched');
    return jsonb_build_object('result', 'integrity_issue');
  end if;
  if v_rec.status = 'completed' then return jsonb_build_object('result', 'already_applied'); end if;
  if p_payment_status is distinct from 'paid' then return jsonb_build_object('result', 'not_paid'); end if;

  select * into v_acc from public.organization_payment_accounts where organization_id = v_rec.organization_id;
  if v_acc.organization_id is null or v_acc.stripe_customer_id is distinct from p_customer_id then
    perform public.stripe_log_issue('customer_mismatch', 'critical', v_rec.organization_id, null, v_rec.id,
      p_event_id, p_session_id, 'scout credit payment: customer does not match the organization');
    update public.stripe_checkout_records set status = 'needs_review', stripe_payment_intent_id = v_pi,
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id) where id = v_rec.id;
    return jsonb_build_object('result', 'integrity_issue');
  end if;
  if upper(coalesce(p_currency, '')) <> 'JPY' or p_amount_total is distinct from v_rec.expected_amount then
    perform public.stripe_log_issue(
      case when upper(coalesce(p_currency, '')) <> 'JPY' then 'currency_mismatch' else 'amount_mismatch' end,
      'critical', v_rec.organization_id, null, v_rec.id, p_event_id, p_session_id,
      'scout credit payment: charged amount/currency differs from the expected value');
    update public.stripe_checkout_records set status = 'needs_review', stripe_payment_intent_id = v_pi,
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id) where id = v_rec.id;
    return jsonb_build_object('result', 'integrity_issue');
  end if;

  insert into public.scout_credit_purchases (
    checkout_record_id, organization_id, scout_credit_package_id, credits,
    price_excl_tax, tax_rate, tax_amount, total_amount, stripe_payment_intent_id, purchased_at
  ) values (v_rec.id, v_rec.organization_id, v_rec.scout_credit_package_id, v_rec.credits,
            v_rec.amount_excl_tax, v_rec.tax_rate, v_rec.tax_amount, v_rec.total_amount, v_pi, v_now);

  insert into public.organization_scout_quotas (organization_id) values (v_rec.organization_id)
  on conflict (organization_id) do nothing;
  update public.organization_scout_quotas
  set additional_credits = additional_credits + v_rec.credits
  where organization_id = v_rec.organization_id;

  update public.stripe_checkout_records
  set status = 'completed', completed_at = v_now, stripe_payment_intent_id = v_pi,
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id)
  where id = v_rec.id;

  return jsonb_build_object('result', 'paid', 'organization_id', v_rec.organization_id, 'credits', v_rec.credits);
end;
$$;

-- 返金・チャージバック等は自動で状態を戻さず、管理者の確認事項として記録する。
create or replace function public.record_stripe_refund_or_dispute(
  p_payment_intent_id text, p_event_id text, p_kind text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_pay public.success_fee_payments;
  v_buy public.scout_credit_purchases;
begin
  select * into v_pay from public.success_fee_payments where stripe_payment_intent_id = p_payment_intent_id;
  if v_pay.id is not null then
    perform public.stripe_log_issue('refund_or_dispute', 'critical', v_pay.organization_id, v_pay.success_fee_id,
      v_pay.checkout_record_id, p_event_id, p_payment_intent_id, 'success fee card payment: ' || coalesce(p_kind, 'refund/dispute'));
    return jsonb_build_object('result', 'recorded');
  end if;
  select * into v_buy from public.scout_credit_purchases where stripe_payment_intent_id = p_payment_intent_id;
  if v_buy.id is not null then
    perform public.stripe_log_issue('refund_or_dispute', 'critical', v_buy.organization_id, null,
      v_buy.checkout_record_id, p_event_id, p_payment_intent_id, 'scout credit purchase: ' || coalesce(p_kind, 'refund/dispute'));
    return jsonb_build_object('result', 'recorded');
  end if;
  return jsonb_build_object('result', 'ignored');
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. platform admin向けRPC
-- ----------------------------------------------------------------------------

create or replace function public.get_admin_stripe_overview()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'organization_id', o.id,
    'organization_name', o.name,
    'contract_status', c.contract_status,
    'contract_monthly_fee', c.monthly_fee,
    'customer_created', a.organization_id is not null,
    'payment_method_available', coalesce(a.default_payment_method_available, false),
    'subscription_payment_state', s.payment_state,
    'subscription_status', s.subscription_status,
    'current_period_end', s.current_period_end,
    'cancel_at_period_end', s.cancel_at_period_end,
    'subscription_amount_excl_tax', s.amount_excl_tax,
    'subscription_total_amount', s.total_amount,
    'subscription_stripe_total_amount', s.stripe_total_amount,
    'last_payment_status', s.last_payment_status,
    'last_payment_at', s.last_payment_at,
    'last_payment_failed_at', s.last_payment_failed_at,
    'open_issue_count', (select count(*) from public.stripe_integrity_issues i
                         where i.organization_id = o.id and i.resolved_at is null),
    'sync_flags', (
      select coalesce(jsonb_agg(flag), '[]'::jsonb) from (
        select 'subscription_missing' as flag
          where c.contract_status = 'active' and coalesce(c.monthly_fee, 0) > 0
            and (s.organization_id is null or s.payment_state = 'cancelled')
        union all
        select 'stripe_amount_mismatch'   -- Stripe上の現在請求額が決済時の税込額と違う
          where s.organization_id is not null and s.payment_state <> 'cancelled'
            and s.stripe_total_amount is distinct from s.total_amount
        union all
        select 'monthly_amount_mismatch'   -- 契約の月額(税抜)とStripe課金snapshot(税抜)が違う。自動変更はしない
          where s.organization_id is not null and s.payment_state <> 'cancelled'
            and s.amount_excl_tax is distinct from c.monthly_fee
        union all
        select 'no_payment_method'
          where s.organization_id is not null and s.payment_state not in ('cancelled')
            and not coalesce(a.default_payment_method_available, false)
        union all
        select 'subscription_without_contract_fee'
          where s.organization_id is not null and s.payment_state <> 'cancelled'
            and coalesce(c.monthly_fee, 0) = 0
      ) f)
  ) order by o.name), '[]'::jsonb) into v_result
  from public.salon_organizations o
  left join public.organization_contract_settings c on c.organization_id = o.id
  left join public.organization_payment_accounts a on a.organization_id = o.id
  left join public.organization_subscriptions s on s.organization_id = o.id;
  return v_result;
end;
$$;

-- 詳細admin画面のみ: Stripe技術IDを含む。
create or replace function public.get_admin_stripe_organization_detail(p_organization_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_a public.organization_payment_accounts;
  v_s public.organization_subscriptions;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select * into v_a from public.organization_payment_accounts where organization_id = p_organization_id;
  select * into v_s from public.organization_subscriptions where organization_id = p_organization_id;
  return jsonb_build_object(
    'organization_id', p_organization_id,
    'stripe_customer_id', v_a.stripe_customer_id,
    'livemode', v_a.livemode,
    'payment_method_available', coalesce(v_a.default_payment_method_available, false),
    'payment_method_checked_at', v_a.payment_method_checked_at,
    'stripe_subscription_id', v_s.stripe_subscription_id,
    'subscription_status', v_s.subscription_status,
    'payment_state', v_s.payment_state,
    'synced_at', v_s.synced_at,
    'recent_checkouts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'record_id', r.id, 'purpose', r.purpose, 'status', r.status,
        'expected_amount', r.expected_amount, 'amount_excl_tax', r.amount_excl_tax,
        'tax_rate', r.tax_rate, 'tax_amount', r.tax_amount, 'success_fee_id', r.success_fee_id,
        'credits', r.credits, 'stripe_checkout_session_id', r.stripe_checkout_session_id,
        'stripe_payment_intent_id', r.stripe_payment_intent_id,
        'created_at', r.created_at, 'completed_at', r.completed_at
      ) order by r.created_at desc), '[]'::jsonb)
      from (select * from public.stripe_checkout_records where organization_id = p_organization_id
            order by created_at desc limit 20) r));
end;
$$;

-- 成功報酬の支払方法（カード/銀行振込）と決済状況。
create or replace function public.get_admin_success_fee_payments()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'fee_id', f.id,
    'organization_id', f.organization_id,
    'organization_name', o.name,
    'invoice_number', f.invoice_number,
    'fee_status', f.fee_status,
    'total_amount', f.total_amount,
    'paid_at', f.paid_at,
    'payment_method', case when f.fee_status <> 'paid' then null
                           when p.id is not null then 'card' else 'bank_transfer' end,
    'card_checkout_status', (
      select r.status from public.stripe_checkout_records r
      where r.success_fee_id = f.id order by r.created_at desc limit 1),
    'card_checkout_at', (
      select r.created_at from public.stripe_checkout_records r
      where r.success_fee_id = f.id order by r.created_at desc limit 1),
    'open_issue_count', (select count(*) from public.stripe_integrity_issues i
                         where i.success_fee_id = f.id and i.resolved_at is null)
  ) order by f.hired_at desc), '[]'::jsonb) into v_result
  from public.hiring_success_fees f
  join public.salon_organizations o on o.id = f.organization_id
  left join public.success_fee_payments p on p.success_fee_id = f.id
  where f.fee_status in ('invoiced', 'paid')
     or exists (select 1 from public.stripe_checkout_records r where r.success_fee_id = f.id);
  return v_result;
end;
$$;

create or replace function public.get_admin_stripe_integrity_issues(p_include_resolved boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'issue_id', i.id, 'issue_type', i.issue_type, 'severity', i.severity,
    'organization_id', i.organization_id, 'organization_name', o.name,
    'success_fee_id', i.success_fee_id, 'detail', i.detail,
    'stripe_event_id', i.stripe_event_id, 'stripe_object_id', i.stripe_object_id,
    'created_at', i.created_at, 'resolved_at', i.resolved_at, 'resolution_note', i.resolution_note
  ) order by i.created_at desc), '[]'::jsonb) into v_result
  from public.stripe_integrity_issues i
  left join public.salon_organizations o on o.id = i.organization_id
  where p_include_resolved or i.resolved_at is null;
  return v_result;
end;
$$;

create or replace function public.admin_resolve_stripe_integrity_issue(p_issue_id uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if v_note is null then raise exception 'resolution note required'; end if;
  if char_length(v_note) > 1000 then raise exception 'note too long'; end if;
  update public.stripe_integrity_issues
  set resolved_at = now(), resolved_by_user_id = auth.uid(), resolution_note = v_note
  where id = p_issue_id and resolved_at is null;
  if not found then raise exception 'issue not found or already resolved'; end if;
  return jsonb_build_object('issue_id', p_issue_id, 'resolved', true);
end;
$$;

create or replace function public.get_admin_scout_credit_packages()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'package_id', p.id, 'label', p.label, 'credits_count', p.credits_count,
    'price_excl_tax', p.price_excl_tax, 'tax_rate', p.tax_rate,
    'tax_amount', public.billing_tax_amount(p.price_excl_tax, p.tax_rate),
    'total_amount', p.price_excl_tax + public.billing_tax_amount(p.price_excl_tax, p.tax_rate),
    'active', p.active, 'updated_at', p.updated_at
  ) order by p.credits_count), '[]'::jsonb) from public.scout_credit_packages p);
end;
$$;

-- 価格は事業判断。コードにも migration にも価格を固定せず、adminが設定する（税抜価格＋税率）。
create or replace function public.admin_upsert_scout_credit_package(
  p_package_id uuid, p_label text, p_credits_count integer, p_price_excl_tax integer,
  p_tax_rate numeric, p_active boolean
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_rate numeric(5,2) := coalesce(p_tax_rate, public.billing_default_tax_rate());
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_label is null or char_length(trim(p_label)) not between 1 and 100 then raise exception 'invalid label'; end if;
  if p_credits_count is null or p_credits_count <= 0 or p_credits_count > 100000 then raise exception 'invalid credits'; end if;
  if p_price_excl_tax is null or p_price_excl_tax <= 0 then raise exception 'invalid price'; end if;
  if v_rate < 0 or v_rate > 100 then raise exception 'invalid tax rate'; end if;

  if p_package_id is null then
    insert into public.scout_credit_packages (label, credits_count, price_excl_tax, tax_rate, active, created_by_user_id, updated_by_user_id)
    values (trim(p_label), p_credits_count, p_price_excl_tax, v_rate, coalesce(p_active, false), auth.uid(), auth.uid())
    returning id into v_id;
  else
    update public.scout_credit_packages
    set label = trim(p_label), credits_count = p_credits_count, price_excl_tax = p_price_excl_tax,
        tax_rate = v_rate, active = coalesce(p_active, false), updated_by_user_id = auth.uid()
    where id = p_package_id returning id into v_id;
    if v_id is null then raise exception 'package not found'; end if;
  end if;
  return jsonb_build_object('package_id', v_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. 関数の実行権限
-- ----------------------------------------------------------------------------
-- 会社向け（authenticated。関数内でcompany_owner/company_adminを検証）
revoke all on function public.get_organization_stripe_customer(uuid) from public, anon;
revoke all on function public.register_stripe_customer(uuid, text, boolean) from public, anon;
revoke all on function public.begin_payment_method_setup(uuid) from public, anon;
revoke all on function public.begin_monthly_subscription_checkout(uuid) from public, anon;
revoke all on function public.begin_success_fee_card_checkout(uuid) from public, anon;
revoke all on function public.begin_scout_credit_checkout(uuid, uuid) from public, anon;
revoke all on function public.attach_stripe_checkout_session(uuid, text) from public, anon;
revoke all on function public.get_company_payment_overview(uuid) from public, anon;
revoke all on function public.get_company_success_fee_payment_info(uuid) from public, anon;
grant execute on function public.get_organization_stripe_customer(uuid) to authenticated;
grant execute on function public.register_stripe_customer(uuid, text, boolean) to authenticated;
grant execute on function public.begin_payment_method_setup(uuid) to authenticated;
grant execute on function public.begin_monthly_subscription_checkout(uuid) to authenticated;
grant execute on function public.begin_success_fee_card_checkout(uuid) to authenticated;
grant execute on function public.begin_scout_credit_checkout(uuid, uuid) to authenticated;
grant execute on function public.attach_stripe_checkout_session(uuid, text) to authenticated;
grant execute on function public.get_company_payment_overview(uuid) to authenticated;
grant execute on function public.get_company_success_fee_payment_info(uuid) to authenticated;

-- webhook適用（service_roleのみ）
revoke all on function public.claim_stripe_webhook_event(text, text, boolean) from public, anon, authenticated;
revoke all on function public.complete_stripe_webhook_event(text, text, text) from public, anon, authenticated;
revoke all on function public.apply_payment_method_setup(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.set_payment_method_state(text, boolean, text, text) from public, anon, authenticated;
revoke all on function public.apply_subscription_checkout_completed(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.apply_stripe_subscription_snapshot(text, text, text, timestamptz, timestamptz, boolean, integer, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.apply_stripe_invoice_result(text, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.mark_stripe_checkout_expired(uuid, text) from public, anon, authenticated;
revoke all on function public.apply_success_fee_card_payment(uuid, text, text, text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.apply_scout_credit_payment(uuid, text, text, text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.record_stripe_refund_or_dispute(text, text, text) from public, anon, authenticated;
grant execute on function public.claim_stripe_webhook_event(text, text, boolean) to service_role;
grant execute on function public.complete_stripe_webhook_event(text, text, text) to service_role;
grant execute on function public.apply_payment_method_setup(uuid, text, text, text, text, text) to service_role;
grant execute on function public.set_payment_method_state(text, boolean, text, text) to service_role;
grant execute on function public.apply_subscription_checkout_completed(uuid, text, text, text, text) to service_role;
grant execute on function public.apply_stripe_subscription_snapshot(text, text, text, timestamptz, timestamptz, boolean, integer, text, timestamptz, text) to service_role;
grant execute on function public.apply_stripe_invoice_result(text, text, text, timestamptz, text) to service_role;
grant execute on function public.mark_stripe_checkout_expired(uuid, text) to service_role;
grant execute on function public.apply_success_fee_card_payment(uuid, text, text, text, integer, text, text, text) to service_role;
grant execute on function public.apply_scout_credit_payment(uuid, text, text, text, integer, text, text, text) to service_role;
grant execute on function public.record_stripe_refund_or_dispute(text, text, text) to service_role;

-- platform admin（authenticated。関数内でis_platform_admin()を検証）
revoke all on function public.get_admin_stripe_overview() from public, anon;
revoke all on function public.get_admin_stripe_organization_detail(uuid) from public, anon;
revoke all on function public.get_admin_success_fee_payments() from public, anon;
revoke all on function public.get_admin_stripe_integrity_issues(boolean) from public, anon;
revoke all on function public.admin_resolve_stripe_integrity_issue(uuid, text) from public, anon;
revoke all on function public.get_admin_scout_credit_packages() from public, anon;
revoke all on function public.admin_upsert_scout_credit_package(uuid, text, integer, integer, numeric, boolean) from public, anon;
grant execute on function public.get_admin_stripe_overview() to authenticated;
grant execute on function public.get_admin_stripe_organization_detail(uuid) to authenticated;
grant execute on function public.get_admin_success_fee_payments() to authenticated;
grant execute on function public.get_admin_stripe_integrity_issues(boolean) to authenticated;
grant execute on function public.admin_resolve_stripe_integrity_issue(uuid, text) to authenticated;
grant execute on function public.get_admin_scout_credit_packages() to authenticated;
grant execute on function public.admin_upsert_scout_credit_package(uuid, text, integer, integer, numeric, boolean) to authenticated;

commit;
