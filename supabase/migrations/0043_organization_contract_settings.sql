-- ============================================================================
-- 0043_organization_contract_settings.sql
--
-- 会社ごとの「年度開始月」「契約条件」「成功報酬ルール」のDB基盤。
--   ・まだ Stripe・自動決済・請求書発行・自動課金・割合(%)方式の成功報酬は実装しない。
--   ・契約statusで既存の採用機能を止めない（まず情報として保持。アクセス制御への接続は後続）。
--   ・organization_scout_quotas（0033）には触れない（将来 契約設定→Scout枠 へ接続できる形のまま）。
--
-- ★既存 0001〜0042 は編集しない。0039 の関数は CREATE OR REPLACE で差し替えるだけ
--   （0039ファイル自体は無変更）。0039の hiring_success_fees_guard は触らず、
--   新しい列を守る別トリガーを追加する。
--
-- ★追加するもの
--   1. salon_organizations.fiscal_year_start_month（1〜12、default 4）。既存会社は 4。
--      変更は運営者のみ（admin_update_organization_contract 経由）。
--   2. organization_contract_settings（会社ごとの現在の契約条件、1会社1行）。
--   3. organization_contract_events（追記専用の契約変更履歴）。
--   4. hiring_success_fees に「採用成立時点の契約条件」のsnapshot列（すべてnullable）。
--   5. hiring_create_success_fee() を差し替え：新規の成功報酬レコード作成時に、
--      契約に成功報酬額があればsnapshotする。
--   6. 0039の成功報酬read RPC(get_admin_success_fees / get_company_success_fees)を差し替え、
--      snapshot列を追加で返す（既存の返却項目は不変）。
--   7. RPC：運営者 get_admin_organization_contracts / get_admin_organization_contract /
--      admin_update_organization_contract、会社側 get_company_contract_settings。
--
-- ★成功報酬snapshotの考え方（重要）
--   ・contract_success_fee_amount = 「契約上の基準額」（採用成立時にコピー。後から契約を
--     変えても動かない）。
--   ・fee_amount / tax_amount / total_amount = 「実際に確定した請求額」（0039のまま、運営者が
--     admin_update_success_fee で確定する）。値引き・特例で基準額と違ってよい。
--   ・契約に金額があっても fee_status は pending_confirmation のまま。自動で confirmed に
--     しない（誤請求防止）。fee_amount も自動では入れない。
--   ・0043より前に作られた成功報酬は snapshot を推測してbackfillしない（すべてnullのまま）。
--   ・snapshotは一度作られたら変更不可（別トリガーで保護）。
--   ・contract_snapshot_event_id は、snapshot時点で有効だった契約条件の履歴(created/activated/
--     updated/suspended/cancelled/reactivated の最新。年度開始月の変更eventは除外)。
--     契約設定は「現在の1行」を更新していく形なので、行のidでは版を特定できないための代替。
--
-- ★税：契約には税率を持たない。0039どおり tax_amount は運営者が明示入力し、DBは自動計算しない。
--
-- ★権限
--   ・契約設定の変更・作成・履歴の閲覧: 運営者(is_platform_admin)のみ。
--   ・契約設定の閲覧(金額・status): 自社の company_owner / company_admin のみ。
--     recruiting_admin / area_manager / store_* には金額を見せない。運営者用の内部メモと
--     変更履歴・操作者idは会社側に返さない。
--   ・年度開始月は金額ではないため、salon_organizations の既存SELECTポリシーで会社の
--     メンバー全員が読める（分析画面が recruiting_admin / area_manager でも使えるように）。
--   ・テーブルは RLS有効・ポリシー無し・anon/authenticatedに権限なし（直接操作不可）。
--   ・契約設定・履歴は物理DELETE不可（過去請求の根拠）。履歴はUPDATE/DELETEとも不可。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. 年度開始月（既存会社は default により 4 で埋まる）
-- ----------------------------------------------------------------------------
alter table public.salon_organizations
  add column fiscal_year_start_month integer not null default 4
  check (fiscal_year_start_month between 1 and 12);

comment on column public.salon_organizations.fiscal_year_start_month is
  '会社の年度の開始月(1〜12)。日本企業向けの初期値は4月。変更は運営者のみ（admin_update_organization_contract経由）。会社側からの直接UPDATEはRLS/権限で不可。';

