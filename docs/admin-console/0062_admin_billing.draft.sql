-- ============================================================================
-- 0062（レビュー用草案・未適用）: 運営が確定する請求（登録手数料・見学料・採用料）
-- ============================================================================
-- 前提: 0061（見学案件・監査履歴）、0060。既存の hiring_success_fees / stripe_checkout_records / Stripe連携は【変更しない】。
--   新しい請求は新しい表に置き、決済は新しい表 admin_invoice_checkouts で扱う（既存のcheck制約を触らない）。
--   既存の成功報酬との統合は、レビューで決める（README 7章）。
-- 規則（DBで強制）:
--   ・料金は税抜。登録手数料は店舗数で段階（13店舗以上は金額未確定=NULL=個別見積）。月額は当面無料（行を作らない）。
--   ・見学料: 実施確認済みの案件1件につき1行だけ（二重請求防止）。採用料: 案件1件につき1行。見学料は差し引かない。
--   ・登録手数料: 会社ごとに1行だけ。登録後の店舗追加の差額などは「未確定ケース」に積み、請求行は自動で作らない。
--   ・金額が確定していない（NULL）行を含む請求は、確定（finalized）にも決済開始にも進めない。
--   ・請求の作成・確定だけでは課金しない。決済は支払い待ち（payment_pending）の請求に対して、会社の担当者が開始する。
-- v2（確定方針の反映）:
--   ・13店舗以上: 運営が金額を提案(admin_quotes)→会社オーナー/管理者が合意した後にだけ、登録手数料の請求行を作れる（DBのトリガーで強制）。
--   ・料金はDBで固定: 見学料50,000／採用料 スタイリスト550,000・アシスタント450,000／登録手数料は店舗数の段階。違う金額の行は作れない。
--   ・税は標準税率10%（_admin_tax）。変更は1か所。※税率は未確認の前提。レビューで確認。
--   ・見学料は「実施確認済み」の案件、採用料は「採用(hired)」の案件のみ。会社・店舗・案件の整合をDBで強制。請求行の追加・取消は下書きの間だけ。
--   ・支払い・合意できるのは company_owner / company_admin のみ（_admin_org_billing_actor）。採用管理者・エリア担当・店舗の役割・閲覧のみは不可。
-- v3（同時実行・訂正・採用料の条件）:
--   ・請求ロック: 請求行の追加・取消は請求行を「共有ロック」(for share)、確定・取消・決済開始は「排他ロック」(for update)。
--     確定した後に行が変わらない／行の追加と同時の確定が競合しない（同時実行テストで確認）。
--   ・見積の取下げと請求行の作成は、見積行のロック（取下げ=排他、請求行=共有）で直列化。取下げ後に見積を使った行が残らない。
--   ・採用料の条件: 「採用成立(hired)」ではなく、運営が確認した【両者の意向(美容師=interested・サロン=interested)】と
--     【サロンのオファー意思(hiring_decision が offered または hired)】が揃った案件のみ。確定・支払い待ちへ進む時にも再確認する。
--   ・請求済み(下書き以外)の案件の、実施確認・意向・採用判断・店舗・美容師の変更は、トリガーで拒否（訂正として扱う）。
--   ・訂正の扱い（状態別）:
--       下書き     → admin_correct_hire_line（役割の訂正）/ admin_void_line / admin_recalculate_registration_line（取り消して作り直し）
--       確定・支払い待ち（進行中の決済なし）→ 請求を取消（admin_advance_invoice 'cancelled'。行が解放される）→ 新しい下書きで作り直す
--       決済の進行中 → 取消・訂正とも拒否（決済が終わる/失効するまで待つ）
--       支払い済み/返金済み → 変更不可。返金・差額は admin_unresolved_billing_cases（個別対応）
-- v4（レビュー指摘の反映）:
--   ・請求後の通常進行（内定→入社・採用成立）は止めない。請求の根拠を変える変更（実施確認の取消・意向の撤回・辞退/不採用への変更・店舗/美容師/採用進行の付け替え・案件の取消）だけを拒否する。
--   ・1採用の定義: 採用料は「採用進行(store_hiring_processes)1件につき1行」。採用料の行は採用進行に紐づいた案件でのみ作れる（紐づきが無い・見学未実施は個別確認＝admin_flag_billing_case）。
--     複数の見学案件が同じ採用進行を指しても、採用料は1行だけ（部分一意）。「店舗×美容師」だけで永久に禁止はしない（将来の別の採用は別の採用進行）。
--   ・決済: 同じ請求に、進行中(pending/open)・要確認(needs_review)・完了(completed)の決済があれば、新しい決済開始を拒否（部分一意＋RPC）。失効・失敗のみ再開始できる。
--     ★Stripe連携（決済の作成・通知の処理・要確認の解消）は未完成。この草案は「受付の記録」までで、課金は一切しない。要確認の解消手順は連携側で決める。
--   ・再試行（通信切れ・デッドロックでの失敗）で重複しない: 請求作成=リクエストID、行の追加・見積の提案・決済受付・状態遷移・見積の応答は同じ呼び出しの再実行が同じ結果を返す。
--   ・権限: 表・関数はすべて PUBLIC/anon/authenticated/service_role から明示的に外し、公開RPCだけ authenticated に付与（Supabaseの既定権限を模したDBでも検証）。
--   ・税10%（切り捨て）は草案のまま。税務上の適用確認は済んでいない。
begin;

create or replace function public.registration_fee_for_store_count(p_stores integer) returns integer
language sql immutable set search_path = public, pg_temp
as $$
  select case
    when p_stores is null or p_stores < 1 then null
    when p_stores <= 3 then 10000 when p_stores <= 6 then 20000 when p_stores <= 9 then 30000 when p_stores <= 12 then 40000
    else null end   -- 13店舗以上は個別見積（金額未確定）
$$;

