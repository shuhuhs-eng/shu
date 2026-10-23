-- ============================================================================
-- 0045_invoice_billing_foundation.sql
--
-- 請求の土台：請求書番号の採番・支払期限・消費税率のsnapshot・税額のDB計算。
-- PDF生成・Stripe・メール/LINE送信・自動督促・会計ソフト連携・電子署名は作らない。
--
-- ★確定仕様
--   ・請求書番号：全社共通のBeauty Reach側の番号。形式 BR-YYYY-NNNNNN（例 BR-2026-000001）。
--     年（日本時間の請求日の年）ごとに連番をリセット。会社単位・店舗単位の採番にはしない。
--     DB上でunique。採番は年ごとの1行カウンタ(invoice_number_counters)を行ロックして進めるので、
--     同時に請求しても重複せず、請求のtransactionがrollbackすれば番号も戻る（欠番を作らない）。
--     一度発行した番号は変更不可。
--   ・請求日：既存の invoiced_at を正式な請求日として使う（重複カラムは追加しない）。
--   ・支払期限：標準は請求日(日本時間)の翌月末。platform adminは請求確定時に明示指定できる
--     （検証は due_date >= 請求日 のみ。将来の特殊な支払条件を不必要に制限しない）。
--     最終確定した due_date を hiring_success_fees にsnapshotとして保存する。請求後の変更は不可。
--   ・消費税：標準税率10.00%（billing_default_tax_rate() の1か所だけ）。請求確定時に tax_rate を
--     snapshotとして保存し、platform adminは請求確定時に税率を明示指定できる。
--     tax_amount = floor(fee_amount * tax_rate / 100)（1請求単位で切り捨て）、
--     total_amount = fee_amount + tax_amount を、請求に移る瞬間にDB側で計算して確定する。
--     税額の手入力は受け付けない。請求後は tax_rate / tax_amount / total_amount を変更できない。
--   ・請求確定は admin_update_success_fee の action='invoice' の1回のUPDATEで、請求書番号の採番・
--     請求日・支払期限・税率・税額・合計・履歴(event)を原子的に行う（途中で失敗すれば全てrollback）。
--   ・既存の遷移 pending_confirmation → confirmed → invoiced → paid は変えない。
--   ・0045以前の invoiced / paid は請求書番号・支払期限・税率を推測でbackfillしない（nullのまま
--     historical record）。新規の請求（confirmed → invoiced）だけに新ルールを強制する。
--   ・監査：hiring_success_fee_events に invoice_number / due_date / tax_rate を追加（既存eventは
--     nullのまま）。請求確定時のeventにこれらを記録する。
--   ・権限：請求確定・番号発行・期限確定・税率確定は platform admin のみ。会社側は読み取り専用
--     （company_owner / company_admin のみ、既存ルールのまま）。
--
-- ★admin_update_success_fee の互換性
--   引数は (fee_id, action, fee_amount, tax_amount, note) の後ろに due_date, tax_rate を追加。
--   既存の5引数の呼び出しはそのまま動く。ただし p_tax_amount は「受け取るが使わない」
--   （非推奨）。confirm 時の税額・合計は、その時点の標準税率で計算した暫定値で、請求確定時に
--   指定の税率で再計算して確定する。
--
-- ★インボイス制度への将来対応：請求書PDFに必要な適用税率・消費税額・取引年月日(hired_at /
--   invoiced_at)・請求書番号・請求先(会社名)は、この migration で追える。発行事業者名と
--   適格請求書発行事業者登録番号は値が未確定のため、ここでは保存先を作らない（後続で追加）。
--
-- ★既存 0001〜0044 は編集しない。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. 標準税率（唯一の定義場所。請求ごとの税率は hiring_success_fees.tax_rate にsnapshotする）
-- ----------------------------------------------------------------------------
create or replace function public.billing_default_tax_rate()
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$ select 10.00::numeric(5,2); $$;
revoke all on function public.billing_default_tax_rate() from public, anon, authenticated;

-- 税額：1請求単位で切り捨て。
create or replace function public.billing_tax_amount(p_fee_amount integer, p_tax_rate numeric)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$ select floor(p_fee_amount::numeric * p_tax_rate / 100)::integer; $$;
revoke all on function public.billing_tax_amount(integer, numeric) from public, anon, authenticated;