-- ----------------------------------------------------------------------------
-- 2. organization_contract_settings（会社ごとの現在の契約条件。1会社1行）
--    行が無い会社 = 契約条件が未設定。
-- ----------------------------------------------------------------------------
create table public.organization_contract_settings (
  organization_id uuid primary key references public.salon_organizations(id) on delete restrict,

  contract_status text not null check (contract_status in ('trial', 'active', 'suspended', 'cancelled')),

  -- MVPは固定額のみ。将来 custom / percentage 等へ広げる場合は、この制約を
  -- drop → add で拡張する（今は割合方式は実装しない）。
  success_fee_mode text not null default 'fixed' check (success_fee_mode in ('fixed')),
  -- 採用1名あたりの契約上の基準額(税抜の想定だが税は持たない)。未設定可。
  success_fee_amount integer check (success_fee_amount is null or success_fee_amount >= 0),
  currency text not null default 'JPY' check (currency = 'JPY'),
  -- 将来の月額契約用。MVPでは自動課金に使わない。
  monthly_fee integer check (monthly_fee is null or monthly_fee >= 0),

  contract_started_at date,
  contract_ended_at date,

  -- 運営者用の内部メモ（会社側には返さない）。
  note text check (note is null or char_length(note) <= 1000),

  created_by_user_id uuid,   -- FK無し（履歴識別子）
  updated_by_user_id uuid,   -- FK無し（履歴識別子）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint organization_contract_settings_period check (
    contract_started_at is null or contract_ended_at is null or contract_ended_at >= contract_started_at
  )
);

comment on table public.organization_contract_settings is
  '会社ごとの現在の契約条件（1会社1行）。固定料金表はハードコードしない。契約statusは情報として保持するだけで、既存機能の利用制限には使わない。直接アクセス不可、必ずSECURITY DEFINER RPC経由。物理DELETE不可。変更履歴は organization_contract_events。';
comment on column public.organization_contract_settings.success_fee_amount is
  '採用1名あたりの契約上の基準額(円)。採用成立時に hiring_success_fees.contract_success_fee_amount へsnapshotされる。実際の請求額(fee_amount)は運営者が確定する。';

create trigger trg_organization_contract_settings_updated
  before update on public.organization_contract_settings
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. organization_contract_events（追記専用の監査履歴）
-- ----------------------------------------------------------------------------
create table public.organization_contract_events (
  id uuid primary key default gen_random_uuid(),
  -- 同一トランザクション内でも順序が分かるようにする連番。
  seq bigint generated always as identity,
  organization_id uuid not null references public.salon_organizations(id) on delete restrict,
  event_type text not null check (event_type in (
    'created', 'activated', 'updated', 'suspended', 'cancelled', 'reactivated', 'fiscal_year_updated'
  )),
  -- 変更された項目だけの、変更前/変更後の値（内部メモの本文は入れない）。
  before_values jsonb not null default '{}'::jsonb,
  after_values jsonb not null default '{}'::jsonb,
  actor_user_id uuid,        -- FK無し（履歴識別子）
  note text check (note is null or char_length(note) <= 1000),  -- 変更理由
  created_at timestamptz not null default now()
);
create index organization_contract_events_org_idx
  on public.organization_contract_events(organization_id, seq desc);

comment on table public.organization_contract_events is
  '契約条件・年度開始月の変更履歴（追記専用）。誰が(actor_user_id)・いつ(created_at)・何を(before/after)変更したかを残す。';

-- ----------------------------------------------------------------------------
-- 4. 権限（RLS有効・ポリシー無し・直接操作不可）
-- ----------------------------------------------------------------------------
alter table public.organization_contract_settings enable row level security;
alter table public.organization_contract_events enable row level security;
revoke all on public.organization_contract_settings from public, anon, authenticated;
revoke all on public.organization_contract_events from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. 整合性を守るtrigger
-- ----------------------------------------------------------------------------
create or replace function public.organization_contract_settings_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.organization_id <> old.organization_id or new.created_at <> old.created_at then
    raise exception 'contract setting identity columns cannot be changed';
  end if;
  return new;
end;
$$;
create trigger trg_organization_contract_settings_guard
  before update on public.organization_contract_settings
  for each row execute function public.organization_contract_settings_guard();