create table public.admin_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.salon_organizations(id) on delete restrict,   -- 請求先は会社
  status text not null default 'draft' check (status in ('draft','admin_confirmed','finalized','payment_pending','paid','payment_failed','cancelled','refunded')),
  currency text not null default 'JPY' check (currency = 'JPY'),
  created_by uuid not null references auth.users(id) on delete restrict,
  confirmed_by uuid references auth.users(id) on delete set null, confirmed_at timestamptz,   -- 運営の最終確認
  finalized_at timestamptz, paid_at timestamptz, cancelled_at timestamptz, refunded_at timestamptz,
  request_id uuid,                                                         -- 作成の再試行で二重に作らない（作成者×リクエストID）
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index admin_invoices_one_request on public.admin_invoices (created_by, request_id) where request_id is not null;
-- 13店舗以上の個別見積: スタッフが金額を提案 → 会社の支払い権限者が合意 → 合意後にだけ請求対象
create table public.admin_quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.salon_organizations(id) on delete restrict,
  store_count integer not null check (store_count >= 13),               -- 提案時点の店舗数（変わったら合意は無効）
  amount_excl_tax integer not null check (amount_excl_tax > 0),
  note text check (note is null or char_length(note) <= 500),          -- 会社に表示される補足
  status text not null default 'proposed' check (status in ('proposed','agreed','declined','superseded','withdrawn')),
  proposed_by uuid not null references auth.users(id) on delete restrict,
  proposed_at timestamptz not null default now(),
  agreed_by uuid references auth.users(id) on delete set null, agreed_at timestamptz,
  check ((status = 'agreed') = (agreed_by is not null and agreed_at is not null) or status = 'withdrawn')
);
create unique index admin_quotes_one_active on public.admin_quotes (organization_id) where status in ('proposed','agreed');

create table public.admin_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.admin_invoices(id) on delete restrict,
  organization_id uuid not null references public.salon_organizations(id) on delete restrict,
  store_id uuid references public.salon_stores(id) on delete restrict,                 -- 内訳として対象店舗を追える
  visit_case_id uuid references public.admin_visit_cases(id) on delete restrict,       -- 対象案件
  hiring_process_id uuid references public.store_hiring_processes(id) on delete restrict,   -- 採用料の「1採用」の識別（案件の採用進行から、作成時にDBが設定する）
  fee_kind text not null check (fee_kind in ('registration','visit','hire_stylist','hire_assistant')),
  quote_required boolean not null default false,                                        -- 13店舗以上など個別見積
  amount_excl_tax integer check (amount_excl_tax is null or amount_excl_tax >= 0),
  tax_amount integer check (tax_amount is null or tax_amount >= 0),
  total_amount integer check (total_amount is null or total_amount >= 0),
  quote_id uuid references public.admin_quotes(id) on delete restrict,                  -- 13店舗以上の登録手数料: 合意済みの見積
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  check (fee_kind = 'registration' or visit_case_id is not null),                       -- 見学料・採用料は案件に紐づく
  check (not quote_required or amount_excl_tax is null),
  check ((amount_excl_tax is null) = (tax_amount is null) and (tax_amount is null) = (total_amount is null)),
  check (total_amount is null or total_amount = amount_excl_tax + tax_amount)
);
-- 二重請求防止: 同じ案件×料金区分は有効な行を1つだけ。登録手数料は会社ごとに1つ。
create unique index admin_invoice_lines_one_per_case_kind on public.admin_invoice_lines (visit_case_id, fee_kind) where voided_at is null and visit_case_id is not null;
create unique index admin_invoice_lines_one_registration on public.admin_invoice_lines (organization_id) where fee_kind = 'registration' and voided_at is null;

-- 採用料は1案件に1行だけ（スタイリスト・アシスタントの両方を請求する二重請求を防ぐ。役割の訂正は、行を取り消して作り直す）
create unique index admin_invoice_lines_one_hire_per_case on public.admin_invoice_lines (visit_case_id) where fee_kind in ('hire_stylist','hire_assistant') and voided_at is null and visit_case_id is not null;
-- 1採用 = 採用進行1件。複数の見学案件が同じ採用進行を指しても、採用料は有効な行を1つだけ（将来の別の採用＝別の採用進行は妨げない）
create unique index admin_invoice_lines_one_hire_per_process on public.admin_invoice_lines (hiring_process_id) where fee_kind in ('hire_stylist','hire_assistant') and voided_at is null and hiring_process_id is not null;
create unique index admin_invoice_lines_one_per_quote on public.admin_invoice_lines (quote_id) where voided_at is null and quote_id is not null;

-- 金額・税の規則
create or replace function public._admin_tax(p_amount integer) returns integer
language sql immutable set search_path = public, pg_temp as $$ select (p_amount * 10) / 100 $$;   -- 標準税率10%（切り捨て）