-- 支払期限の標準：請求日(日本時間)の翌月末。
create or replace function public.billing_standard_due_date(p_invoice_date date)
returns date
language sql
immutable
set search_path = public, pg_temp
as $$
  select (date_trunc('month', p_invoice_date) + interval '2 months' - interval '1 day')::date;
$$;
revoke all on function public.billing_standard_due_date(date) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. 請求書番号のカウンタ（年ごとに1行。行ロックで同時発行を直列化する）
-- ----------------------------------------------------------------------------
create table public.invoice_number_counters (
  invoice_year integer primary key check (invoice_year between 2000 and 9999),
  last_value integer not null check (last_value between 1 and 999999),
  updated_at timestamptz not null default now()
);
comment on table public.invoice_number_counters is
  '請求書番号BR-YYYY-NNNNNNの年ごとの連番カウンタ。直接アクセス不可。採番は allocate_invoice_number() のみ。';
alter table public.invoice_number_counters enable row level security;
revoke all on public.invoice_number_counters from public, anon, authenticated;

-- 連番は1ずつ増える以外の更新と、削除を禁止する。
create or replace function public.invoice_number_counters_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'invoice_number_counters rows cannot be deleted';
  end if;
  if new.invoice_year <> old.invoice_year or new.last_value <> old.last_value + 1 then
    raise exception 'invoice number counter can only advance by one';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.invoice_number_counters_guard() from public, anon, authenticated;
create trigger trg_invoice_number_counters_guard
  before update or delete on public.invoice_number_counters
  for each row execute function public.invoice_number_counters_guard();

-- 年内の次の番号を発行する（同じ年の同時呼び出しは、先行transactionのcommit/rollbackまで待つ）。
create or replace function public.allocate_invoice_number(p_year integer)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_value integer;
begin
  insert into public.invoice_number_counters (invoice_year, last_value)
  values (p_year, 1)
  on conflict (invoice_year) do update set last_value = public.invoice_number_counters.last_value + 1
  returning last_value into v_value;
  return 'BR-' || p_year::text || '-' || lpad(v_value::text, 6, '0');
exception when check_violation then
  raise exception 'invoice number sequence exhausted for year %', p_year;
end;
$$;
revoke all on function public.allocate_invoice_number(integer) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. hiring_success_fees：請求書番号・支払期限・税率（すべてnullable。既存行はnullのまま）
-- ----------------------------------------------------------------------------
alter table public.hiring_success_fees
  add column invoice_number text,
  add column due_date date,
  add column tax_rate numeric(5,2),
  add constraint hiring_success_fees_invoice_number_format
    check (invoice_number is null or invoice_number ~ '^BR-[0-9]{4}-[0-9]{6}$'),
  add constraint hiring_success_fees_tax_rate_range
    check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 100)),
  -- 請求書番号・支払期限・税率は「3つとも有る」か「3つとも無い」。
  add constraint hiring_success_fees_invoice_columns_consistency check (
    (invoice_number is null and due_date is null and tax_rate is null)
    or (invoice_number is not null and due_date is not null and tax_rate is not null)
  ),
  -- 請求書番号があるなら請求日(invoiced_at)があり、金額が確定している。
  add constraint hiring_success_fees_invoice_requires_invoiced check (
    invoice_number is null or (invoiced_at is not null and fee_amount is not null)
  );

create unique index hiring_success_fees_invoice_number_unique
  on public.hiring_success_fees(invoice_number) where invoice_number is not null;

comment on column public.hiring_success_fees.invoice_number is
  '請求書番号 BR-YYYY-NNNNNN（全社共通・年ごとに連番）。請求確定時にだけ採番。0045より前の請求済み/入金済みはnull（historical）。';
comment on column public.hiring_success_fees.due_date is
  '支払期限（請求確定時の最終確定値のsnapshot）。標準は請求日の翌月末。';
comment on column public.hiring_success_fees.tax_rate is
  '請求確定時に適用した消費税率(%)のsnapshot。標準10.00。';