create or replace function public.organization_contract_no_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '% rows cannot be deleted', tg_table_name;
end;
$$;
create trigger trg_organization_contract_settings_no_delete
  before delete on public.organization_contract_settings
  for each row execute function public.organization_contract_no_delete();

create or replace function public.organization_contract_events_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'organization_contract_events is append-only';
end;
$$;
create trigger trg_organization_contract_events_append_only
  before update or delete on public.organization_contract_events
  for each row execute function public.organization_contract_events_append_only();

revoke all on function public.organization_contract_settings_guard() from public, anon, authenticated;
revoke all on function public.organization_contract_no_delete() from public, anon, authenticated;
revoke all on function public.organization_contract_events_append_only() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. hiring_success_fees に契約snapshot列（すべてnullable。既存行はnullのまま）
-- ----------------------------------------------------------------------------
alter table public.hiring_success_fees
  add column contract_success_fee_amount integer
    check (contract_success_fee_amount is null or contract_success_fee_amount >= 0),
  add column contract_success_fee_mode text,
  add column contract_status_snapshot text,
  add column contract_snapshot_at timestamptz,
  add column contract_snapshot_event_id uuid
    references public.organization_contract_events(id) on delete restrict,
  -- snapshotは「全部ある」か「全部無い」。
  add constraint hiring_success_fees_contract_snapshot_consistency check (
    (contract_success_fee_amount is null and contract_success_fee_mode is null
       and contract_status_snapshot is null and contract_snapshot_at is null
       and contract_snapshot_event_id is null)
    or
    (contract_success_fee_amount is not null and contract_success_fee_mode is not null
       and contract_status_snapshot is not null and contract_snapshot_at is not null
       and contract_snapshot_event_id is not null)
  );

comment on column public.hiring_success_fees.contract_success_fee_amount is
  '採用成立時点の契約上の基準額(円)のsnapshot。実際の請求額(fee_amount)とは別物。0043より前のレコードはnull（推測でbackfillしない）。';
comment on column public.hiring_success_fees.contract_snapshot_event_id is
  'snapshot時点で有効だった契約履歴(organization_contract_events)のid。';

-- snapshot列は一度作られたら変更不可（0039の既存guardは触らず、別トリガーで守る）。
create or replace function public.hiring_success_fees_contract_snapshot_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.contract_success_fee_amount is distinct from old.contract_success_fee_amount
     or new.contract_success_fee_mode is distinct from old.contract_success_fee_mode
     or new.contract_status_snapshot is distinct from old.contract_status_snapshot
     or new.contract_snapshot_at is distinct from old.contract_snapshot_at
     or new.contract_snapshot_event_id is distinct from old.contract_snapshot_event_id then
    raise exception 'contract snapshot columns cannot be changed';
  end if;
  return new;
end;
$$;
revoke all on function public.hiring_success_fees_contract_snapshot_guard() from public, anon, authenticated;
create trigger trg_hiring_success_fees_contract_snapshot_guard
  before update on public.hiring_success_fees
  for each row execute function public.hiring_success_fees_contract_snapshot_guard();

-- ----------------------------------------------------------------------------
-- 7. 0039の hiring_create_success_fee() を差し替え（トリガー本体は付いたまま）。
--    変更点は「契約に基準額があればsnapshotする」だけ。fee_status は
--    pending_confirmation のまま、fee_amount 等も入れない。失敗は握りつぶさない。
-- ----------------------------------------------------------------------------
create or replace function public.hiring_create_success_fee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_fee_id uuid;
  v_c public.organization_contract_settings;
  v_event_id uuid;
