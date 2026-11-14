# 0065 レビュー資料（草案 v2・未適用・未commit）

**v2の変更**: 見積一覧(admin_list_quotes)と請求対象の案件一覧(admin_list_billable_cases)に `p_limit`（既定50・最大200）・`p_offset` と総件数 `total` を追加。戻り値は `{total, items}` に変更（旧版は配列）。並び順は日時降順→IDで固定し、201件目以降も取得できる。引数が変わったため、権限設定(revoke/grant)・巻き戻しSQL・権限確認スクリプトのシグネチャも更新。アプリ側の呼び出しは、まだ存在しないため変更なし（今後は `{total, items}` 前提で実装する）。

運営と会社が、見積・請求・請求行・請求対象の案件を**読むだけ**の関数8本。料金方式の切替・請求・課金・メール送信は一切しない。本番適用はレビュー後（commit・push・本番適用はレビューまで保留）。

## 1. 権限
| 関数 | 呼べる人 | 拒否時の応答 |
|---|---|---|
| admin_billing_summary / admin_list_quotes / admin_list_invoices / admin_get_invoice / admin_list_billable_cases / admin_list_unresolved_billing_cases（6本） | `is_platform_admin()` が真の運営者のみ（メール文字列では判定しない） | `admin access required` |
| company_billing_overview / company_get_invoice（2本） | その会社の company_owner / company_admin のみ | `not found`（存在・権限不足・他社を区別しない）。未ログインは `login required` |

- 実行権限は authenticated のみ。PUBLIC・anon・service_role には無し。
- 全8本: SECURITY DEFINER・STABLE・`search_path = public, pg_temp` 固定。表・シーケンスは作らない。
- 会社側は下書き・取消済みの請求を見せない（not found）。Stripeの識別子・needs_review・作成者・内部メモは返さない。

## 2. 取得項目（概要）
- **admin_billing_summary**: store_count, registration_fee_excl_tax（13店以上は null）, registration_requires_quote, registration_line, active_quote（店舗数変更の有無つき）, invoices{draft, unpaid, paid, cancelled_or_refunded}, checkouts_needing_review, unresolved_cases
- **admin_list_quotes**(org, limit, offset) → `{total, items}`: 見積の金額・税・合計・補足・提案者・状態・店舗数の変更有無・請求行での使用有無
- **admin_list_invoices**（状態絞込・limit最大200・offset）: 件数total、各請求の状態・行数・金額・has_pending_amount・最新の決済状態
- **admin_get_invoice**: 行（取消行も履歴として残す、店舗名・美容師名つき）、合計、決済の記録（Stripe識別子は運営のみ）、editable、blockers
- **admin_list_billable_cases**(org, limit, offset) → `{total, items}`（1回最大200件。並びは作成日時降順→ID）: visit_fee_state / hire_fee_state（billed, eligible, not_ready, review_visit_missing, review_process_missing, legacy_basis, legacy_fee_exists）、有効な請求行、個別確認の印
- **admin_list_unresolved_billing_cases**: 会社名・店舗名・理由・メモ（既定は未解決のみ。会社絞込・解決済み含むを選べる）
- **company_billing_overview**: open_quotes, unpaid_invoices, unpaid_total_amount, paid_invoices
- **company_get_invoice**: id, status, finalized_at, paid_at, 金額, lines, payment{state: none/in_progress/confirming/completed/failed, can_begin}