-- 請求書番号・支払期限・税率の保護（0039の既存guardは触らず、別トリガーで守る）。
--   ・一度付いたら変更不可。
--   ・付けられるのは confirmed → invoiced の遷移の瞬間だけ（historicalな請求済み行へ後付けしない）。
--   ・confirmed → invoiced は、3つが揃っていなければ失敗する（新規請求だけに新ルールを強制）。
create or replace function public.hiring_success_fees_invoice_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.invoice_number is not null then
    if new.invoice_number is distinct from old.invoice_number
       or new.due_date is distinct from old.due_date
       or new.tax_rate is distinct from old.tax_rate then
      raise exception 'invoice columns cannot be changed';
    end if;
  elsif new.invoice_number is not null
        and not (old.fee_status = 'confirmed' and new.fee_status = 'invoiced') then
    raise exception 'invoice number can only be issued when invoicing';
  end if;

  if old.fee_status = 'confirmed' and new.fee_status = 'invoiced'
     and (new.invoice_number is null or new.due_date is null or new.tax_rate is null) then
    raise exception 'invoice number, due date and tax rate are required to invoice';
  end if;
  return new;
end;
$$;
revoke all on function public.hiring_success_fees_invoice_guard() from public, anon, authenticated;
create trigger trg_hiring_success_fees_invoice_guard
  before update on public.hiring_success_fees
  for each row execute function public.hiring_success_fees_invoice_guard();

-- ----------------------------------------------------------------------------
-- 4. hiring_success_fee_events：請求確定の内容を監査上追えるようにする（既存eventはnullのまま）
-- ----------------------------------------------------------------------------
alter table public.hiring_success_fee_events
  add column invoice_number text,
  add column due_date date,
  add column tax_rate numeric(5,2);

-- ----------------------------------------------------------------------------
-- 5. admin_update_success_fee()：invoice で採番・期限・税率・税額を原子的に確定する
--    旧5引数版は削除して、2引数を追加した版に置き換える（5引数の呼び出しは互換）。
-- ----------------------------------------------------------------------------
drop function public.admin_update_success_fee(uuid, text, integer, integer, text);