begin
  select organization_id into v_org from public.salon_stores where id = new.store_id;
  if v_org is null then
    raise exception 'store organization not found for success fee';
  end if;

  -- 契約に基準額があるときだけsnapshotする（無ければ全列null）。
  -- 根拠にする履歴は「契約条件」のevent(created/activated/updated/suspended/cancelled/reactivated)
  -- の最新。年度開始月の変更(fiscal_year_updated)は契約条件の根拠ではないので除外する。
  select * into v_c from public.organization_contract_settings where organization_id = v_org;
  if v_c.organization_id is not null and v_c.success_fee_amount is not null then
    select e.id into v_event_id
    from public.organization_contract_events e
    where e.organization_id = v_org
      and e.event_type in ('created', 'activated', 'updated', 'suspended', 'cancelled', 'reactivated')
    order by e.seq desc
    limit 1;
    -- 契約金額があるのに契約履歴が無いのは通常あり得ない（RPC経由でしか作れない）。
    -- nullのsnapshotを黙って作らず、整合性エラーとして採用成立自体を失敗させる。
    if v_event_id is null then
      raise exception 'contract has a success fee amount but no contract history; cannot snapshot (organization %)', v_org;
    end if;
  end if;

  if v_event_id is not null then
    insert into public.hiring_success_fees (
      hiring_process_id, store_id, organization_id, stylist_user_id, hired_at,
      contract_success_fee_amount, contract_success_fee_mode, contract_status_snapshot,
      contract_snapshot_at, contract_snapshot_event_id
    ) values (
      new.id, new.store_id, v_org, new.stylist_user_id, new.hired_at,
      v_c.success_fee_amount, v_c.success_fee_mode, v_c.contract_status,
      now(), v_event_id
    )
    on conflict (hiring_process_id) do nothing
    returning id into v_fee_id;
  else
    insert into public.hiring_success_fees (
      hiring_process_id, store_id, organization_id, stylist_user_id, hired_at
    ) values (
      new.id, new.store_id, v_org, new.stylist_user_id, new.hired_at
    )
    on conflict (hiring_process_id) do nothing
    returning id into v_fee_id;
  end if;

  if v_fee_id is not null then
    insert into public.hiring_success_fee_events (success_fee_id, event_type, to_status, actor_user_id, note)
    values (v_fee_id, 'created', 'pending_confirmation', null, '採用成立により自動作成');
  end if;
  return new;