## 3. 検証結果（ローカル Postgres 16、0062→0065 適用済みDB）
- `0065_verify.sql`: **74 PASS / 0 FAIL**（権限・境界値・状態別・ページ送り・会社への情報漏えい無し・実際の請求行作成規則との一致・読み取り専用）。実行後ROLLBACK。
- 読み取り専用: 全8本を呼んでも8表（見積・請求・請求行・決済・個別確認・案件・旧成功報酬・監査履歴）のハッシュが不変。読み取り専用トランザクション内でも全8本が動作。
- **ページ送りの完全性（v2で追加）**: 見積350件・請求450件・案件450件・個別確認450件（各組の全件が同一日時）を、ページ幅 200 / 50 / 37 / 1000（→200に制限）/ 1 で最後まで取得し、取得したID列が表の「日時降順→ID」の並びと**完全一致**（欠落・重複なし）、total も一致。offset 200（201件目以降）の取得、範囲外offsetは items 空・total維持、limit 0→1件・負のoffset→0扱いも確認。
  - 検証の有効性: 並びからIDの条件を外した改変版では、見積・請求の同一日時データで **6件が FAIL**（検知できる）ことを確認。
  - 呼び出し側の注意: 次のページの offset は「要求したlimit」ではなく「返ってきた件数」だけ進める（limitは最大200に制限されるため）。
- 性能: 案件300件で案件一覧 約5ms（limit 200）、請求60件で請求一覧 約2ms。
- `0065_privilege_and_rollback_check.sh`（Supabase既定権限を模した環境）の実行結果:
```
PASS 0065の関数は8本
PASS PUBLICへの実行権限なし
PASS authenticated のみ実行可（anon・service_role 不可）
PASS 0065は表・シーケンスを作らない
PASS 取り消し後: 0065の関数が0本
PASS 取り消し後: 0062〜0064の関数は残っている
PASS 取り消し後: 表・シーケンスの数は変わらない(267)
PASS 取り消し後に0065を再適用できる
```
- `0065_rollback.draft.sql`（関数8本のdropのみ）の予行演習: 取消後0本、0062〜0064の関数と表数は不変、再適用も可能。

注意点:
- `legacy_fee_exists` は、新方式の採用進行に旧成功報酬が残った場合の防御用。旧報酬の作成を止めるトリガーがあるため通常は発生しない（切替前の採用進行は legacy_basis が優先）。
- 税10%・切り捨ては草案。税法上の適用は**未確認**。

## 3b. 本番用チェック（結果表が最後に1つだけ出る。一時テーブルは pg_temp 内のみ。何も変更しない）
- `0065_preapply_check.sql`（適用前）: 0062〜0064の表・関数の存在、0065の関数が未作成、platform_admins が1件以上、件数の記録（INFO）。ローカル(0062〜0064適用・0065未適用)で 29 PASS / 1 FAIL / 9 INFO。FAIL 1件は、ローカルのテストDBに platform_admins が0件のため（本番で1件以上あれば PASS になる想定。**本番での結果は未確認**）。
- `0065_postapply_check.sql`（適用後）: 関数8本の存在・SECURITY DEFINER/STABLE/search_path固定・権限（authenticatedのみ）・anon拒否(42501)・運営者以外の拒否・未所属会社は not found・件数の一致（INFO）。ローカルで **21 PASS / 0 FAIL / 9 INFO**（v2の関数で再実行）。0065適用前のDBに流すと FAIL になることも確認済み。
- 適用手順: preapply → 0065 → postapply。FAIL があれば `0065_rollback.draft.sql`。

## 3c. 巻き戻しSQL（0065_rollback.draft.sql）
```sql
-- 0065 の取り消し（ローカル確認用の草案・未適用）。0065 は読み取り専用の関数8本だけを追加するため、関数を削除するだけで元に戻る。
-- 表・データ・0062〜0064 のオブジェクトには一切触れない。
begin;
drop function if exists public.admin_billing_summary(uuid);
drop function if exists public.admin_list_quotes(uuid, integer, integer);
drop function if exists public.admin_list_invoices(uuid, text, integer, integer);
drop function if exists public.admin_get_invoice(uuid);
drop function if exists public.admin_list_billable_cases(uuid, integer, integer);
drop function if exists public.admin_list_unresolved_billing_cases(uuid, boolean, integer, integer);
drop function if exists public.company_billing_overview(uuid);
drop function if exists public.company_get_invoice(uuid);
commit;
```