create or replace function public.admin_update_success_fee(
  p_fee_id uuid,
  p_action text,
  p_fee_amount integer default null,
  -- p_tax_amount is retained only for backward compatibility.
  -- From migration 0045 onward tax_amount is calculated by the database
  -- from fee_amount and the invoice-time tax_rate.
  -- The caller-provided value is intentionally ignored.
  p_tax_amount integer default null,
  p_note text default null,
  p_due_date date default null,           -- invoice のときだけ指定可（省略=請求日の翌月末）
  -- p_tax_rate: DBの柔軟性のために明示指定できる構造を残す（将来の税制変更・例外用）。
  -- 通常運用の成功報酬は標準税率(billing_default_tax_rate()=10.00)で、省略すればそれが使われる。
  -- 通常の管理UIには税率入力欄を出さない（運用ルールはUI側。DBは制限しない）。
  p_tax_rate numeric default null         -- invoice のときだけ指定可（省略=標準税率）
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_f public.hiring_success_fees;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_to text;
  v_event text;
  v_now timestamptz := now();
  v_invoice_date date;
  v_rate numeric(5,2);
  v_tax integer;
  v_due date;
  v_number text;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_action is null or p_action not in ('confirm', 'invoice', 'paid', 'waive', 'cancel') then
    raise exception 'invalid action';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then raise exception 'note too long'; end if;
  if p_action <> 'invoice' and (p_due_date is not null or p_tax_rate is not null) then
    raise exception 'due date and tax rate can only be specified when invoicing';
  end if;

  select * into v_f from public.hiring_success_fees where id = p_fee_id for update;
  if v_f.id is null then raise exception 'success fee not found'; end if;

  v_to := case p_action
    when 'confirm' then 'confirmed'
    when 'invoice' then 'invoiced'
    when 'paid' then 'paid'
    when 'waive' then 'waived'
    else 'cancelled'
  end;
  if not public.hiring_fee_transition_allowed(v_f.fee_status, v_to) then
    raise exception 'invalid success fee status transition';
  end if;

  if p_action = 'confirm' then
    if p_fee_amount is null or p_fee_amount < 0 then
      raise exception 'fee_amount is required';
    end if;
    -- 税額・合計は暫定値（標準税率）。請求確定時に指定の税率で再計算して確定する。
    v_tax := public.billing_tax_amount(p_fee_amount, public.billing_default_tax_rate());
  elsif p_action in ('waive', 'cancel') and v_note is null then
    raise exception 'reason note is required';
  elsif p_action = 'invoice' then
    if v_f.fee_amount is null then raise exception 'fee_amount is required to invoice'; end if;
    v_rate := coalesce(p_tax_rate, public.billing_default_tax_rate());
    if v_rate < 0 or v_rate > 100 then raise exception 'invalid tax rate'; end if;
    v_tax := public.billing_tax_amount(v_f.fee_amount, v_rate);
    v_invoice_date := (v_now at time zone 'Asia/Tokyo')::date;
    v_due := coalesce(p_due_date, public.billing_standard_due_date(v_invoice_date));
    if v_due < v_invoice_date then
      raise exception 'invalid due date';
    end if;
    v_number := public.allocate_invoice_number(extract(year from v_now at time zone 'Asia/Tokyo')::integer);
  end if;

  v_event := case p_action
    when 'confirm' then case when v_f.fee_status = 'confirmed' then 'amount_updated' else 'confirmed' end
    when 'invoice' then 'invoiced'
    when 'paid' then 'paid'
    when 'waive' then 'waived'
    else 'cancelled'
  end;

  update public.hiring_success_fees
  set fee_status = v_to,
      fee_amount = case when p_action = 'confirm' then p_fee_amount else fee_amount end,
      tax_amount = case when p_action in ('confirm', 'invoice') then v_tax else tax_amount end,
      total_amount = case when p_action = 'confirm' then p_fee_amount + v_tax
                          when p_action = 'invoice' then fee_amount + v_tax
                          else total_amount end,
      confirmed_at = case when p_action = 'confirm' then coalesce(confirmed_at, v_now) else confirmed_at end,
      invoiced_at = case when p_action = 'invoice' then v_now else invoiced_at end,
      invoice_number = case when p_action = 'invoice' then v_number else invoice_number end,
      due_date = case when p_action = 'invoice' then v_due else due_date end,
      tax_rate = case when p_action = 'invoice' then v_rate else tax_rate end,
      paid_at = case when p_action = 'paid' then v_now else paid_at end,
      waived_at = case when p_action = 'waive' then v_now else waived_at end,
      cancelled_at = case when p_action = 'cancel' then v_now else cancelled_at end,
      note = coalesce(v_note, note)
  where id = v_f.id
  returning * into v_f;

  insert into public.hiring_success_fee_events (
    success_fee_id, event_type, from_status, to_status,
    fee_amount, tax_amount, total_amount, actor_user_id, note,
    invoice_number, due_date, tax_rate
  ) values (
    v_f.id, v_event, case when v_event = 'amount_updated' then 'confirmed' else
      (select e.to_status from public.hiring_success_fee_events e
        where e.success_fee_id = v_f.id order by e.created_at desc, e.id desc limit 1) end,
    v_to, v_f.fee_amount, v_f.tax_amount, v_f.total_amount, v_uid, v_note,
    case when p_action = 'invoice' then v_f.invoice_number else null end,
    case when p_action = 'invoice' then v_f.due_date else null end,
    case when p_action = 'invoice' then v_f.tax_rate else null end
  );

  return jsonb_build_object('fee_id', v_f.id, 'fee_status', v_f.fee_status,
                            'fee_amount', v_f.fee_amount, 'tax_amount', v_f.tax_amount,
                            'total_amount', v_f.total_amount,
                            'invoice_number', v_f.invoice_number, 'due_date', v_f.due_date,
                            'tax_rate', v_f.tax_rate);
end;
$$;
revoke all on function public.admin_update_success_fee(uuid, text, integer, integer, text, date, numeric) from public, anon;
grant execute on function public.admin_update_success_fee(uuid, text, integer, integer, text, date, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. 成功報酬read RPC（0043版）を差し替え：invoice_number / due_date / tax_rate を追加で返す。
--    既存の返却項目はすべてそのまま。0045より前の請求済み/入金済みは3項目ともnull。
--    会社側は引き続き内部メモ・操作者idを返さない（読み取り専用・company_owner/company_adminのみ）。
-- ----------------------------------------------------------------------------
create or replace function public.get_admin_success_fees(p_status text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_status is not null and p_status not in
     ('pending_confirmation', 'confirmed', 'invoiced', 'paid', 'waived', 'cancelled') then
    raise exception 'invalid status';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'fee_id', f.id,
    'hiring_process_id', f.hiring_process_id,
    'organization_id', f.organization_id,
    'organization_name', o.name,
    'store_id', f.store_id,
    'store_name', s.store_name,
    'stylist_user_id', f.stylist_user_id,
    'stylist_name', sp.public_name,
    'hired_at', f.hired_at,
    'fee_status', f.fee_status,
    'currency', f.currency,
    'fee_amount', f.fee_amount,
    'tax_amount', f.tax_amount,
    'total_amount', f.total_amount,
    'confirmed_at', f.confirmed_at,
    'invoiced_at', f.invoiced_at,
    'paid_at', f.paid_at,
    'waived_at', f.waived_at,
    'cancelled_at', f.cancelled_at,
    'note', f.note,
    'created_at', f.created_at,
    'updated_at', f.updated_at,
    'contract_success_fee_amount', f.contract_success_fee_amount,
    'contract_success_fee_mode', f.contract_success_fee_mode,
    'contract_status_snapshot', f.contract_status_snapshot,
    'contract_snapshot_at', f.contract_snapshot_at,
    'contract_snapshot_event_id', f.contract_snapshot_event_id,
    'invoice_number', f.invoice_number,
    'due_date', f.due_date,
    'tax_rate', f.tax_rate
  ) order by f.hired_at desc), '[]'::jsonb)
  into v_result
  from public.hiring_success_fees f
  join public.salon_stores s on s.id = f.store_id
  join public.salon_organizations o on o.id = f.organization_id
  left join public.stylist_profiles sp on sp.user_id = f.stylist_user_id
  where p_status is null or f.fee_status = p_status;

  return v_result;