end;
$$;
revoke all on function public.hiring_create_success_fee() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8. 入力検査の小さな補助関数（RPC内部用。直接は呼べない）
-- ----------------------------------------------------------------------------
create or replace function public.organization_contract_json_int(
  p_value jsonb, p_label text, p_min integer, p_max integer
) returns integer
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_num numeric;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then return null; end if;
  if jsonb_typeof(p_value) <> 'number' then
    raise exception '% must be a number', p_label;
  end if;
  v_num := (p_value #>> '{}')::numeric;
  if v_num <> trunc(v_num) or v_num < p_min or v_num > p_max then
    raise exception '% is out of range', p_label;
  end if;
  return v_num::integer;
end;
$$;
revoke all on function public.organization_contract_json_int(jsonb, text, integer, integer) from public, anon, authenticated;

create or replace function public.organization_contract_json_date(p_value jsonb, p_label text)
returns date
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then return null; end if;
  if jsonb_typeof(p_value) <> 'string' then
    raise exception '% must be a date string', p_label;
  end if;
  return (p_value #>> '{}')::date;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
  raise exception '% is not a valid date', p_label;
end;
$$;
revoke all on function public.organization_contract_json_date(jsonb, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 9. admin_update_organization_contract(): 運営者のみ。契約条件・年度開始月の作成/変更。
--    p_changes は変更したい項目だけを持つjsonb。キーが有る項目だけ変更し、null を指定すると
--    その項目を空にする（キーが無い項目は変更しない）。
--      contract_status / success_fee_amount / monthly_fee / contract_started_at /
--      contract_ended_at / note / fiscal_year_start_month
--    契約が未作成の会社に契約項目を送る場合は contract_status が必須（trialを勝手に作らない）。
--    年度開始月だけの変更では契約行を作らない。変更が無ければ何も書かず changed=false。
--    変更ごとに organization_contract_events へ追記する。
-- ----------------------------------------------------------------------------
create or replace function public.admin_update_organization_contract(
  p_organization_id uuid,
  p_changes jsonb,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_allowed text[] := array['contract_status', 'success_fee_amount', 'monthly_fee',
                            'contract_started_at', 'contract_ended_at', 'note', 'fiscal_year_start_month'];
  v_contract_keys text[] := array['contract_status', 'success_fee_amount', 'monthly_fee',
                                  'contract_started_at', 'contract_ended_at', 'note'];
  v_key text;
  v_has_contract_keys boolean := false;
  v_fy_old integer;
  v_fy_new integer;
  v_fy_changed boolean := false;
  v_s public.organization_contract_settings;
  v_exists boolean;
  v_status text;
  v_amount integer;
  v_monthly integer;
  v_start date;
  v_end date;
  v_note text;
  v_changed boolean := false;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_type text;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_organization_id is null then raise exception 'organization required'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'changes required';
  end if;
  if v_reason is not null and char_length(v_reason) > 1000 then raise exception 'reason too long'; end if;

  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any (v_allowed)) then raise exception 'unknown field: %', v_key; end if;
    if v_key = any (v_contract_keys) then v_has_contract_keys := true; end if;
  end loop;

  -- 同じ会社への同時更新を直列化する。
  select fiscal_year_start_month into v_fy_old
  from public.salon_organizations where id = p_organization_id for update;
  if not found then raise exception 'organization not found'; end if;

  select * into v_s from public.organization_contract_settings
  where organization_id = p_organization_id for update;
  v_exists := found;

  if v_exists then
    v_status := v_s.contract_status; v_amount := v_s.success_fee_amount; v_monthly := v_s.monthly_fee;
    v_start := v_s.contract_started_at; v_end := v_s.contract_ended_at; v_note := v_s.note;
  end if;

  -- ---- 入力の解釈 ----
  if p_changes ? 'contract_status' then
    if jsonb_typeof(p_changes -> 'contract_status') <> 'string'
       or (p_changes ->> 'contract_status') not in ('trial', 'active', 'suspended', 'cancelled') then
      raise exception 'invalid contract_status';
    end if;
    v_status := p_changes ->> 'contract_status';
  end if;
  if p_changes ? 'success_fee_amount' then
    v_amount := public.organization_contract_json_int(p_changes -> 'success_fee_amount', 'success_fee_amount', 0, 2147483647);
  end if;
  if p_changes ? 'monthly_fee' then
    v_monthly := public.organization_contract_json_int(p_changes -> 'monthly_fee', 'monthly_fee', 0, 2147483647);
  end if;
  if p_changes ? 'contract_started_at' then
    v_start := public.organization_contract_json_date(p_changes -> 'contract_started_at', 'contract_started_at');
  end if;
  if p_changes ? 'contract_ended_at' then
    v_end := public.organization_contract_json_date(p_changes -> 'contract_ended_at', 'contract_ended_at');
  end if;
  if p_changes ? 'note' then
    if jsonb_typeof(p_changes -> 'note') = 'null' then
      v_note := null;
    elsif jsonb_typeof(p_changes -> 'note') = 'string' then
      v_note := nullif(trim(p_changes ->> 'note'), '');
      if v_note is not null and char_length(v_note) > 1000 then raise exception 'note too long'; end if;
    else
      raise exception 'note must be a string';
    end if;
  end if;
  v_fy_new := v_fy_old;
  if p_changes ? 'fiscal_year_start_month' then
    v_fy_new := public.organization_contract_json_int(p_changes -> 'fiscal_year_start_month', 'fiscal_year_start_month', 1, 12);
    if v_fy_new is null then raise exception 'fiscal_year_start_month is required'; end if;
  end if;
  if v_start is not null and v_end is not null and v_end < v_start then
    raise exception 'contract_ended_at must not be before contract_started_at';
  end if;

  -- ---- 契約条件の作成/変更 ----
  if v_has_contract_keys then
    if not v_exists then
      if not (p_changes ? 'contract_status') then
        raise exception 'contract_status is required to create a contract';
      end if;
      insert into public.organization_contract_settings (
        organization_id, contract_status, success_fee_amount, monthly_fee,
        contract_started_at, contract_ended_at, note, created_by_user_id, updated_by_user_id
      ) values (
        p_organization_id, v_status, v_amount, v_monthly, v_start, v_end, v_note, v_uid, v_uid
      );
      v_changed := true;
      v_type := 'created';
      v_after := jsonb_strip_nulls(jsonb_build_object(
        'contract_status', v_status, 'success_fee_amount', v_amount, 'monthly_fee', v_monthly,
        'contract_started_at', v_start, 'contract_ended_at', v_end,
        'note_set', case when v_note is not null then true end));
    else
      if v_status is distinct from v_s.contract_status then
        v_before := v_before || jsonb_build_object('contract_status', v_s.contract_status);
        v_after := v_after || jsonb_build_object('contract_status', v_status);
      end if;
      if v_amount is distinct from v_s.success_fee_amount then
        v_before := v_before || jsonb_build_object('success_fee_amount', v_s.success_fee_amount);
        v_after := v_after || jsonb_build_object('success_fee_amount', v_amount);
      end if;
      if v_monthly is distinct from v_s.monthly_fee then
        v_before := v_before || jsonb_build_object('monthly_fee', v_s.monthly_fee);
        v_after := v_after || jsonb_build_object('monthly_fee', v_monthly);
      end if;
      if v_start is distinct from v_s.contract_started_at then
        v_before := v_before || jsonb_build_object('contract_started_at', v_s.contract_started_at);
        v_after := v_after || jsonb_build_object('contract_started_at', v_start);
      end if;
      if v_end is distinct from v_s.contract_ended_at then
        v_before := v_before || jsonb_build_object('contract_ended_at', v_s.contract_ended_at);
        v_after := v_after || jsonb_build_object('contract_ended_at', v_end);
      end if;
      if v_note is distinct from v_s.note then
        v_after := v_after || jsonb_build_object('note_changed', true);
      end if;

      if v_after <> '{}'::jsonb then
        update public.organization_contract_settings
        set contract_status = v_status, success_fee_amount = v_amount, monthly_fee = v_monthly,
            contract_started_at = v_start, contract_ended_at = v_end, note = v_note,
            updated_by_user_id = v_uid
        where organization_id = p_organization_id;
        v_changed := true;
        v_type := case
          when v_status is not distinct from v_s.contract_status then 'updated'
          when v_status = 'suspended' then 'suspended'
          when v_status = 'cancelled' then 'cancelled'
          when v_status = 'active' and v_s.contract_status = 'trial' then 'activated'
          when v_status = 'active' then 'reactivated'
          else 'updated'
        end;
      end if;
    end if;

    if v_changed then
      insert into public.organization_contract_events (
        organization_id, event_type, before_values, after_values, actor_user_id, note
      ) values (p_organization_id, v_type, v_before, v_after, v_uid, v_reason);
    end if;
  end if;

  -- ---- 年度開始月の変更 ----
  if v_fy_new is distinct from v_fy_old then
    update public.salon_organizations set fiscal_year_start_month = v_fy_new where id = p_organization_id;
    v_fy_changed := true;
    insert into public.organization_contract_events (
      organization_id, event_type, before_values, after_values, actor_user_id, note
    ) values (
      p_organization_id, 'fiscal_year_updated',
      jsonb_build_object('fiscal_year_start_month', v_fy_old),
      jsonb_build_object('fiscal_year_start_month', v_fy_new), v_uid, v_reason
    );
  end if;

  return jsonb_build_object(
    'changed', (v_changed or v_fy_changed),
    'organization_id', p_organization_id,
    'fiscal_year_start_month', v_fy_new,
    'contract_status', v_status,
    'success_fee_amount', v_amount,
    'monthly_fee', v_monthly
  );
end;
$$;
revoke all on function public.admin_update_organization_contract(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_update_organization_contract(uuid, jsonb, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 10. get_admin_organization_contracts(): 運営者向けの全社一覧（読み取り専用）。
--     内部メモ・操作者idは返さない。契約が未設定の会社は contract が null。
-- ----------------------------------------------------------------------------
create or replace function public.get_admin_organization_contracts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'organization_id', o.id,
    'organization_name', o.name,
    'fiscal_year_start_month', o.fiscal_year_start_month,
    'contract', case when c.organization_id is null then null else jsonb_build_object(
      'contract_status', c.contract_status,
      'success_fee_mode', c.success_fee_mode,
      'success_fee_amount', c.success_fee_amount,
      'currency', c.currency,
      'monthly_fee', c.monthly_fee,
      'contract_started_at', c.contract_started_at,
      'contract_ended_at', c.contract_ended_at,
      'updated_at', c.updated_at
    ) end
  ) order by o.name, o.id), '[]'::jsonb)
  into v_result
  from public.salon_organizations o
  left join public.organization_contract_settings c on c.organization_id = o.id;

  return v_result;
end;
$$;
revoke all on function public.get_admin_organization_contracts() from public, anon;
grant execute on function public.get_admin_organization_contracts() to authenticated;

-- ----------------------------------------------------------------------------
-- 11. get_admin_organization_contract(p_organization_id): 運営者向けの1社詳細。
--     編集用に内部メモを含む。履歴は新しい順に最大100件。
-- ----------------------------------------------------------------------------
create or replace function public.get_admin_organization_contract(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org public.salon_organizations;
  v_c public.organization_contract_settings;
  v_events jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;

  select * into v_org from public.salon_organizations where id = p_organization_id;
  if v_org.id is null then raise exception 'organization not found'; end if;
  select * into v_c from public.organization_contract_settings where organization_id = p_organization_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'event_type', e.event_type,
    'before_values', e.before_values,
    'after_values', e.after_values,
    'actor_user_id', e.actor_user_id,
    'note', e.note,
    'created_at', e.created_at
  ) order by e.seq desc), '[]'::jsonb)
  into v_events
  from (
    select * from public.organization_contract_events
    where organization_id = p_organization_id
    order by seq desc
    limit 100
  ) e;

  return jsonb_build_object(
    'organization_id', v_org.id,
    'organization_name', v_org.name,
    'fiscal_year_start_month', v_org.fiscal_year_start_month,
    'contract', case when v_c.organization_id is null then null else jsonb_build_object(
      'contract_status', v_c.contract_status,
      'success_fee_mode', v_c.success_fee_mode,
      'success_fee_amount', v_c.success_fee_amount,
      'currency', v_c.currency,
      'monthly_fee', v_c.monthly_fee,
      'contract_started_at', v_c.contract_started_at,
      'contract_ended_at', v_c.contract_ended_at,
      'note', v_c.note,
      'created_at', v_c.created_at,
      'updated_at', v_c.updated_at
    ) end,
    'events', v_events
  );
