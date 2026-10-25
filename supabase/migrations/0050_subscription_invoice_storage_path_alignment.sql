-- ============================================================================
-- Beauty Reach — 0050_subscription_invoice_storage_path_alignment
--
-- Phase 51-A: 月額請求書の storage_path を「Supabase Storage上の実際のobject key」と一致させる。
--
-- ★背景：0049は storage_path を 'invoices/<組織ID>/<請求書番号>.pdf'（成功報酬と同じ形）に固定していたが、
--   アプリは保存場所を分けるため実キーを 'subscription-invoices/...' に変換して使っていた。
--   これでは監査・復旧・将来の管理ツールが「変換関数」を知らないとファイルを特定できない。
--   → DBの storage_path をそのまま実キーにする。アプリ側の変換関数は廃止する。
--
-- ★変更内容（0049は編集しない。新しいmigrationで置き換える）
--   1. CHECK制約を 'subscription-invoices/<組織ID>/BR-YYYY-NNNNNN.pdf' のみ許可する形に置き換え。
--   2. 発行時の整合性トリガー関数（subscription_invoice_documents_guard）を新パスで検証するよう置き換え。
--   3. 発行状態の計算関数（subscription_invoice_issue_state）が新パスを返すよう置き換え。
--   4. 【既存データ】0049で作られた発行済み行があれば、storage_path の接頭辞だけを
--      'invoices/' → 'subscription-invoices/' へ更新する。アプリ（Phase 50）は最初から実キーを
--      'subscription-invoices/...' に保存しているため、DB側の値を実態に合わせるだけで、Storageのファイルは
--      移動しない（SHA-256・snapshot・番号は不変）。0件ならこの更新は何もしない。
--      この更新のためだけに、immutableトリガーを同一トランザクション内で一時的に無効化する（終了時に必ず再有効化）。
--
-- ★適用順序：このmigrationをSupabaseへ適用してから、変換関数を廃止したアプリをデプロイする
--   （アプリは接頭辞が 'subscription-invoices/' でないpathでは発行を中止するため、先にデプロイしても
--    誤った場所へ保存されることはなく、PDFが「未発行」のまま残るだけ）。
--
-- ★成功報酬の invoice_documents（'invoices/...'）には一切触れない。
-- ============================================================================

begin;

-- 1. CHECK制約（0049のインライン制約の自動名）
alter table public.subscription_invoice_documents
  drop constraint subscription_invoice_documents_storage_path_check;

-- 4. 既存データの接頭辞を実キーに合わせる（immutableトリガーを一時停止）
alter table public.subscription_invoice_documents disable trigger trg_subscription_invoice_documents_guard;
update public.subscription_invoice_documents
set storage_path = 'subscription-invoices/' || substr(storage_path, length('invoices/') + 1)
where storage_path like 'invoices/%';
alter table public.subscription_invoice_documents enable trigger trg_subscription_invoice_documents_guard;

alter table public.subscription_invoice_documents
  add constraint subscription_invoice_documents_storage_path_check
  check (storage_path ~ '^subscription-invoices/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/BR-[0-9]{4}-[0-9]{6}\.pdf$');

-- 2. 整合性トリガー関数
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
  if new.storage_path <> 'subscription-invoices/' || new.organization_id::text || '/' || new.invoice_number || '.pdf' then
    raise exception 'invalid storage path';
  end if;
  return new;
end;
$$;
revoke all on function public.subscription_invoice_documents_guard() from public, anon, authenticated;

-- 3. 発行状態の計算
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
  v_path := 'subscription-invoices/' || p.organization_id::text || '/' || p.invoice_number || '.pdf';

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

commit;