## 4. SQL本体8本（0065_admin_billing_reads.draft.sql）
```sql
-- 0065（草案 v2）: 見積・請求の【読み取り専用】関数。運営の画面と会社の画面が、見積・請求・請求行・請求対象の案件を読むための関数だけを追加する。
-- 状態：草案。本番適用はレビュー後。適用済みのマイグレーション（0062〜0064）は一切編集しない。0062→0063→0064 の適用後に適用する。
--
-- 背景: 0062の6表は誰にも直接の権限が無い（意図的）。運営は見積・請求・請求行を読む手段が無く、会社側も「確定済みの請求」の一覧しか読めない。
--       このマイグレーションは、その読み取りだけを SECURITY DEFINER の関数として足す。
--
-- 守ること（この草案の約束）:
--   ・読み取り専用。表の作成・列の追加・INSERT/UPDATE/DELETE・トリガー・既存関数の再定義を一切しない。全関数は STABLE（書き込み不可）。
--   ・料金方式の切替・請求の作成・決済の開始・メール送信・課金は一切しない（それらの関数は呼ばない・作らない）。
--   ・運営用6本: 先頭で is_platform_admin() を確認（メールアドレスの文字列では判定しない）。拒否は 'admin access required'。
--   ・会社用2本: 会社の company_owner / company_admin だけ（0062の _admin_org_billing_actor と同じ）。権限が無い・存在しない・下書き中の請求は区別せず 'not found'。
--   ・運営専用の情報（運営の内部メモ・Stripeのセッション識別子・個別確認のメモ・作成者）は、会社用の関数に一切含めない。
--   ・件数の上限を付ける（一覧は1回最大200件。ページ送り用の p_limit / p_offset と総件数 total を、見積・請求・請求対象の案件・個別確認の4本すべてに付ける）。
--   ・権限: 新設の関数はすべて PUBLIC/anon/authenticated/service_role から明示的に外し、公開RPCだけ authenticated に付与（関数内で再確認）。
--   ・税10%（切り捨て）は0062の草案のまま。税務上の適用確認は済んでいない（ここでは計算結果を読み出すだけで、金額規則は変えない）。
begin;

-- ============ 運営用（6本） ============

-- (1) 会社ごとの請求の全体像（画面の見出し用）
create or replace function public.admin_billing_summary(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_stores integer; v_quote record; v_reg record; v jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if not exists (select 1 from public.salon_organizations o where o.id = p_organization_id) then raise exception 'organization not found'; end if;
  select count(*) into v_stores from public.salon_stores s where s.organization_id = p_organization_id;
  select q.id, q.status, q.amount_excl_tax, q.store_count into v_quote from public.admin_quotes q where q.organization_id = p_organization_id and q.status in ('proposed','agreed');
  select l.id as line_id, i.id as invoice_id, i.status as invoice_status into v_reg
    from public.admin_invoice_lines l join public.admin_invoices i on i.id = l.invoice_id
   where l.organization_id = p_organization_id and l.fee_kind = 'registration' and l.voided_at is null;
  v := jsonb_build_object(
    'organization_id', p_organization_id,
    'store_count', v_stores,
    'registration_fee_excl_tax', public.registration_fee_for_store_count(v_stores),   -- 0店舗・13店舗以上は null（13店舗以上は個別見積）
    'registration_requires_quote', v_stores >= 13,
    'registration_line', case when v_reg.line_id is null then null
                              else jsonb_build_object('line_id', v_reg.line_id, 'invoice_id', v_reg.invoice_id, 'invoice_status', v_reg.invoice_status) end,
    'active_quote', case when v_quote.id is null then null
                         else jsonb_build_object('id', v_quote.id, 'status', v_quote.status, 'amount_excl_tax', v_quote.amount_excl_tax,
                                                 'store_count', v_quote.store_count, 'store_count_changed', v_quote.store_count <> v_stores) end,
    'invoices', jsonb_build_object(
      'draft',    (select count(*) from public.admin_invoices i where i.organization_id = p_organization_id and i.status in ('draft','admin_confirmed')),
      'unpaid',   (select count(*) from public.admin_invoices i where i.organization_id = p_organization_id and i.status in ('finalized','payment_pending','payment_failed')),
      'paid',     (select count(*) from public.admin_invoices i where i.organization_id = p_organization_id and i.status = 'paid'),
      'cancelled_or_refunded', (select count(*) from public.admin_invoices i where i.organization_id = p_organization_id and i.status in ('cancelled','refunded'))),
    'checkouts_needing_review', (select count(*) from public.admin_invoice_checkouts c join public.admin_invoices i on i.id = c.invoice_id
                                  where i.organization_id = p_organization_id and c.status = 'needs_review'),
    'unresolved_cases', (select count(*) from public.admin_unresolved_billing_cases u where u.organization_id = p_organization_id and u.resolved_at is null));
  return v;
end $$;

-- (2) 見積の一覧（新しい順。並びは「提案日時 降順 → ID」で固定。total＝全件数、p_limit は最大200、p_offset で201件目以降も取得できる）
create or replace function public.admin_list_quotes(p_organization_id uuid, p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_stores integer; v_lim integer := greatest(1, least(coalesce(p_limit, 50), 200)); v_off integer := greatest(0, coalesce(p_offset, 0)); v_total integer;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if not exists (select 1 from public.salon_organizations o where o.id = p_organization_id) then raise exception 'organization not found'; end if;
  select count(*) into v_stores from public.salon_stores s where s.organization_id = p_organization_id;
  select count(*) into v_total from public.admin_quotes q where q.organization_id = p_organization_id;
  return jsonb_build_object('total', v_total, 'items', coalesce((select jsonb_agg(x.j order by x.proposed_at desc, x.id) from (
    select q.proposed_at, q.id, jsonb_build_object(
      'id', q.id, 'status', q.status, 'store_count', q.store_count, 'current_store_count', v_stores,
      'store_count_changed', q.status in ('proposed','agreed') and q.store_count <> v_stores,   -- 変わっていたら合意は無効（請求行にできない）
      'amount_excl_tax', q.amount_excl_tax, 'tax_amount', public._admin_tax(q.amount_excl_tax), 'total_amount', q.amount_excl_tax + public._admin_tax(q.amount_excl_tax),
      'note', q.note, 'proposed_by', q.proposed_by, 'proposed_at', q.proposed_at, 'agreed_by', q.agreed_by, 'agreed_at', q.agreed_at,
      'used_by_active_line', exists (select 1 from public.admin_invoice_lines l where l.quote_id = q.id and l.voided_at is null)) as j
      from public.admin_quotes q where q.organization_id = p_organization_id order by q.proposed_at desc, q.id limit v_lim offset v_off) x), '[]'::jsonb));
end $$;

-- (3) 請求の一覧（会社ごと。状態で絞り込み可。金額は「取り消されていない行」の合計）
create or replace function public.admin_list_invoices(p_organization_id uuid, p_status text default null, p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_lim integer := greatest(1, least(coalesce(p_limit, 50), 200)); v_off integer := greatest(0, coalesce(p_offset, 0)); v_total integer;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if not exists (select 1 from public.salon_organizations o where o.id = p_organization_id) then raise exception 'organization not found'; end if;
  if p_status is not null and p_status not in ('draft','admin_confirmed','finalized','payment_pending','paid','payment_failed','cancelled','refunded') then raise exception 'invalid status'; end if;
  select count(*) into v_total from public.admin_invoices i where i.organization_id = p_organization_id and (p_status is null or i.status = p_status);
  return jsonb_build_object('total', v_total, 'items', coalesce((select jsonb_agg(x.j order by x.created_at desc, x.id) from (
    select i.created_at, i.id, jsonb_build_object(
      'id', i.id, 'status', i.status, 'created_by', i.created_by, 'created_at', i.created_at,
      'confirmed_by', i.confirmed_by, 'confirmed_at', i.confirmed_at, 'finalized_at', i.finalized_at, 'paid_at', i.paid_at, 'cancelled_at', i.cancelled_at, 'refunded_at', i.refunded_at,
      'line_count', (select count(*) from public.admin_invoice_lines l where l.invoice_id = i.id and l.voided_at is null),
      'amount_excl_tax', (select sum(l.amount_excl_tax) from public.admin_invoice_lines l where l.invoice_id = i.id and l.voided_at is null),
      'tax_amount', (select sum(l.tax_amount) from public.admin_invoice_lines l where l.invoice_id = i.id and l.voided_at is null),
      'total_amount', (select sum(l.total_amount) from public.admin_invoice_lines l where l.invoice_id = i.id and l.voided_at is null),
      'has_pending_amount', exists (select 1 from public.admin_invoice_lines l where l.invoice_id = i.id and l.voided_at is null and l.total_amount is null),
      'latest_checkout_status', (select c.status from public.admin_invoice_checkouts c where c.invoice_id = i.id order by c.created_at desc, c.id limit 1)) as j
      from public.admin_invoices i where i.organization_id = p_organization_id and (p_status is null or i.status = p_status)
      order by i.created_at desc, i.id limit v_lim offset v_off) x), '[]'::jsonb));
end $$;

-- (4) 請求1件の詳細（行は取り消し済みも含め、取消の印を付けて返す。決済の記録＝Stripeのセッション識別子は運営だけ）
create or replace function public.admin_get_invoice(p_invoice_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_inv record; v_blockers jsonb := '[]'::jsonb; v_active integer; v_pending boolean; v_review boolean;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select i.* into v_inv from public.admin_invoices i where i.id = p_invoice_id;
  if not found then raise exception 'invoice not found'; end if;
  select count(*), coalesce(bool_or(l.total_amount is null), false) into v_active, v_pending from public.admin_invoice_lines l where l.invoice_id = p_invoice_id and l.voided_at is null;
  select exists (select 1 from public.admin_invoice_checkouts c where c.invoice_id = p_invoice_id and c.status = 'needs_review') into v_review;
  if v_active = 0 then v_blockers := v_blockers || to_jsonb('no_active_lines'::text); end if;
  if v_pending then v_blockers := v_blockers || to_jsonb('amount_pending'::text); end if;
  if v_review then v_blockers := v_blockers || to_jsonb('checkout_needs_review'::text); end if;
  return jsonb_build_object(
    'id', v_inv.id, 'organization_id', v_inv.organization_id, 'organization_name', (select o.name from public.salon_organizations o where o.id = v_inv.organization_id),
    'status', v_inv.status, 'editable', v_inv.status = 'draft', 'currency', v_inv.currency,
    'created_by', v_inv.created_by, 'created_at', v_inv.created_at, 'confirmed_by', v_inv.confirmed_by, 'confirmed_at', v_inv.confirmed_at,
    'finalized_at', v_inv.finalized_at, 'paid_at', v_inv.paid_at, 'cancelled_at', v_inv.cancelled_at, 'refunded_at', v_inv.refunded_at,
    'totals', jsonb_build_object(
      'amount_excl_tax', (select sum(l.amount_excl_tax) from public.admin_invoice_lines l where l.invoice_id = p_invoice_id and l.voided_at is null),
      'tax_amount', (select sum(l.tax_amount) from public.admin_invoice_lines l where l.invoice_id = p_invoice_id and l.voided_at is null),
      'total_amount', (select sum(l.total_amount) from public.admin_invoice_lines l where l.invoice_id = p_invoice_id and l.voided_at is null)),
    'blockers', v_blockers,   -- 空なら確定へ進める状態の目安（最終判断はDBの関数）
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'fee_kind', l.fee_kind, 'store_id', l.store_id, 'store_name', s.store_name, 'visit_case_id', l.visit_case_id, 'hiring_process_id', l.hiring_process_id,
        'stylist_user_id', c.stylist_user_id, 'stylist_name', nullif(u.raw_user_meta_data->>'display_name', ''),
        'quote_id', l.quote_id, 'quote_required', l.quote_required,
        'amount_excl_tax', l.amount_excl_tax, 'tax_amount', l.tax_amount, 'total_amount', l.total_amount,
        'voided', l.voided_at is not null, 'voided_at', l.voided_at, 'created_at', l.created_at) order by l.created_at, l.id)
        from public.admin_invoice_lines l
        left join public.salon_stores s on s.id = l.store_id
        left join public.admin_visit_cases c on c.id = l.visit_case_id
        left join auth.users u on u.id = c.stylist_user_id
       where l.invoice_id = p_invoice_id), '[]'::jsonb),
    'checkouts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'status', c.status, 'expected_amount', c.expected_amount, 'stripe_checkout_session_id', c.stripe_checkout_session_id, 'created_at', c.created_at) order by c.created_at, c.id)
        from public.admin_invoice_checkouts c where c.invoice_id = p_invoice_id), '[]'::jsonb));
end $$;

-- (5) 請求対象にできる見学案件の一覧（会社ごと。並びは「作成日時 降順 → ID」で固定。total＝全件数、p_limit は最大200、p_offset で201件目以降も取得できる）。料金の規則は0062・0064のDBの規則と同じ条件で「いま請求行にできるか」を返す（作成時の最終判断は常にDB側）
--     visit_fee_state: billed / eligible / not_ready
--     hire_fee_state : billed / eligible / not_ready / review_visit_missing / review_process_missing / legacy_basis / legacy_fee_exists
create or replace function public.admin_list_billable_cases(p_organization_id uuid, p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_lim integer := greatest(1, least(coalesce(p_limit, 50), 200)); v_off integer := greatest(0, coalesce(p_offset, 0)); v_total integer;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if not exists (select 1 from public.salon_organizations o where o.id = p_organization_id) then raise exception 'organization not found'; end if;
  select count(*) into v_total from public.admin_visit_cases c join public.salon_stores s on s.id = c.store_id where s.organization_id = p_organization_id;
  return jsonb_build_object('total', v_total, 'items', coalesce((select jsonb_agg(x.j order by x.created_at desc, x.id) from (
    select c.created_at, c.id, jsonb_build_object(
      'id', c.id, 'store_id', c.store_id, 'store_name', s.store_name, 'stylist_user_id', c.stylist_user_id, 'stylist_name', nullif(u.raw_user_meta_data->>'display_name', ''),
      'status', c.status, 'visit_confirmed_at', c.visit_confirmed_at, 'stylist_intent', c.stylist_intent, 'salon_intent', c.salon_intent,
      'hiring_decision', c.hiring_decision, 'hiring_process_id', c.hiring_process_id, 'created_at', c.created_at,
      'active_lines', coalesce((select jsonb_agg(jsonb_build_object('line_id', l.id, 'fee_kind', l.fee_kind, 'invoice_id', l.invoice_id, 'invoice_status', i.status) order by l.created_at, l.id)
                                  from public.admin_invoice_lines l join public.admin_invoices i on i.id = l.invoice_id
                                 where l.voided_at is null and (l.visit_case_id = c.id or (c.hiring_process_id is not null and l.hiring_process_id = c.hiring_process_id))), '[]'::jsonb),
      'visit_fee_state', case
          when exists (select 1 from public.admin_invoice_lines l where l.visit_case_id = c.id and l.fee_kind = 'visit' and l.voided_at is null) then 'billed'
          when c.visit_confirmed_at is not null then 'eligible'
          else 'not_ready' end,
      'hire_fee_state', case
          when exists (select 1 from public.admin_invoice_lines l where l.fee_kind in ('hire_stylist','hire_assistant') and l.voided_at is null
                          and (l.visit_case_id = c.id or (c.hiring_process_id is not null and l.hiring_process_id = c.hiring_process_id))) then 'billed'
          when not coalesce(c.stylist_intent = 'interested' and c.salon_intent = 'interested' and c.hiring_decision in ('offered','hired'), false) then 'not_ready'
          when c.visit_confirmed_at is null then 'review_visit_missing'          -- 見学未実施の採用は個別確認（admin_flag_billing_case）
          when c.hiring_process_id is null then 'review_process_missing'        -- 採用進行との対応が無い案件は個別確認
          when not public._billing_regime_active(p_organization_id) or public._hiring_process_basis(c.hiring_process_id) <> 'new' then 'legacy_basis'   -- 旧方式の対象（新方式の請求行にはできない）
          when exists (select 1 from public.hiring_success_fees f where f.hiring_process_id = c.hiring_process_id and f.fee_status not in ('cancelled','waived')) then 'legacy_fee_exists'
          else 'eligible' end,
      'open_review_flag', exists (select 1 from public.admin_unresolved_billing_cases uc where uc.visit_case_id = c.id and uc.resolved_at is null)) as j
      from public.admin_visit_cases c
      join public.salon_stores s on s.id = c.store_id
      left join auth.users u on u.id = c.stylist_user_id
     where s.organization_id = p_organization_id
     order by c.created_at desc, c.id limit v_lim offset v_off) x), '[]'::jsonb));
end $$;

-- (6) 個別確認の一覧（料金が未確定で止めているケース）。会社を指定しなければ全社（運営の確認用）
create or replace function public.admin_list_unresolved_billing_cases(p_organization_id uuid default null, p_include_resolved boolean default false, p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_lim integer := greatest(1, least(coalesce(p_limit, 50), 200)); v_off integer := greatest(0, coalesce(p_offset, 0)); v_total integer;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select count(*) into v_total from public.admin_unresolved_billing_cases u
   where (p_organization_id is null or u.organization_id = p_organization_id) and (coalesce(p_include_resolved, false) or u.resolved_at is null);
  return jsonb_build_object('total', v_total, 'items', coalesce((select jsonb_agg(x.j order by x.created_at desc, x.id) from (
    select u.created_at, u.id, jsonb_build_object(
      'id', u.id, 'organization_id', u.organization_id, 'organization_name', o.name, 'visit_case_id', u.visit_case_id, 'store_name', s.store_name,
      'reason', u.reason, 'note', u.note, 'created_at', u.created_at, 'resolved_by', u.resolved_by, 'resolved_at', u.resolved_at) as j
      from public.admin_unresolved_billing_cases u
      join public.salon_organizations o on o.id = u.organization_id
      left join public.admin_visit_cases c on c.id = u.visit_case_id
      left join public.salon_stores s on s.id = c.store_id
     where (p_organization_id is null or u.organization_id = p_organization_id) and (coalesce(p_include_resolved, false) or u.resolved_at is null)
     order by u.created_at desc, u.id limit v_lim offset v_off) x), '[]'::jsonb));
end $$;

-- ============ 会社用（2本。会社の company_owner / company_admin のみ） ============

-- (7) 請求の状況（会社の画面の見出し用）。下書き・運営確認中の請求は数えない
create or replace function public.company_billing_overview(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if not public._admin_org_billing_actor(p_organization_id, auth.uid()) then raise exception 'not found'; end if;
  return jsonb_build_object(
    'open_quotes', (select count(*) from public.admin_quotes q where q.organization_id = p_organization_id and q.status = 'proposed'),
    'unpaid_invoices', (select count(*) from public.admin_invoices i where i.organization_id = p_organization_id and i.status in ('finalized','payment_pending','payment_failed')),
    'unpaid_total_amount', (select sum(l.total_amount) from public.admin_invoice_lines l join public.admin_invoices i on i.id = l.invoice_id
                             where i.organization_id = p_organization_id and i.status in ('finalized','payment_pending','payment_failed') and l.voided_at is null),
    'paid_invoices', (select count(*) from public.admin_invoices i where i.organization_id = p_organization_id and i.status = 'paid'));
end $$;

-- (8) 確定済みの請求1件の状況（行・金額・支払いの状態）。会社には Stripe の識別子・「要確認」の内部状態・作成者を返さない
--     payment.state: none（支払い前）/ in_progress（決済の途中）/ confirming（運営が確認中）/ completed / failed
--     payment.can_begin: 「支払いを始められる請求か」の目安。実際の開始（billing_begin_checkout）は別の関数で、この関数は支払いを始めない
create or replace function public.company_get_invoice(p_invoice_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_inv record; v_ck record; v_total integer; v_state text;
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  select i.id, i.organization_id, i.status, i.finalized_at, i.paid_at into v_inv from public.admin_invoices i where i.id = p_invoice_id;
  if not found or not public._admin_org_billing_actor(v_inv.organization_id, auth.uid())
     or v_inv.status not in ('finalized','payment_pending','paid','payment_failed','refunded') then raise exception 'not found'; end if;
  select sum(l.total_amount) into v_total from public.admin_invoice_lines l where l.invoice_id = p_invoice_id and l.voided_at is null;
  select c.status into v_ck from public.admin_invoice_checkouts c where c.invoice_id = p_invoice_id and c.status in ('pending','open','needs_review','completed') limit 1;
  v_state := case when v_ck.status in ('pending','open') then 'in_progress' when v_ck.status = 'needs_review' then 'confirming' when v_ck.status = 'completed' or v_inv.status = 'paid' then 'completed'
                  when v_inv.status = 'payment_failed' then 'failed' else 'none' end;
  return jsonb_build_object(
    'id', v_inv.id, 'status', v_inv.status, 'finalized_at', v_inv.finalized_at, 'paid_at', v_inv.paid_at,
    'amount_excl_tax', (select sum(l.amount_excl_tax) from public.admin_invoice_lines l where l.invoice_id = p_invoice_id and l.voided_at is null),
    'tax_amount', (select sum(l.tax_amount) from public.admin_invoice_lines l where l.invoice_id = p_invoice_id and l.voided_at is null),
    'total_amount', v_total,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('fee_kind', l.fee_kind, 'store_name', s.store_name, 'amount_excl_tax', l.amount_excl_tax, 'tax_amount', l.tax_amount, 'total_amount', l.total_amount) order by l.created_at, l.id)
                       from public.admin_invoice_lines l left join public.salon_stores s on s.id = l.store_id where l.invoice_id = p_invoice_id and l.voided_at is null), '[]'::jsonb),
    'payment', jsonb_build_object('state', v_state,
                                  'can_begin', v_inv.status = 'payment_pending' and coalesce(v_total, 0) > 0 and v_ck.status is null));
end $$;

-- ============ 権限 ============
-- 新設の8本はすべて、公開RPC。PUBLIC/anon/authenticated/service_role から明示的に外してから、authenticated のみに付与する（既定の権限に依存しない）。
revoke all on function public.admin_billing_summary(uuid), public.admin_list_quotes(uuid, integer, integer), public.admin_list_invoices(uuid, text, integer, integer), public.admin_get_invoice(uuid),
  public.admin_list_billable_cases(uuid, integer, integer), public.admin_list_unresolved_billing_cases(uuid, boolean, integer, integer),
  public.company_billing_overview(uuid), public.company_get_invoice(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_billing_summary(uuid), public.admin_list_quotes(uuid, integer, integer), public.admin_list_invoices(uuid, text, integer, integer), public.admin_get_invoice(uuid),
  public.admin_list_billable_cases(uuid, integer, integer), public.admin_list_unresolved_billing_cases(uuid, boolean, integer, integer),
  public.company_billing_overview(uuid), public.company_get_invoice(uuid)
  to authenticated;
commit;
```