end;
$$;
revoke all on function public.get_admin_organization_contract(uuid) from public, anon;
grant execute on function public.get_admin_organization_contract(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 12. get_company_contract_settings(): 会社側の閲覧（自社の company_owner / company_admin のみ）。
--     内部メモ・変更履歴・操作者idは返さない。p_organization_id を省略すると、自分が
--     company_owner / company_admin の全会社分を返す。権限の無い会社の指定は拒否。
--     契約が未設定の会社は has_contract=false で契約項目はnull。
-- ----------------------------------------------------------------------------
create or replace function public.get_company_contract_settings(p_organization_id uuid default null)
returns jsonb
language plpgsql
stable
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
    'organization_id', o.id,
    'organization_name', o.name,
    'fiscal_year_start_month', o.fiscal_year_start_month,
    'has_contract', c.organization_id is not null,
    'contract_status', c.contract_status,
    'success_fee_mode', c.success_fee_mode,
    'success_fee_amount', c.success_fee_amount,
    'currency', c.currency,
    'monthly_fee', c.monthly_fee,
    'contract_started_at', c.contract_started_at,
    'contract_ended_at', c.contract_ended_at,
    'updated_at', c.updated_at
  ) order by o.name, o.id), '[]'::jsonb)
  into v_result
  from public.salon_organizations o
  left join public.organization_contract_settings c on c.organization_id = o.id
  where (p_organization_id is null or o.id = p_organization_id)
    and exists (
      select 1 from public.organization_members om
      where om.organization_id = o.id and om.user_id = v_uid
        and om.role in ('company_owner', 'company_admin')
    );

  return v_result;
end;
$$;
revoke all on function public.get_company_contract_settings(uuid) from public, anon;
grant execute on function public.get_company_contract_settings(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 13. 0039の成功報酬read RPCを差し替え：契約snapshot列を追加で返す。
--     既存の返却項目はすべてそのまま（キー名・意味は不変）。snapshotが無い(0043以前の)
--     レコードは4項目ともnull → 画面側で「未記録」と表示できる。backfillはしない。
--     運営者側のみ contract_snapshot_event_id も返す。会社側は内部メモ・操作者idを
--     引き続き返さない。
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
    'contract_snapshot_event_id', f.contract_snapshot_event_id
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
    'contract_snapshot_at', f.contract_snapshot_at
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