end;
$$;
revoke all on function public.get_admin_success_fees(text) from public, anon;
grant execute on function public.get_admin_success_fees(text) to authenticated;

create or replace function public.get_company_success_fees(p_organization_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'fee_id', f.id,
    'hiring_process_id', f.hiring_process_id,
    'organization_id', f.organization_id,
    'store_id', f.store_id,
    'store_name', s.store_name,
    'stylist_name', sp.public_name,
    'hired_at', f.hired_at,
    'fee_status', f.fee_status,
    'currency', f.currency,
    'fee_amount', f.fee_amount,
    'tax_amount', f.tax_amount,
    'total_amount', f.total_amount,
    'confirmed_at', f.confirmed_at,
    'invoiced_at', f.invoiced_at,
    'paid_at', f.paid_at,
    'waived_at', f.waived_at,
    'cancelled_at', f.cancelled_at,
    'created_at', f.created_at,
    'updated_at', f.updated_at,
    'contract_success_fee_amount', f.contract_success_fee_amount,
    'contract_success_fee_mode', f.contract_success_fee_mode,
    'contract_status_snapshot', f.contract_status_snapshot,
    'contract_snapshot_at', f.contract_snapshot_at,
    'invoice_number', f.invoice_number,
    'due_date', f.due_date,
    'tax_rate', f.tax_rate
  ) order by f.hired_at desc), '[]'::jsonb)
  into v_result
  from public.hiring_success_fees f
  join public.salon_stores s on s.id = f.store_id
  left join public.stylist_profiles sp on sp.user_id = f.stylist_user_id
  where (p_organization_id is null or f.organization_id = p_organization_id)
    and exists (
      select 1 from public.organization_members om
      where om.organization_id = f.organization_id and om.user_id = v_uid
        and om.role in ('company_owner', 'company_admin')
    );

  return v_result;
end;
$$;
revoke all on function public.get_company_success_fees(uuid) from public, anon;
grant execute on function public.get_company_success_fees(uuid) to authenticated;

commit;