-- 支払い・見積合意ができる人: 会社の company_owner / company_admin のみ
create or replace function public._admin_org_billing_actor(p_org uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select p_user is not null and exists (select 1 from public.organization_members om where om.organization_id = p_org and om.user_id = p_user and om.role in ('company_owner','company_admin')) $$;

create or replace function public._admin_invoice_payable_by(p_invoice_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.admin_invoices i where i.id = p_invoice_id and public._admin_org_billing_actor(i.organization_id, p_user_id)) $$;

-- 見積の状態遷移と整合（金額は変更不可。合意できるのは支払い権限者。店舗数が変わっていたら合意できない）
create or replace function public._admin_quotes_rules() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
declare v_stores integer;
begin
  select count(*) into v_stores from public.salon_stores where organization_id = new.organization_id;
  if tg_op = 'INSERT' then
    if v_stores < 13 then raise exception 'quote not required (fewer than 13 stores)'; end if;
    if new.store_count <> v_stores then raise exception 'store count mismatch'; end if;
    if new.status <> 'proposed' then raise exception 'quote must start as proposed'; end if;
    if not exists (select 1 from public.platform_admins pa where pa.user_id = new.proposed_by) then raise exception 'only admins can propose quotes'; end if;
    return new;
  end if;
  if new.organization_id <> old.organization_id or new.amount_excl_tax <> old.amount_excl_tax or new.store_count <> old.store_count or new.proposed_by <> old.proposed_by then
    raise exception 'quote terms cannot be changed';
  end if;
  if new.status <> old.status and not ((old.status = 'proposed' and new.status in ('agreed','declined','superseded','withdrawn')) or (old.status = 'agreed' and new.status = 'withdrawn')) then
    raise exception 'invalid quote transition';
  end if;
  if new.status = 'agreed' and old.status <> 'agreed' then
    if not public._admin_org_billing_actor(new.organization_id, new.agreed_by) then raise exception 'only company owner or admin can agree'; end if;
    if v_stores <> old.store_count then raise exception 'store count changed; quote needs review'; end if;
  end if;
  return new;
end $$;
create trigger trg_admin_quotes_rules before insert or update on public.admin_quotes for each row execute function public._admin_quotes_rules();

-- 請求行の規則（DBで強制）
create or replace function public._admin_invoice_line_rules() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
declare v_inv record; v_case record; v_stores integer; v_q record; v_expected integer; v_case_org uuid;
begin
  select organization_id, status into v_inv from public.admin_invoices where id = new.invoice_id for share;   -- 確定・取消・決済開始(for update)と直列化
  if not found then raise exception 'invoice not found'; end if;
  if v_inv.organization_id <> new.organization_id then raise exception 'line organization does not match invoice'; end if;
  if tg_op = 'UPDATE' then
    if new.invoice_id <> old.invoice_id or new.organization_id <> old.organization_id or new.store_id is distinct from old.store_id or new.visit_case_id is distinct from old.visit_case_id
       or new.fee_kind <> old.fee_kind or new.hiring_process_id is distinct from old.hiring_process_id or new.amount_excl_tax is distinct from old.amount_excl_tax or new.tax_amount is distinct from old.tax_amount
       or new.total_amount is distinct from old.total_amount or new.quote_id is distinct from old.quote_id or new.quote_required <> old.quote_required then
      raise exception 'invoice line cannot be modified';
    end if;
    if old.voided_at is not null and new.voided_at is null then raise exception 'voided line cannot be restored'; end if;
    -- 取消は下書きの間だけ。請求の取消（cancelled）に伴う行の解放だけは例外
    if new.voided_at is distinct from old.voided_at and v_inv.status not in ('draft','cancelled') then raise exception 'invoice is not editable'; end if;
    return new;
  end if;
  if v_inv.status <> 'draft' then raise exception 'invoice is not editable'; end if;
  if new.store_id is not null and not exists (select 1 from public.salon_stores s where s.id = new.store_id and s.organization_id = new.organization_id) then
    raise exception 'store does not belong to organization';
  end if;
  if new.visit_case_id is not null then
    select c.store_id, c.visit_confirmed_at, c.hiring_decision, c.stylist_intent, c.salon_intent, c.hiring_process_id into v_case from public.admin_visit_cases c where c.id = new.visit_case_id for share;   -- 案件の変更と直列化
    select s.organization_id into v_case_org from public.salon_stores s where s.id = v_case.store_id;
    if v_case_org is distinct from new.organization_id then raise exception 'visit case belongs to another company'; end if;
    if new.store_id is not null and new.store_id <> v_case.store_id then raise exception 'store does not match visit case'; end if;
    if new.fee_kind = 'visit' and v_case.visit_confirmed_at is null then raise exception 'visit is not confirmed'; end if;
    if new.fee_kind in ('hire_stylist','hire_assistant') and not coalesce(v_case.stylist_intent = 'interested' and v_case.salon_intent = 'interested' and v_case.hiring_decision in ('offered','hired'), false) then
      raise exception 'hire is not confirmed';   -- 運営確認の両者の意向 ＋ サロンのオファー意思。「入社・採用成立」は条件にしない
    end if;
    if new.fee_kind in ('hire_stylist','hire_assistant') then
      if v_case.visit_confirmed_at is null then raise exception 'hire without a confirmed visit needs individual review'; end if;   -- 見学未実施の採用は個別確認（admin_flag_billing_case）
      if v_case.hiring_process_id is null then raise exception 'hiring process link required; needs individual review'; end if;       -- 1採用の識別（採用進行）が無い案件は個別確認
      new.hiring_process_id := v_case.hiring_process_id;
    end if;
  end if;
  if new.quote_required and new.fee_kind <> 'registration' then raise exception 'quote applies to registration fee only'; end if;
  if new.amount_excl_tax is not null then
    if new.tax_amount <> public._admin_tax(new.amount_excl_tax) then raise exception 'tax amount does not match tax rule'; end if;
    if new.fee_kind = 'visit' then v_expected := 50000;
    elsif new.fee_kind = 'hire_stylist' then v_expected := 550000;
    elsif new.fee_kind = 'hire_assistant' then v_expected := 450000;
    else
      select count(*) into v_stores from public.salon_stores where organization_id = new.organization_id;
      if v_stores >= 13 then
        select q.* into v_q from public.admin_quotes q where q.id = new.quote_id for share;   -- 見積の取下げ（for update）と直列化
        if not found or v_q.organization_id <> new.organization_id or v_q.status <> 'agreed' then raise exception 'agreed quote required'; end if;
        if v_q.store_count <> v_stores then raise exception 'store count changed; quote needs review'; end if;
        v_expected := v_q.amount_excl_tax;
      else
        if new.quote_id is not null then raise exception 'quote not applicable'; end if;
        v_expected := public.registration_fee_for_store_count(v_stores);
      end if;
    end if;
    if new.amount_excl_tax <> v_expected then raise exception 'amount does not match fee rule'; end if;
  end if;
  return new;
end $$;
create trigger trg_admin_invoice_lines_rules before insert or update on public.admin_invoice_lines for each row execute function public._admin_invoice_line_rules();

-- 金額が未確定の行を含む請求は、確定以降に進めない
create or replace function public._admin_invoice_requires_amounts() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  if new.status in ('finalized','payment_pending','paid') and exists (
    select 1 from public.admin_invoice_lines l where l.invoice_id = new.id and l.voided_at is null and (l.amount_excl_tax is null or l.quote_required)
  ) then raise exception 'invoice has lines without a confirmed amount'; end if;
  if new.status in ('finalized','payment_pending','paid') and not exists (
    select 1 from public.admin_invoice_lines l where l.invoice_id = new.id and l.voided_at is null
  ) then raise exception 'invoice has no lines'; end if;
  if new.status in ('admin_confirmed','finalized','payment_pending','paid') and new.confirmed_by is null then raise exception 'admin confirmation required'; end if;
  -- 下書きの間に案件の状態が変わっていないか、確認・確定・支払い待ちへ進む時に再確認する（見学料=実施確認済み／採用料=両者の意向＋オファー意思）
  if new.status in ('admin_confirmed','finalized','payment_pending') then
    if exists (select 1 from public.admin_invoice_lines l join public.admin_visit_cases c on c.id = l.visit_case_id
                where l.invoice_id = new.id and l.voided_at is null and l.fee_kind = 'visit' and c.visit_confirmed_at is null) then
      raise exception 'visit is not confirmed';
    end if;
    if exists (select 1 from public.admin_invoice_lines l join public.admin_visit_cases c on c.id = l.visit_case_id
                where l.invoice_id = new.id and l.voided_at is null and l.fee_kind in ('hire_stylist','hire_assistant')
                  and not coalesce(c.stylist_intent = 'interested' and c.salon_intent = 'interested' and c.hiring_decision in ('offered','hired'), false)) then
      raise exception 'hire is not confirmed';
    end if;
  end if;
  return new;
end $$;
create trigger trg_admin_invoices_amounts before insert or update of status on public.admin_invoices
  for each row execute function public._admin_invoice_requires_amounts();

-- 決済（カード番号・セキュリティコードは保存しない。Stripe Checkout の識別子と状態のみ）。既存の stripe_checkout_records は触らない
create table public.admin_invoice_checkouts (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.admin_invoices(id) on delete restrict,
  stripe_checkout_session_id text unique,
  expected_amount integer not null check (expected_amount >= 0),     -- 請求の合計と一致させて開始する（クライアントの金額は信用しない）
  status text not null default 'pending' check (status in ('pending','open','completed','expired','failed','needs_review')),
  created_at timestamptz not null default now()
);
-- 同じ請求に、進行中・要確認・完了の決済は1つだけ（二重決済の防止。決済通知が遅れていても、完了済みなら新しい決済は開始できない）。失効・失敗のみ再開始できる
create unique index admin_invoice_checkouts_one_live on public.admin_invoice_checkouts (invoice_id) where status in ('pending','open','needs_review','completed');
create table public.admin_invoice_webhook_events (   -- 決済通知の重複処理防止
  stripe_event_id text primary key check (stripe_event_id ~ '^evt_[A-Za-z0-9_]+$'),
  processed_at timestamptz not null default now()
);

-- 料金が未確定のケースの一覧（個別確認で止める）。勝手に規則を決めて請求行を作らない
create table public.admin_unresolved_billing_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.salon_organizations(id) on delete restrict,
  visit_case_id uuid references public.admin_visit_cases(id) on delete set null,
  reason text not null check (reason in ('visit_cancelled','revisit','offer_withdrawn_refund','store_added_after_registration','stores_13_plus','fee_overlap','hire_role_unknown','existing_contract_transition','hire_without_visit','hire_without_process_link')),
  note text check (note is null or char_length(note) <= 1000),
  resolved_by uuid references auth.users(id) on delete set null, resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- 運営側RPC
create or replace function public.admin_propose_quote(p_organization_id uuid, p_amount_excl_tax integer, p_note text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_stores integer; v_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select count(*) into v_stores from public.salon_stores where organization_id = p_organization_id;
  if exists (select 1 from public.admin_quotes where organization_id = p_organization_id and status = 'agreed') then raise exception 'an agreed quote already exists'; end if;
  -- 再試行（通信切れ後の再送）: 同じ提案がすでに有効なら、それを返す（提案を重ねない）
  select id into v_id from public.admin_quotes where organization_id = p_organization_id and status = 'proposed' and proposed_by = v_uid
     and amount_excl_tax = p_amount_excl_tax and note is not distinct from p_note and store_count = v_stores;
  if found then return v_id; end if;
  update public.admin_quotes set status = 'superseded' where organization_id = p_organization_id and status = 'proposed';
  insert into public.admin_quotes (organization_id, store_count, amount_excl_tax, note, proposed_by) values (p_organization_id, v_stores, p_amount_excl_tax, p_note, v_uid) returning id into v_id;
  insert into public.admin_audit_events (actor_user_id, action, target_type, target_id, organization_id, after_value)
    values (v_uid, 'quote_proposed', 'organization', p_organization_id, p_organization_id, jsonb_build_object('quote_id', v_id, 'amount_excl_tax', p_amount_excl_tax));
  return v_id;
end $$;

create or replace function public.admin_withdraw_quote(p_quote_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  -- 先に見積行を排他ロック。請求行の作成（見積を共有ロック）と直列化され、「確認した後に行が作られる」競合が起きない
  perform 1 from public.admin_quotes where id = p_quote_id and status in ('proposed','agreed') for update;
  if not found then raise exception 'quote not found'; end if;
  if exists (select 1 from public.admin_invoice_lines l where l.quote_id = p_quote_id and l.voided_at is null) then raise exception 'quote is used by an invoice line'; end if;
  update public.admin_quotes set status = 'withdrawn' where id = p_quote_id and status in ('proposed','agreed');
  if not found then raise exception 'quote not found'; end if;
end $$;

create or replace function public.admin_create_invoice(p_organization_id uuid, p_request_id uuid default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid; v_uid uuid := auth.uid(); v_org uuid;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  -- 作成の再試行: 同じ作成者×リクエストIDなら、新しく作らず同じ請求を返す（内容が違う再利用は拒否）
  if p_request_id is not null then
    select id, organization_id into v_id, v_org from public.admin_invoices where created_by = v_uid and request_id = p_request_id;
    if found then
      if v_org <> p_organization_id then raise exception 'request id content mismatch'; end if;
      return v_id;
    end if;
  end if;
  begin
    insert into public.admin_invoices (organization_id, created_by, request_id) values (p_organization_id, v_uid, p_request_id) returning id into v_id;
  exception when unique_violation then   -- 同じリクエストの同時再送
    select id, organization_id into v_id, v_org from public.admin_invoices where created_by = v_uid and request_id = p_request_id;
    if not found then raise; end if;
    if v_org <> p_organization_id then raise exception 'request id content mismatch'; end if;
    return v_id;
  end;
  insert into public.admin_audit_events (actor_user_id, action, target_type, target_id, organization_id) values (v_uid, 'invoice_created', 'invoice', v_id, p_organization_id);
  return v_id;
end $$;

-- 見学料・採用料の行（金額・税は規則どおりにDBが決める。クライアントの金額は受け取らない）
create or replace function public.admin_add_fee_line(p_invoice_id uuid, p_fee_kind text, p_visit_case_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_org uuid; v_store uuid; v_amt integer; v_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_fee_kind not in ('visit','hire_stylist','hire_assistant') then raise exception 'invalid fee kind'; end if;
  select organization_id into v_org from public.admin_invoices where id = p_invoice_id for share;
  if v_org is null then raise exception 'invoice not found'; end if;
  select store_id into v_store from public.admin_visit_cases where id = p_visit_case_id;
  if v_store is null then raise exception 'visit case not found'; end if;
  -- 再試行: 同じ請求・案件・料金区分の有効な行があれば、それを返す（二重に作らない）
  select id into v_id from public.admin_invoice_lines where invoice_id = p_invoice_id and visit_case_id = p_visit_case_id and fee_kind = p_fee_kind and voided_at is null;
  if found then return v_id; end if;
  v_amt := case p_fee_kind when 'visit' then 50000 when 'hire_stylist' then 550000 else 450000 end;
  begin
    insert into public.admin_invoice_lines (invoice_id, organization_id, store_id, visit_case_id, fee_kind, amount_excl_tax, tax_amount, total_amount)
      values (p_invoice_id, v_org, v_store, p_visit_case_id, p_fee_kind, v_amt, public._admin_tax(v_amt), v_amt + public._admin_tax(v_amt)) returning id into v_id;
  exception when unique_violation then   -- 同じ呼び出しの同時再送（先行がcommitした後の再確認）
    select id into v_id from public.admin_invoice_lines where invoice_id = p_invoice_id and visit_case_id = p_visit_case_id and fee_kind = p_fee_kind and voided_at is null;
    if not found then raise; end if;
  end;
  return v_id;
end $$;

create or replace function public.admin_add_registration_line(p_invoice_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_org uuid; v_stores integer; v_amt integer; v_quote uuid; v_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select organization_id into v_org from public.admin_invoices where id = p_invoice_id for share;
  if v_org is null then raise exception 'invoice not found'; end if;
  -- 再試行: この請求に有効な登録手数料の行があれば、それを返す
  select id into v_id from public.admin_invoice_lines where invoice_id = p_invoice_id and fee_kind = 'registration' and voided_at is null;
  if found then return v_id; end if;
  select count(*) into v_stores from public.salon_stores where organization_id = v_org;
  if v_stores >= 13 then
    select id, amount_excl_tax into v_quote, v_amt from public.admin_quotes where organization_id = v_org and status = 'agreed';
    if v_quote is null then raise exception 'agreed quote required'; end if;
  else
    v_amt := public.registration_fee_for_store_count(v_stores);
    if v_amt is null then raise exception 'no stores'; end if;
  end if;
  begin
    insert into public.admin_invoice_lines (invoice_id, organization_id, fee_kind, amount_excl_tax, tax_amount, total_amount, quote_id)
      values (p_invoice_id, v_org, 'registration', v_amt, public._admin_tax(v_amt), v_amt + public._admin_tax(v_amt), v_quote) returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.admin_invoice_lines where invoice_id = p_invoice_id and fee_kind = 'registration' and voided_at is null;
    if not found then raise; end if;
  end;
  return v_id;
end $$;

create or replace function public.admin_void_line(p_line_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  update public.admin_invoice_lines set voided_at = now() where id = p_line_id and voided_at is null;
  if not found then raise exception 'line not found'; end if;
end $$;

-- 状態の進め方: 下書き→運営最終確認→請求確定→支払い待ち。取消は支払い前のみ。支払い完了・失敗・返金は決済通知の処理（アプリ）が行う
create or replace function public.admin_advance_invoice(p_invoice_id uuid, p_to text) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_old text; v_uid uuid := auth.uid();
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select status into v_old from public.admin_invoices where id = p_invoice_id for update;
  if not found then raise exception 'invoice not found'; end if;
  -- 再試行: すでにその状態なら何もしない（監査履歴・行の取消を重ねない）
  if v_old = p_to and p_to in ('admin_confirmed','finalized','payment_pending','cancelled') then return; end if;
  if not ((v_old = 'draft' and p_to = 'admin_confirmed') or (v_old = 'admin_confirmed' and p_to = 'finalized') or (v_old = 'finalized' and p_to = 'payment_pending')
          or (v_old in ('draft','admin_confirmed','finalized','payment_pending','payment_failed') and p_to = 'cancelled')) then
    raise exception 'invalid invoice transition';
  end if;
  if p_to = 'payment_pending' and exists (select 1 from public.admin_invoice_checkouts c where c.invoice_id = p_invoice_id and c.status in ('pending','open','needs_review','completed')) then raise exception 'checkout in progress'; end if;
  -- 決済の進行中・要確認・完了済み（通知が遅れて請求がまだ支払い済みになっていない場合を含む）の請求は取り消せない
  if p_to = 'cancelled' and exists (select 1 from public.admin_invoice_checkouts c where c.invoice_id = p_invoice_id and c.status in ('pending','open','needs_review','completed')) then raise exception 'checkout in progress'; end if;
  update public.admin_invoices set status = p_to,
    confirmed_by = case when p_to = 'admin_confirmed' then v_uid else confirmed_by end, confirmed_at = case when p_to = 'admin_confirmed' then now() else confirmed_at end,
    finalized_at = case when p_to = 'finalized' then now() else finalized_at end, cancelled_at = case when p_to = 'cancelled' then now() else cancelled_at end, updated_at = now()
  where id = p_invoice_id;
  -- 取消すると行を解放する（同じ案件・料金区分・見積を、新しい下書きで作り直せる）。履歴のため削除はしない
  if p_to = 'cancelled' then update public.admin_invoice_lines set voided_at = now() where invoice_id = p_invoice_id and voided_at is null; end if;
  insert into public.admin_audit_events (actor_user_id, action, target_type, target_id, before_value, after_value)
    values (v_uid, 'invoice_status_changed', 'invoice', p_invoice_id, jsonb_build_object('status', v_old), jsonb_build_object('status', p_to));
end $$;

-- 会社側RPC（支払い権限者のみ。権限が無い・存在しない場合は区別せず not found）
create or replace function public.company_list_quotes(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if not public._admin_org_billing_actor(p_organization_id, auth.uid()) then raise exception 'not found'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'store_count', q.store_count, 'amount_excl_tax', q.amount_excl_tax, 'tax_amount', public._admin_tax(q.amount_excl_tax),
      'note', q.note, 'status', q.status, 'proposed_at', q.proposed_at, 'agreed_at', q.agreed_at) order by q.proposed_at desc)
    from public.admin_quotes q where q.organization_id = p_organization_id), '[]'::jsonb);
end $$;

create or replace function public.company_respond_quote(p_quote_id uuid, p_agree boolean) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_org uuid; v_status text;
begin
  if v_uid is null then raise exception 'login required'; end if;
  select organization_id, status into v_org, v_status from public.admin_quotes where id = p_quote_id for update;
  if v_org is null or not public._admin_org_billing_actor(v_org, v_uid) then raise exception 'not found'; end if;
  -- 再試行: 同じ応答がすでに記録されていれば何もしない（監査履歴を重ねない）
  if (p_agree and v_status = 'agreed') or (not p_agree and v_status = 'declined') then return; end if;
  if v_status <> 'proposed' then raise exception 'quote is not open'; end if;
  if p_agree then update public.admin_quotes set status = 'agreed', agreed_by = v_uid, agreed_at = now() where id = p_quote_id;
  else update public.admin_quotes set status = 'declined' where id = p_quote_id; end if;
  insert into public.admin_audit_events (actor_user_id, action, target_type, target_id, organization_id, after_value)
    values (v_uid, case when p_agree then 'quote_agreed' else 'quote_declined' end, 'organization', v_org, v_org, jsonb_build_object('quote_id', p_quote_id));
end $$;

-- 支払える請求の一覧（下書き・運営確認中は見せない。確定以降のみ）
create or replace function public.billing_list_invoices(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if not public._admin_org_billing_actor(p_organization_id, auth.uid()) then raise exception 'not found'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'status', i.status, 'finalized_at', i.finalized_at,
      'total_amount', (select sum(l.total_amount) from public.admin_invoice_lines l where l.invoice_id = i.id and l.voided_at is null),
      'lines', (select jsonb_agg(jsonb_build_object('fee_kind', l.fee_kind, 'store_name', s.store_name, 'amount_excl_tax', l.amount_excl_tax, 'tax_amount', l.tax_amount, 'total_amount', l.total_amount) order by l.created_at)
                from public.admin_invoice_lines l left join public.salon_stores s on s.id = l.store_id where l.invoice_id = i.id and l.voided_at is null)
    ) order by i.created_at desc) from public.admin_invoices i
    where i.organization_id = p_organization_id and i.status in ('finalized','payment_pending','paid','payment_failed','refunded')), '[]'::jsonb);
end $$;

-- 決済の開始の「受付」。課金はここでは起きない（アプリが Stripe Checkout を作る前の確認と記録）。金額はDBの請求から計算する
create or replace function public.billing_begin_checkout(p_invoice_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_status text; v_total integer; v_id uuid; v_ck record;
begin
  if v_uid is null then raise exception 'login required'; end if;
  if not public._admin_invoice_payable_by(p_invoice_id, v_uid) then raise exception 'not found'; end if;
  select status into v_status from public.admin_invoices where id = p_invoice_id for update;   -- 確定・取消と直列化
  if v_status <> 'payment_pending' then raise exception 'invoice is not payable'; end if;
  select sum(total_amount) into v_total from public.admin_invoice_lines where invoice_id = p_invoice_id and voided_at is null;
  if v_total is null or v_total <= 0 then raise exception 'invoice has no payable amount'; end if;
  -- 二重決済の防止: 完了済み・要確認の決済があれば、新しい決済は開始しない（決済通知が遅れている場合も含む）。進行中のものは再試行として同じ受付を返す
  select id, status, expected_amount into v_ck from public.admin_invoice_checkouts where invoice_id = p_invoice_id and status in ('pending','open','needs_review','completed') limit 1;
  if found then
    if v_ck.status = 'completed' then raise exception 'checkout already completed'; end if;
    if v_ck.status = 'needs_review' then raise exception 'checkout needs review'; end if;
    return jsonb_build_object('checkout_id', v_ck.id, 'expected_amount', v_ck.expected_amount, 'existing', true);
  end if;
  begin
    insert into public.admin_invoice_checkouts (invoice_id, expected_amount) values (p_invoice_id, v_total) returning id into v_id;
  exception when unique_violation then   -- 同時再送（先行のcommit後に再確認）
    select id, status, expected_amount into v_ck from public.admin_invoice_checkouts where invoice_id = p_invoice_id and status in ('pending','open','needs_review','completed') limit 1;
    if not found then raise; end if;
    if v_ck.status = 'completed' then raise exception 'checkout already completed'; end if;
    if v_ck.status = 'needs_review' then raise exception 'checkout needs review'; end if;
    return jsonb_build_object('checkout_id', v_ck.id, 'expected_amount', v_ck.expected_amount, 'existing', true);
  end;
  return jsonb_build_object('checkout_id', v_id, 'expected_amount', v_total, 'existing', false);
end $$;

-- 請求済み（下書き・取消以外）の請求行がある案件の、請求の根拠となる項目の変更を拒否（訂正は請求の取消→作り直し）
create or replace function public._admin_visit_case_fee_guard() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
declare v_visit boolean; v_hire boolean;
begin
  if new.status is distinct from old.status or new.visit_confirmed_at is distinct from old.visit_confirmed_at or new.store_id <> old.store_id or new.stylist_user_id <> old.stylist_user_id
     or new.hiring_decision is distinct from old.hiring_decision or new.stylist_intent is distinct from old.stylist_intent or new.salon_intent is distinct from old.salon_intent
     or new.hiring_process_id is distinct from old.hiring_process_id then
    perform 1 from public.admin_visit_cases c where c.id = old.id for update;   -- 請求行の追加（案件の共有ロック）が済むのを待ってから確認する
    -- 請求の確定・取消（請求の排他ロック）の完了も待つ。確認した直後に請求が運営確認へ進む競合を防ぐ
    perform 1 from public.admin_invoices i where i.id in (select l.invoice_id from public.admin_invoice_lines l where l.visit_case_id = old.id and l.voided_at is null) for share;
    select coalesce(bool_or(l.fee_kind = 'visit'), false), coalesce(bool_or(l.fee_kind in ('hire_stylist','hire_assistant')), false) into v_visit, v_hire
      from public.admin_invoice_lines l join public.admin_invoices i on i.id = l.invoice_id
     where l.visit_case_id = old.id and l.voided_at is null and i.status not in ('draft','cancelled');
    if v_visit or v_hire then
      -- 請求の根拠そのものを付け替える変更は拒否
      if new.store_id <> old.store_id or new.stylist_user_id <> old.stylist_user_id or new.hiring_process_id is distinct from old.hiring_process_id then
        raise exception 'case has an invoiced fee; changing store, stylist or hiring process needs a billing correction';
      end if;
      -- 案件の取消（見学料・採用料とも）
      if new.status = 'cancelled' and old.status <> 'cancelled' then raise exception 'case has an invoiced fee; cancelling the case needs a billing correction'; end if;
      -- 実施確認の取消・変更（見学料の根拠。採用料の作成条件にも「見学実施済み」があるため、採用料だけの請求でも保護する）
      if old.visit_confirmed_at is not null and new.visit_confirmed_at is distinct from old.visit_confirmed_at then
        raise exception 'case has an invoiced fee; changing the confirmed visit needs a billing correction';
      end if;
      if old.status = 'visit_confirmed' and new.status is distinct from 'visit_confirmed' then
        raise exception 'case has an invoiced fee; reverting the confirmed visit status needs a billing correction';
      end if;
      -- 採用料: 意向の撤回・辞退/不採用/保留への変更・内定から前の状態への戻しは拒否。内定(offered)→採用成立(hired)の通常の進行は妨げない
      if v_hire then
        if (new.stylist_intent is distinct from old.stylist_intent and new.stylist_intent is distinct from 'interested')
           or (new.salon_intent is distinct from old.salon_intent and new.salon_intent is distinct from 'interested') then
          raise exception 'case has an invoiced fee; withdrawing an intent needs a billing correction';
        end if;
        -- NULL（内定状態の消去）も「変更」として扱う。許可するのは offered/hired への進行だけ（NULLとの比較で素通りしないよう coalesce で明示）
        if new.hiring_decision is distinct from old.hiring_decision
           and not (coalesce(new.hiring_decision in ('offered','hired'), false) and not coalesce(old.hiring_decision = 'hired' and new.hiring_decision = 'offered', false)) then
          raise exception 'case has an invoiced fee; declining or reverting the offer needs a billing correction (cancel the invoice or handle as a refund case)';
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_admin_visit_case_fee_guard before update on public.admin_visit_cases for each row execute function public._admin_visit_case_fee_guard();

-- 訂正（下書きの間だけ）: 採用料の役割（スタイリスト/アシスタント）を取り消して作り直す。状態別の扱いは冒頭の表のとおり
create or replace function public._admin_assert_invoice_correctable(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text;
begin
  select status into v_status from public.admin_invoices where id = p_invoice_id for update;   -- 確定・取消・決済開始と直列化
  if not found then raise exception 'invoice not found'; end if;
  if v_status = 'draft' then return; end if;
  if v_status in ('paid','refunded') then raise exception 'invoice is paid; resolve it as a refund case'; end if;
  if v_status = 'cancelled' then raise exception 'invoice is cancelled'; end if;
  if exists (select 1 from public.admin_invoice_checkouts c where c.invoice_id = p_invoice_id and c.status in ('pending','open','needs_review','completed')) then raise exception 'checkout in progress'; end if;
  raise exception 'invoice is confirmed; cancel it and create a new draft';
end $$;

create or replace function public.admin_correct_hire_line(p_line_id uuid, p_new_fee_kind text) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_line public.admin_invoice_lines; v_amt integer; v_id uuid; v_inv uuid;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_new_fee_kind not in ('hire_stylist','hire_assistant') then raise exception 'invalid fee kind'; end if;
  select invoice_id into v_inv from public.admin_invoice_lines where id = p_line_id;
  if v_inv is null then raise exception 'line not found'; end if;
  perform public._admin_assert_invoice_correctable(v_inv);
  select * into v_line from public.admin_invoice_lines where id = p_line_id;   -- ロック後に読み直す
  if v_line.fee_kind not in ('hire_stylist','hire_assistant') then raise exception 'line not found'; end if;
  if v_line.voided_at is not null then
    -- 再試行: すでにこの訂正で作り直されていれば、その行を返す
    select id into v_id from public.admin_invoice_lines where invoice_id = v_line.invoice_id and visit_case_id = v_line.visit_case_id and fee_kind = p_new_fee_kind and voided_at is null;
    if found then return v_id; end if;
    raise exception 'line not found';
  end if;
  if v_line.fee_kind = p_new_fee_kind then raise exception 'no change'; end if;
  update public.admin_invoice_lines set voided_at = now() where id = p_line_id;
  v_amt := case p_new_fee_kind when 'hire_stylist' then 550000 else 450000 end;
  insert into public.admin_invoice_lines (invoice_id, organization_id, store_id, visit_case_id, fee_kind, amount_excl_tax, tax_amount, total_amount)
    values (v_line.invoice_id, v_line.organization_id, v_line.store_id, v_line.visit_case_id, p_new_fee_kind, v_amt, public._admin_tax(v_amt), v_amt + public._admin_tax(v_amt)) returning id into v_id;
  insert into public.admin_audit_events (actor_user_id, action, target_type, target_id, organization_id, before_value, after_value)
    values (auth.uid(), 'invoice_line_corrected', 'invoice', v_line.invoice_id, v_line.organization_id, jsonb_build_object('fee_kind', v_line.fee_kind), jsonb_build_object('fee_kind', p_new_fee_kind));
  return v_id;
end $$;

-- 個別確認に止める: 見学未実施の採用・採用進行に紐づかない採用など、自動では請求行を作らないケースを一覧に残す（再試行は同じ行を返す）
create or replace function public.admin_flag_billing_case(p_visit_case_id uuid, p_reason text, p_note text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_org uuid; v_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_reason not in ('visit_cancelled','revisit','offer_withdrawn_refund','store_added_after_registration','stores_13_plus','fee_overlap','hire_role_unknown','existing_contract_transition','hire_without_visit','hire_without_process_link') then raise exception 'invalid reason'; end if;
  select s.organization_id into v_org from public.admin_visit_cases c join public.salon_stores s on s.id = c.store_id where c.id = p_visit_case_id;
  if v_org is null then raise exception 'visit case not found'; end if;
  select id into v_id from public.admin_unresolved_billing_cases where visit_case_id = p_visit_case_id and reason = p_reason and resolved_at is null;
  if found then return v_id; end if;
  insert into public.admin_unresolved_billing_cases (organization_id, visit_case_id, reason, note) values (v_org, p_visit_case_id, p_reason, left(p_note, 1000)) returning id into v_id;
  insert into public.admin_audit_events (actor_user_id, action, target_type, target_id, organization_id, after_value)
    values (auth.uid(), 'billing_case_flagged', 'visit_case', p_visit_case_id, v_org, jsonb_build_object('reason', p_reason));
  return v_id;
end $$;

-- 訂正（下書きの間だけ）: 登録手数料を、現在の店舗数・合意済み見積で取り消して作り直す
create or replace function public.admin_recalculate_registration_line(p_line_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_inv uuid; v_kind text; v_voided timestamptz;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select invoice_id into v_inv from public.admin_invoice_lines where id = p_line_id;
  if v_inv is null then raise exception 'line not found'; end if;
  perform public._admin_assert_invoice_correctable(v_inv);
  select fee_kind, voided_at into v_kind, v_voided from public.admin_invoice_lines where id = p_line_id;
  if v_kind <> 'registration' or v_voided is not null then raise exception 'line not found'; end if;
  update public.admin_invoice_lines set voided_at = now() where id = p_line_id;
  return public.admin_add_registration_line(v_inv);
end $$;

alter table public.admin_quotes enable row level security;
alter table public.admin_invoices enable row level security;
alter table public.admin_invoice_lines enable row level security;
alter table public.admin_invoice_checkouts enable row level security;
alter table public.admin_invoice_webhook_events enable row level security;
alter table public.admin_unresolved_billing_cases enable row level security;
-- 権限の整理（既定の権限＝Supabaseの default privileges に依存しない）。
-- 新設6表は、PUBLIC・anon・authenticated・service_role のいずれにも直接の権限を付けない（読み書きは下の SECURITY DEFINER 関数だけ）。
revoke all on public.admin_quotes, public.admin_invoices, public.admin_invoice_lines, public.admin_invoice_checkouts,
  public.admin_invoice_webhook_events, public.admin_unresolved_billing_cases from public, anon, authenticated, service_role;
-- 内部関数: どのロールにも実行権限を付けない
revoke all on function public.registration_fee_for_store_count(integer), public._admin_tax(integer), public._admin_org_billing_actor(uuid, uuid),
  public._admin_invoice_payable_by(uuid, uuid), public._admin_quotes_rules(), public._admin_invoice_line_rules(), public._admin_invoice_requires_amounts(),
  public._admin_visit_case_fee_guard(), public._admin_assert_invoice_correctable(uuid)
  from public, anon, authenticated, service_role;
-- 公開RPC（14本）: authenticated のみ実行可（関数内で管理者／法人権限を再確認）
revoke all on function public.admin_propose_quote(uuid, integer, text), public.admin_withdraw_quote(uuid), public.admin_create_invoice(uuid, uuid),
  public.admin_add_fee_line(uuid, text, uuid), public.admin_add_registration_line(uuid), public.admin_void_line(uuid), public.admin_advance_invoice(uuid, text),
  public.company_list_quotes(uuid), public.company_respond_quote(uuid, boolean), public.billing_list_invoices(uuid), public.billing_begin_checkout(uuid),
  public.admin_correct_hire_line(uuid, text), public.admin_recalculate_registration_line(uuid), public.admin_flag_billing_case(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_propose_quote(uuid, integer, text), public.admin_withdraw_quote(uuid), public.admin_create_invoice(uuid, uuid),
  public.admin_add_fee_line(uuid, text, uuid), public.admin_add_registration_line(uuid), public.admin_void_line(uuid), public.admin_advance_invoice(uuid, text),
  public.company_list_quotes(uuid), public.company_respond_quote(uuid, boolean), public.billing_list_invoices(uuid), public.billing_begin_checkout(uuid),
  public.admin_correct_hire_line(uuid, text), public.admin_recalculate_registration_line(uuid), public.admin_flag_billing_case(uuid, text, text)
  to authenticated;
commit;
