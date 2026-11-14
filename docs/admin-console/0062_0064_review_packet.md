# 0062 / 0063 / 0064 v4.1 レビュー資料（修正差分＋SQL全文＋検証結果）

※本番・Supabaseには未適用、commit・pushなし。適用順は 0062 → 0063 → 0064。


適用順は **0062 → 0063 → 0064**。いずれも草案（`*.draft.sql`）で、本番・Supabase には何も適用していません。commit・push もしていません。
**Stripe 連携は未完成です。** 決済の「受付記録（admin_invoice_checkouts）」までで、実際のStripeセッション作成・通知（webhook）による「完了／失敗／要確認」への更新・返金処理はまだありません。今回の二重決済防止は、その受付記録のDB側の規則です。needs_review を解消する運営操作もまだ作っていません。
**税10%・切り捨ては草案のままで、税務上の適用確認は済んでいません。**

## 結果（すべてローカルのPostgreSQL 16）
| 項目 | 結果 |
|---|---|
| 0062_verify.sql（v3の79件を新仕様に合わせ、V1〜V5を追加） | 104 PASS / 0 FAIL |
| 0062_concurrency.sh（R1〜R5＋R6 同じ採用進行の採用料の同時作成／R7 請求作成の同時再送／R8 決済開始の同時再送／R9 接続の強制切断後の再試行） | 12 PASS / 0 FAIL |
| 0063_0064_verify.sql（U系を採用進行ID判定に書き直し） | 49 PASS / 0 FAIL |
| 0064_concurrency.sh（K1〜K6: 新採用料と旧成功報酬の同時作成・方式変更・確定・再送を両方の順で） | 6 PASS / 0 FAIL |
| 0064_effective_from.sh（未来日の切替。実時間の待機あり。E1〜E13） | 13 PASS / 0 FAIL |
| 0062_0064_privilege_check.sh（Supabaseの既定権限を模したDBで、新設の全表9・全関数38の実効権限） | 全PASS（表: PUBLIC/anon/authenticated/service_roleに権限なし。公開RPC20本=authenticatedのみ。内部関数はどのロールも不可） |
| 0062_preapply_check.sql | 16 PASS / INFO 1 |
| 0062_postapply_check.sql | 145 PASS / INFO 2（既存オブジェクトのスナップショットは適用前と一致） |
| 0064の巻き戻し予行 | トリガー・新関数がすべて外れ、0040の元の定義に戻る。記録表（切替・案件判定）と請求行は残る。再実行しても失敗しない |
| 0062の巻き戻し予行 | 未使用なら完全削除（新RPC・内部関数を含め適用前に戻る）。データがあれば中止。停止→再開でデータが残る |

### 対照実験（検査が効いているかの確認）
- 0064の共通ロックを外した版: K1・K2 が FAIL（後続が待たされない＝直列化されていない）。**ただし、K3〜K5 と最終的な件数（採用の請求は1つだけ）は、ロックなしでも保たれました。** 新旧の判定（basis）と行ロックだけでも今回のシナリオは守られており、共通ロックは追加の保険として働いています（ロックの有無は「待たされるか」で確認）。
- 既定権限DBでの権限確認: 0063の表 organization_location_events に service_role の権限が自動で付く不備を、このチェックが検出しました（0063のACLを明示的に全ロールから外すよう修正。0063の変更はこの1点のみ）。

## 依頼7項目と対応
1. **請求後の通常進行**: 案件ガードを選択式に変更。内定(offered)→採用成立(hired)、実施確認の初回登録、internal_note等の更新は止めない。店舗・美容師・採用進行の付け替え、案件の取消、実施確認の取消・変更、意向の撤回、辞退/不採用/保留への変更、hired→offered への戻しは「請求の訂正が必要」として拒否（V1a〜V1g）。
2. **決済**: needs_review・completed（通知が遅れて請求がまだ支払い待ちの間も）がある請求は、新しい決済開始を拒否（V2b/V2c）。進行中(pending/open)は同じ受付を返す。failed/expired の後は新しい決済を開始できる（V2d）。取消・訂正も、needs_review・completed の間は拒否。
3. **共通の案件識別とロック**: 新採用料の存在確認・作成、旧成功報酬の作成・確定・決済開始、案件の方式変更は、すべて採用進行IDの共通ロック（pg_advisory_xact_lock）の下で実行（K1〜K6）。
4. **1採用の定義**: 「1採用」＝採用進行 store_hiring_processes.id。採用料の行に hiring_process_id を持たせ、取消でない採用料は採用進行ごとに1つだけ（部分一意）。見学案件が複数でも二重にならない（V4a/R6）。店舗×美容師の永久の一意制約は新設しない。採用進行に紐づかない採用・見学未実施の採用は採用料にせず、個別確認（admin_flag_billing_case）に回す（V4d〜V4f）。
5. **未来のeffective_from**: 記録の存在だけでは切り替わらない。月額の拒否・新採用料の許可・旧成功報酬の抑止・明示の「新」への移行は、すべて「効力が生じた（effective_from以前）」判定に統一（E1〜E13）。
6. **権限**: 新設の全表・全関数をPUBLIC/anon/authenticated/service_roleから明示的に外し、公開RPCだけauthenticatedへ付与。Supabase既定権限を模したDBで実効権限を確認。
7. **再試行の重複防止**: 請求作成（request_id）・見積提示・見積応答・進行(advance)・決済開始・採用料訂正・行追加・登録手数料行・個別確認の登録を、再試行で重複しない形に変更。接続の強制切断後の再試行（R9）と、取引の中断後の再試行（V3c/V3d）を確認。

## レビューで決めてほしい点・残るリスク
- **「1採用」の定義**は、既存の採用進行（0037が店舗×美容師ごとに現在の1行とする）です。同じ店舗・同じ美容師の「将来の別の採用」は、採用進行の行が増やせない現在の仕様では自動で別の採用料にならず、個別確認になります。再採用を自動で扱うなら、採用進行側の仕様変更が必要です。
- 案件(admin_visit_cases)の採用進行への紐づけは任意項目（0061）のままです。紐づいていない既存案件の採用は、自動では採用料になりません。
- 切替の効力日時の時点で進行中の月額決済は自動では止めません（切替の登録時に進行中の決済があれば拒否しますが、登録後・効力前に始まった決済が効力後も続く場合は別途確認が必要）。
- 実際にPostgreSQLが検出したデッドロックの再現は行っていません（代わりに、接続の強制切断・取引の中断後の再試行で重複しないことを確認）。
- 請求を取消すと行は取消扱いで解放されます（削除しない）。needs_review の解消手段（運営の操作）はStripe連携と合わせて別途必要です。

## v4.1（追加修正2点）の検証結果
| 項目 | 結果 |
|---|---|
| 0062_verify.sql（V6a〜V6g を追加） | 111 PASS / 0 FAIL |
| 旧ロジックに戻した対照実験 | V6a（NULL化）・V6d（採用料だけの請求の実施確認の変更）・V6e（実施確認済みステータスの巻き戻し）が FAIL ＝ 検査が効いている |
| 0064_rollback_rehearsal.sh | 6 PASS / 0 FAIL（RB1〜RB4, SU1, SU2） |
| 回帰: 0062同時実行 / 0064同時実行 / 0063_0064_verify / 事後チェック / 権限確認 / 未来日の切替 | 12 PASS / 6 PASS / 49 PASS / 145 PASS / 全PASS / 13 PASS |

- ①請求後の内定状態: hiring_decision を NULL・undecided にすると拒否（V6a/V6b）。意向のNULL化も拒否（V6c）。通常の 内定→採用成立 は通る（V6f、V1b）。
- ②採用料だけの請求でも、実施確認日時の変更・削除と、実施確認済みステータスから戻すことを拒否（V6d/V6e）。
- ③0064の巻き戻しは、切替の記録・案件ごとの判定・有効な新採用料の行のどれかがあれば、何も変更せず中止（RB1〜RB3。効力が未来日の切替記録でも中止）。記録も新採用料も無ければ巻き戻せて、再実行も失敗しない（RB4）。
- 運用開始後の停止は 0064_suspend_keep_guard（記録・二重請求防止のトリガーを残し、切替の操作の実行権限だけを外す）。再開は 0064_resume（SU1/SU2）。


## 今回の修正差分（v4 初版 → v4.1）

### 0062: `_admin_visit_case_fee_guard`

```diff
--- 0062 (v4 初版)
+++ 0062 (v4.1)
@@ -515,8 +515,8 @@
       if new.status = 'cancelled' and old.status <> 'cancelled' then raise exception 'case has an invoiced fee; cancelling the case needs a billing correction'; end if;
       -- 実施確認の取消・変更（見学料の根拠。採用料の作成条件にも「見学実施済み」があるため、採用料だけの請求でも保護する）
-      if v_visit and old.visit_confirmed_at is not null and new.visit_confirmed_at is distinct from old.visit_confirmed_at then
+      if old.visit_confirmed_at is not null and new.visit_confirmed_at is distinct from old.visit_confirmed_at then
         raise exception 'case has an invoiced fee; changing the confirmed visit needs a billing correction';
       end if;
-      if false then
+      if old.status = 'visit_confirmed' and new.status is distinct from 'visit_confirmed' then
         raise exception 'case has an invoiced fee; reverting the confirmed visit status needs a billing correction';
       end if;
@@ -529,5 +529,5 @@
         -- NULL（内定状態の消去）も「変更」として扱う。許可するのは offered/hired への進行だけ（NULLとの比較で素通りしないよう coalesce で明示）
         if new.hiring_decision is distinct from old.hiring_decision
-           and not (new.hiring_decision in ('offered','hired') and not (old.hiring_decision = 'hired' and new.hiring_decision = 'offered')) then
+           and not (coalesce(new.hiring_decision in ('offered','hired'), false) and not coalesce(old.hiring_decision = 'hired' and new.hiring_decision = 'offered', false)) then
           raise exception 'case has an invoiced fee; declining or reverting the offer needs a billing correction (cancel the invoice or handle as a refund case)';
         end if;
```

### 0064 巻き戻し: 先頭に追加した安全装置

```sql
do $$
declare n_regime int := 0; n_basis int := 0; n_lines int := 0;
begin
  if to_regclass('public.organization_billing_regime') is not null then execute 'select count(*) from public.organization_billing_regime' into n_regime; end if;
  if to_regclass('public.hiring_process_billing_basis') is not null then execute 'select count(*) from public.hiring_process_billing_basis' into n_basis; end if;
  if to_regclass('public.admin_invoice_lines') is not null then
    execute $q$select count(*) from public.admin_invoice_lines where fee_kind in ('hire_stylist','hire_assistant') and voided_at is null$q$ into n_lines;
  end if;
  if n_regime > 0 or n_basis > 0 or n_lines > 0 then
    raise exception '0064 の巻き戻しを中止しました（切替の記録 % 件・案件ごとの判定 % 件・有効な新採用料の行 % 件）。二重請求の防止が外れるため、何も変更していません。0064_suspend_keep_guard を使ってください', n_regime, n_basis, n_lines;
  end if;
end $$;
```


## 1. 0062 本体（全文）

`0062_admin_billing.draft.sql`

```sql
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
```


## 2. 0063 本体（全文）

`0063_company_location.draft.sql`

```sql
-- ============================================================================
-- 0063（レビュー用草案・未適用）: 会社所在地の保存項目
-- ============================================================================
-- 方針（確定）: 会社所在地の保存項目を設ける。店舗所在地（salon_stores / salon_store_profiles）・請求先住所
--   （organization_billing_profiles）とは別の列として持つ。店舗住所から推測して埋めない。既存分は未設定(NULL)のまま。
-- 変更内容:
--   ・salon_organizations に nullable の列を5つ追加（デフォルト無し=既存行は書き換わらない。バックフィルはしない）。
--   ・都道府県は47の完全一致のみ許可。未入力は NULL（画面は「未設定」）。
--   ・更新は運営者専用RPC admin_set_organization_location のみ。履歴は organization_location_events（追記専用）に残す。
--   ・salon_organizations の権限は変更しない（authenticated は select のみ。会社の所属者は自社の所在地を読めるが、書けない）。
-- 影響: 既存のRLS・権限・関数は変更しない。巻き戻しは列と関数・履歴表のdrop。
begin;

create or replace function public.is_known_prefecture(p text) returns boolean
language sql immutable set search_path = public, pg_temp
as $$ select p = any (array['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県']) $$;

alter table public.salon_organizations
  add column hq_prefecture text check (hq_prefecture is null or public.is_known_prefecture(hq_prefecture)),
  add column hq_city text check (hq_city is null or char_length(hq_city) between 1 and 50),
  add column hq_street_address text check (hq_street_address is null or char_length(hq_street_address) between 1 and 100),
  add column hq_location_updated_at timestamptz,
  add column hq_location_updated_by uuid references auth.users(id) on delete set null;
comment on column public.salon_organizations.hq_prefecture is '会社所在地（本社等）の都道府県。店舗所在地・請求先住所とは別。NULL=未設定（店舗住所から推測して埋めない）。';

create table public.organization_location_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.salon_organizations(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  before_value jsonb not null, after_value jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.organization_location_events enable row level security;
revoke all on public.organization_location_events from public, anon, authenticated, service_role;   -- 既定権限（Supabase）に依存せず、全ロールから明示的に外す

create or replace function public.admin_get_organization_location(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select jsonb_build_object('prefecture', o.hq_prefecture, 'city', o.hq_city, 'street_address', o.hq_street_address,
           'is_set', (o.hq_prefecture is not null or o.hq_city is not null or o.hq_street_address is not null),
           'updated_at', o.hq_location_updated_at, 'updated_by', o.hq_location_updated_by)
    into v from public.salon_organizations o where o.id = p_organization_id;
  if v is null then raise exception 'organization not found'; end if;
  return v;
end $$;

create or replace function public.admin_set_organization_location(p_organization_id uuid, p_prefecture text, p_city text, p_street_address text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_old jsonb; v_new jsonb;
  v_pref text := nullif(trim(coalesce(p_prefecture, '')), '');
  v_city text := nullif(trim(coalesce(p_city, '')), '');
  v_street text := nullif(trim(coalesce(p_street_address, '')), '');
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if v_pref is not null and not public.is_known_prefecture(v_pref) then raise exception 'invalid prefecture'; end if;
  select jsonb_build_object('prefecture', hq_prefecture, 'city', hq_city, 'street_address', hq_street_address) into v_old
    from public.salon_organizations where id = p_organization_id for update;
  if v_old is null then raise exception 'organization not found'; end if;
  v_new := jsonb_build_object('prefecture', v_pref, 'city', v_city, 'street_address', v_street);
  if v_new = v_old then return jsonb_build_object('changed', false); end if;
  update public.salon_organizations set hq_prefecture = v_pref, hq_city = v_city, hq_street_address = v_street,
         hq_location_updated_at = now(), hq_location_updated_by = v_uid where id = p_organization_id;
  insert into public.organization_location_events (organization_id, actor_user_id, before_value, after_value) values (p_organization_id, v_uid, v_old, v_new);
  return jsonb_build_object('changed', true);
end $$;

revoke all on function public.admin_get_organization_location(uuid), public.admin_set_organization_location(uuid, text, text, text), public.is_known_prefecture(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_organization_location(uuid), public.admin_set_organization_location(uuid, text, text, text) to authenticated;
grant execute on function public.is_known_prefecture(text) to authenticated;
commit;
```


## 3. 0064 本体（全文）

`0064_billing_regime_legacy_guard.draft.sql`

```sql
-- ============================================================================
-- 0064（レビュー用草案・未適用）: 旧料金→新料金の会社単位の切替と、旧成功報酬の「DBでの」抑止
-- ============================================================================
-- 方針（確定）:
--   ・会社ごとの明示的な切替。新方式の案件では旧成功報酬の【自動作成を抑止】する（運営の免除操作に依存しない）。
--   ・旧画面・旧APIからも、誤って旧請求を確定・決済できないようにする（アプリではなくDBのトリガーで拒否）。
--   ・既存の有効な請求・決済履歴は削除・再計算しない（追記専用の記録表と、新しいトリガーだけを足す）。
--   ・切替前から進行中の案件は「採用進行の作成時刻が切替日時より前なら旧」を既定とし、条件付きで運営が明示的に新へ変更できる。
--   ・月額無料へ移す会社に定期課金が残る場合は、切替そのものを拒否する（確認・停止・反映確認が済むまで切り替えられない）。
-- v4（0062との接続。★0062の適用後に適用する）:
--   ・「1採用」＝採用進行 store_hiring_processes.id（既存の 0037 が店舗×美容師ごとに1行とする現在の行）。見学案件が複数あっても、同じ採用進行の採用料は1つだけ。
--     （店舗×美容師の永久の一意制約は新設しない。判定は採用進行IDのみ。採用進行に紐づかない採用は個別確認）
--   ・新方式の採用料・旧成功報酬の存在確認／作成／方式変更は、すべて採用進行IDの共通ロック（pg_advisory_xact_lock）の下で行う。
--   ・切替は effective_from を過ぎるまで効かない（記録の存在だけでは切り替わらない）。判定は _billing_regime_active と _hiring_process_basis に一本化。
--   ・新方式の採用料（0062 admin_invoice_lines の hire_stylist / hire_assistant）と旧成功報酬の二重請求を、DBで相互に防ぐ。
--       (a) 採用料の行は、効力が生じた（effective_from以降の）新方式の会社・新方式の案件でだけ作れる。同じ採用進行に、取消でない旧成功報酬があれば作れない。
--       (b) 旧成功報酬の確定・請求済み・支払い済みへの遷移と、旧成功報酬のカード決済の開始は、同じ採用に有効な採用料の行があれば拒否。
--       (c) 旧成功報酬の自動作成は、同じ採用に有効な採用料の行があれば抑止し、「重複の疑い（fee_overlap）」を個別確認の一覧に残す。
-- 既存の関数・表の変更:
--   ・既存の関数 hiring_create_success_fee / begin_success_fee_card_checkout / admin_update_success_fee は【書き換えない】。
--     hiring_success_fees と stripe_checkout_records に BEFORE トリガーを足して、新方式の案件の旧成功報酬を止める。
--   ・get_admin_billing_integrity_issues（0040）だけを再定義する（新方式の hired に旧成功報酬が無いのを異常と数えないため）。
--     差分は1行（`public._hiring_process_basis(p.id) <> 'new'`）。巻き戻しファイルに元の定義を含む。
begin;

create table public.organization_billing_regime (
  organization_id uuid primary key references public.salon_organizations(id) on delete restrict,
  regime text not null default 'new' check (regime = 'new'),     -- 行が無い会社は旧方式。新方式への一方向のみ
  effective_from timestamptz not null,
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_at timestamptz not null default now()
);
create table public.hiring_process_billing_basis (                 -- 案件ごとの明示的な判定（既定は _hiring_process_basis が導く）
  hiring_process_id uuid primary key references public.store_hiring_processes(id) on delete restrict,
  basis text not null check (basis in ('legacy','new')),
  reason text not null check (char_length(reason) between 1 and 200),
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_at timestamptz not null default now()
);
alter table public.organization_billing_regime enable row level security;
alter table public.hiring_process_billing_basis enable row level security;
revoke all on public.organization_billing_regime, public.hiring_process_billing_basis from public, anon, authenticated, service_role;

create or replace function public._billing_append_only() returns trigger language plpgsql set search_path = public, pg_temp
as $$ begin raise exception 'billing regime records are append-only'; end $$;
create trigger trg_regime_append_only before update or delete on public.organization_billing_regime for each row execute function public._billing_append_only();
create trigger trg_basis_append_only before update or delete on public.hiring_process_billing_basis for each row execute function public._billing_append_only();

-- 共通ロック: 採用（採用進行ID）ごと。新方式の採用料と旧成功報酬の存在確認・作成・方式変更は、すべてこのロックの下で行う（トランザクション終了で解放）
create or replace function public._hiring_lock(p_process_id uuid) returns void
language sql security definer set search_path = public, pg_temp
as $$ select pg_advisory_xact_lock(hashtextextended('hire:' || p_process_id::text, 0)) $$;
-- 会社の新方式が「効力を持っているか」: 切替の記録があり、かつ effective_from 以前（未来日の切替は、その日時まで効かない）
create or replace function public._billing_regime_active(p_org uuid, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.organization_billing_regime r where r.organization_id = p_org and r.effective_from <= p_at) $$;

-- 判定: 明示行があればそれ。無ければ「会社の新方式が効力を持ち かつ 採用進行の作成時刻 >= 切替日時」なら新、それ以外は旧。（明示の新は、決定時に効力が生じている会社だけ）
create or replace function public._hiring_process_basis(p_process_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    (select b.basis from public.hiring_process_billing_basis b where b.hiring_process_id = p_process_id),
    (select 'new' from public.store_hiring_processes pr
       join public.salon_stores s on s.id = pr.store_id
       join public.organization_billing_regime r on r.organization_id = s.organization_id
      where pr.id = p_process_id and pr.created_at >= r.effective_from),
    'legacy')
$$;
revoke all on function public._hiring_process_basis(uuid) from public, anon, authenticated;

-- (1) 新方式の案件では、旧成功報酬の自動作成を抑止（INSERTを静かにスキップ。採用成立の記録自体は通常どおり）
-- 「同じ採用」＝同じ採用進行の、取消でない有効な採用料の行
create or replace function public._hiring_has_active_hire_line(p_process_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admin_invoice_lines l
                  where l.hiring_process_id = p_process_id and l.voided_at is null and l.fee_kind in ('hire_stylist','hire_assistant'))
$$;

create or replace function public._trg_fee_insert_basis() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$ begin
  perform public._hiring_lock(new.hiring_process_id);   -- 新方式の採用料の作成・方式変更と直列化
  if public._hiring_process_basis(new.hiring_process_id) = 'new' then return null; end if;
  -- 新方式の採用料が同じ採用にすでにある場合は、旧成功報酬を作らない（二重請求の防止）。重複の疑いとして個別確認に残す
  if public._hiring_has_active_hire_line(new.hiring_process_id) then
    insert into public.admin_unresolved_billing_cases (organization_id, reason, note)
      values (new.organization_id, 'fee_overlap', '新方式の採用料がある採用で、旧成功報酬の自動作成を抑止しました（採用進行 ' || new.hiring_process_id || '）');
    return null;
  end if;
  return new;
end $$;
create trigger trg_hiring_success_fees_basis_insert before insert on public.hiring_success_fees for each row execute function public._trg_fee_insert_basis();

-- (2) 旧画面・旧APIからの確定・請求済み・支払い済みへの遷移を拒否（取消は可）
create or replace function public._trg_fee_update_basis() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$ begin
  if new.fee_status in ('confirmed','invoiced','paid') and new.fee_status is distinct from old.fee_status then
    perform public._hiring_lock(new.hiring_process_id);
    if public._hiring_process_basis(new.hiring_process_id) = 'new' then
      raise exception 'legacy success fee is not allowed for a new-regime case';
    end if;
    if public._hiring_has_active_hire_line(new.hiring_process_id) then
      raise exception 'a new-regime hire fee already exists for this hire';
    end if;
  end if;
  return new;
end $$;
create trigger trg_hiring_success_fees_basis_update before update on public.hiring_success_fees for each row execute function public._trg_fee_update_basis();

-- (3) 旧の成功報酬カード決済の開始を拒否。新方式の会社では月額（当面無料）の定期課金の開始も拒否する。
--     （カード登録 payment_method_setup とスカウト枠 scout_credits は対象外＝変更しない）
create or replace function public._trg_checkout_basis() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_proc uuid;
begin
  if new.purpose = 'monthly_subscription' then
    perform 1 from public.salon_organizations where id = new.organization_id for share;   -- 切替（組織行の排他ロック）と直列化
    -- 月額の決済開始は、新方式が「効力を持った」会社だけ拒否（未来日の切替は、その日時まで旧方式のまま）
    if public._billing_regime_active(new.organization_id) then raise exception 'monthly subscription is not billed under the new regime'; end if;
  end if;
  if new.purpose = 'success_fee' and new.success_fee_id is not null then
    select hiring_process_id into v_proc from public.hiring_success_fees where id = new.success_fee_id;
    if v_proc is not null then
      perform public._hiring_lock(v_proc);
      if public._hiring_process_basis(v_proc) = 'new' then raise exception 'legacy success fee is not allowed for a new-regime case'; end if;
      if public._hiring_has_active_hire_line(v_proc) then raise exception 'a new-regime hire fee already exists for this hire'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_stripe_checkout_basis before insert on public.stripe_checkout_records for each row execute function public._trg_checkout_basis();

-- (a) 新方式の採用料の行は、効力が生じた新方式の会社・案件でだけ作れ、同じ採用進行に旧成功報酬（取消・免除以外）があれば作れない（0062 admin_invoice_lines に足すトリガー）
-- 採用進行は案件(admin_visit_cases)から読む（トリガーは名前順で 0062 の規則より先に動く）。採用進行に紐づかない行の拒否は 0062 の規則が行う。
create or replace function public._trg_hire_line_regime_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_proc uuid;
begin
  if new.fee_kind not in ('hire_stylist','hire_assistant') then return new; end if;
  select c.hiring_process_id into v_proc from public.admin_visit_cases c where c.id = new.visit_case_id;
  if v_proc is null then return new; end if;
  perform public._hiring_lock(v_proc);   -- 旧成功報酬の作成・方式変更と直列化（ロック取得後に存在確認する）
  if not public._billing_regime_active(new.organization_id) then
    raise exception 'organization is not on the new billing regime';
  end if;
  if public._hiring_process_basis(v_proc) <> 'new' then
    raise exception 'hiring process is on the legacy billing basis';
  end if;
  if exists (select 1 from public.hiring_success_fees f where f.hiring_process_id = v_proc and f.fee_status not in ('cancelled','waived')) then
    raise exception 'a legacy success fee already exists for this hire';
  end if;
  return new;
end $$;
create trigger trg_admin_invoice_lines_regime_guard before insert on public.admin_invoice_lines for each row execute function public._trg_hire_line_regime_guard();

-- (4) 切替（運営者のみ）。過去の日時は不可（既存案件の判定が変わらないように）。定期課金・進行中の決済が残る会社は不可。
create or replace function public.admin_set_billing_regime(p_organization_id uuid, p_effective_from timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid(); v_eff timestamptz := coalesce(p_effective_from, now());
  v_sub record; v_in_progress int;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  perform 1 from public.salon_organizations where id = p_organization_id for update;
  if not found then raise exception 'organization not found'; end if;
  -- 再試行: すでに設定済みなら、設定済みの内容を返す（二重に設定しない。日時は最初の設定のまま）
  if exists (select 1 from public.organization_billing_regime where organization_id = p_organization_id) then
    return jsonb_build_object('already_set', true, 'effective_from', (select effective_from from public.organization_billing_regime where organization_id = p_organization_id));
  end if;
  if v_eff < now() - interval '1 minute' then raise exception 'effective_from must not be in the past'; end if;
  select * into v_sub from public.organization_subscriptions where organization_id = p_organization_id;
  if found and v_sub.subscription_status in ('active','trialing','past_due','unpaid','incomplete','paused') and not v_sub.cancel_at_period_end then
    raise exception 'legacy subscription is still active; stop it and confirm before switching';
  end if;
  if exists (select 1 from public.stripe_checkout_records where organization_id = p_organization_id and status in ('pending','open')) then
    raise exception 'an open checkout exists; wait for it to finish before switching';
  end if;
  insert into public.organization_billing_regime (organization_id, effective_from, decided_by) values (p_organization_id, v_eff, v_uid);
  select count(*) into v_in_progress from public.store_hiring_processes pr join public.salon_stores s on s.id = pr.store_id
    where s.organization_id = p_organization_id and pr.status not in ('hired','declined','rejected');
  return jsonb_build_object('effective_from', v_eff, 'in_progress_cases_kept_legacy', v_in_progress,
    'subscription_ends_at_period_end', coalesce(v_sub.cancel_at_period_end, false), 'subscription_period_end', v_sub.current_period_end);
end $$;

-- (5) 切替前から進行中の案件を、運営が明示的に新へ（または旧のままに）する。旧成功報酬が確定済み以降なら不可。
create or replace function public.admin_set_process_billing_basis(p_process_id uuid, p_basis text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_org uuid; v_fee public.hiring_success_fees; v_cancelled boolean := false; v_prev text;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_basis not in ('legacy','new') then raise exception 'invalid basis'; end if;
  if p_reason is null or char_length(trim(p_reason)) = 0 then raise exception 'reason required'; end if;
  select s.organization_id into v_org from public.store_hiring_processes pr join public.salon_stores s on s.id = pr.store_id where pr.id = p_process_id for update of pr;
  if v_org is null then raise exception 'process not found'; end if;
  -- ロック順: 採用進行の行 → 旧成功報酬の行 → 採用の共通ロック（旧成功報酬の更新トリガーと同じ順）
  select * into v_fee from public.hiring_success_fees where hiring_process_id = p_process_id for update;
  perform public._hiring_lock(p_process_id);
  select * into v_fee from public.hiring_success_fees where hiring_process_id = p_process_id for update;   -- ロック待ちの間に作られた旧成功報酬も拾うため、取得後に読み直す
  select basis into v_prev from public.hiring_process_billing_basis where hiring_process_id = p_process_id;
  if v_prev is not null then
    if v_prev = p_basis then return jsonb_build_object('basis', v_prev, 'already_decided', true); end if;   -- 再試行は何もしない
    raise exception 'basis already decided';
  end if;
  if p_basis = 'new' and not public._billing_regime_active(v_org) then raise exception 'organization is not on the new regime yet'; end if;   -- 未来日の切替は、効力が生じるまで案件を新にできない
  if p_basis = 'legacy' and public._hiring_has_active_hire_line(p_process_id) then raise exception 'a new-regime hire fee already exists for this hire'; end if;
  if p_basis = 'new' and v_fee.id is not null then
    if v_fee.fee_status not in ('pending_confirmation','cancelled') then raise exception 'success fee already progressed; cannot move to the new regime'; end if;
    if v_fee.fee_status = 'pending_confirmation' then
      -- 金額も請求も無い自動作成の行だけを「取消」にする（削除・再計算はしない。履歴を残す）
      update public.hiring_success_fees set fee_status = 'cancelled', cancelled_at = now() where id = v_fee.id;
      insert into public.hiring_success_fee_events (success_fee_id, event_type, from_status, to_status, actor_user_id, note)
        values (v_fee.id, 'cancelled', 'pending_confirmation', 'cancelled', v_uid, '新方式へ移すため取消（金額・請求なし）: ' || left(trim(p_reason), 200));
      v_cancelled := true;
    end if;
  end if;
  insert into public.hiring_process_billing_basis (hiring_process_id, basis, reason, decided_by) values (p_process_id, p_basis, left(trim(p_reason), 200), v_uid);
  return jsonb_build_object('basis', p_basis, 'legacy_fee_cancelled', v_cancelled);
end $$;

-- (6) 切替前の確認用（運営者のみ・読み取り）: 定期課金・進行中の決済・案件の内訳
create or replace function public.admin_billing_regime_status(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select jsonb_build_object(
    'regime', coalesce((select r.regime from public.organization_billing_regime r where r.organization_id = o.id), 'legacy'),
    'effective_from', (select r.effective_from from public.organization_billing_regime r where r.organization_id = o.id),
    'is_effective', public._billing_regime_active(o.id),
    'subscription', (select jsonb_build_object('status', s.subscription_status, 'cancel_at_period_end', s.cancel_at_period_end, 'current_period_end', s.current_period_end) from public.organization_subscriptions s where s.organization_id = o.id),
    'open_checkouts', (select count(*) from public.stripe_checkout_records c where c.organization_id = o.id and c.status in ('pending','open')),
    'legacy_fees_open', (select count(*) from public.hiring_success_fees f where f.organization_id = o.id and f.fee_status in ('pending_confirmation','confirmed','invoiced')),
    'processes_in_progress', (select count(*) from public.store_hiring_processes pr join public.salon_stores s on s.id = pr.store_id where s.organization_id = o.id and pr.status not in ('hired','declined','rejected')),
    'switch_blocked_reason', case
       when exists (select 1 from public.organization_billing_regime r where r.organization_id = o.id) then 'already_new'
       when exists (select 1 from public.organization_subscriptions s where s.organization_id = o.id and s.subscription_status in ('active','trialing','past_due','unpaid','incomplete','paused') and not s.cancel_at_period_end) then 'legacy_subscription_active'
       when exists (select 1 from public.stripe_checkout_records c where c.organization_id = o.id and c.status in ('pending','open')) then 'open_checkout'
       else null end
  ) into v from public.salon_organizations o where o.id = p_organization_id;
  if v is null then raise exception 'organization not found'; end if;
  return v;
end $$;

-- 権限の整理（既定の権限に依存しない）。新設の記録表は上で全ロールから外済み。
-- 内部関数・トリガー関数: どのロールにも実行権限を付けない
revoke all on function public._billing_append_only(), public._hiring_lock(uuid), public._billing_regime_active(uuid, timestamptz), public._hiring_process_basis(uuid),
  public._hiring_has_active_hire_line(uuid), public._trg_fee_insert_basis(), public._trg_fee_update_basis(), public._trg_checkout_basis(), public._trg_hire_line_regime_guard()
  from public, anon, authenticated, service_role;
-- 公開RPC（3本）: authenticated のみ
revoke all on function public.admin_set_billing_regime(uuid, timestamptz), public.admin_set_process_billing_basis(uuid, text, text), public.admin_billing_regime_status(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_billing_regime(uuid, timestamptz), public.admin_set_process_billing_basis(uuid, text, text), public.admin_billing_regime_status(uuid) to authenticated;

-- (7) 0040 の整合性チェックの再定義（差分は1行）
create or replace function public.get_admin_billing_integrity_issues()
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

  with issues as (
    -- 1. hiredなのに成功報酬が無い
    select 'missing_success_fee'::text as issue_type, 'critical'::text as severity,
           p.id as hiring_process_id, null::uuid as success_fee_id,
           s.organization_id, p.store_id, p.stylist_user_id,
           p.hired_at,
           '採用が成立していますが、成功報酬の記録がありません。'::text as message
    from public.store_hiring_processes p
    join public.salon_stores s on s.id = p.store_id
    where p.status = 'hired'
      and not exists (select 1 from public.hiring_success_fees f where f.hiring_process_id = p.id)
      and public._hiring_process_basis(p.id) <> 'new'   -- 新方式の案件は、旧成功報酬を作らないのが正しい状態

    union all
    -- 2. 成功報酬があるのに採用進捗がhiredではない
    select 'process_not_hired', 'critical',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           '成功報酬の記録がありますが、対応する採用進捗が「採用」になっていません。'
    from public.hiring_success_fees f
    join public.store_hiring_processes p on p.id = f.hiring_process_id
    where p.status <> 'hired'

    union all
    -- 3. store_idの不一致
    select 'store_mismatch', 'critical',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           '成功報酬の店舗が、採用進捗の店舗と一致しません。'
    from public.hiring_success_fees f
    join public.store_hiring_processes p on p.id = f.hiring_process_id
    where f.store_id <> p.store_id

    union all
    -- 4. stylist_user_idの不一致
    select 'stylist_mismatch', 'critical',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           '成功報酬の美容師が、採用進捗の美容師と一致しません。'
    from public.hiring_success_fees f
    join public.store_hiring_processes p on p.id = f.hiring_process_id
    where f.stylist_user_id <> p.stylist_user_id

    union all
    -- 6. hired_atの不一致（採用進捗のhired_atが空の場合も不一致として扱う）
    select 'hired_at_mismatch', 'critical',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           '成功報酬の採用成立日が、採用進捗の採用成立日と一致しません。'
    from public.hiring_success_fees f
    join public.store_hiring_processes p on p.id = f.hiring_process_id
    where f.hired_at is distinct from p.hired_at

    union all
    -- 履歴との不整合（成功報酬の状態と最新eventのto_statusが違う／履歴が無い）
    select 'event_status_mismatch', 'warning',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           case when le.to_status is null
                then '成功報酬の履歴が記録されていません。'
                else '成功報酬の状態が、履歴の最新の状態と一致しません。' end
    from public.hiring_success_fees f
    left join lateral (
      select e.to_status
      from public.hiring_success_fee_events e
      where e.success_fee_id = f.id
      order by e.created_at desc, e.id desc
      limit 1
    ) le on true
    where le.to_status is distinct from f.fee_status
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'issue_type', i.issue_type,
    'severity', i.severity,
    'hiring_process_id', i.hiring_process_id,
    'success_fee_id', i.success_fee_id,
    'organization_id', i.organization_id,
    'store_id', i.store_id,
    'store_name', st.store_name,
    'stylist_name', sp.public_name,
    'hired_at', i.hired_at,
    'message', i.message
  ) order by (i.severity = 'critical') desc, i.hired_at desc nulls last, i.issue_type), '[]'::jsonb)
  into v_result
  from issues i
  left join public.salon_stores st on st.id = i.store_id
  left join public.stylist_profiles sp on sp.user_id = i.stylist_user_id;

  return v_result;
end;
$$;
revoke all on function public.get_admin_billing_integrity_issues() from public, anon;
grant execute on function public.get_admin_billing_integrity_issues() to authenticated;

commit;
```


## 4. 0064 の巻き戻しSQL（全文・安全装置つき）

`0064_rollback.draft.sql`

```sql
-- 0064 の巻き戻し（草案）。トリガーと新関数を外し、0040の元の定義を戻す。記録表（切替・案件判定）は【残す】（切替の事実を失わないため）。
-- ★巻き戻すと、新方式の会社では旧成功報酬の自動作成・確定・決済の抑止が外れ、二重請求を防げなくなる。
--   そのため【このSQL自身が確認し】、切替の記録・案件ごとの判定・有効な新採用料の行のどれかがあれば、何も変更せずに中止する。
--   運用開始後に止めたいときは、これではなく 0064_suspend_keep_guard.draft.sql（記録と二重請求防止を残したまま、切替の操作だけを止める）を使う。
begin;
do $$
declare n_regime int := 0; n_basis int := 0; n_lines int := 0;
begin
  if to_regclass('public.organization_billing_regime') is not null then execute 'select count(*) from public.organization_billing_regime' into n_regime; end if;
  if to_regclass('public.hiring_process_billing_basis') is not null then execute 'select count(*) from public.hiring_process_billing_basis' into n_basis; end if;
  if to_regclass('public.admin_invoice_lines') is not null then
    execute $q$select count(*) from public.admin_invoice_lines where fee_kind in ('hire_stylist','hire_assistant') and voided_at is null$q$ into n_lines;
  end if;
  if n_regime > 0 or n_basis > 0 or n_lines > 0 then
    raise exception '0064 の巻き戻しを中止しました（切替の記録 % 件・案件ごとの判定 % 件・有効な新採用料の行 % 件）。二重請求の防止が外れるため、何も変更していません。0064_suspend_keep_guard を使ってください', n_regime, n_basis, n_lines;
  end if;
end $$;
drop trigger if exists trg_admin_invoice_lines_regime_guard on public.admin_invoice_lines;
drop trigger if exists trg_stripe_checkout_basis on public.stripe_checkout_records;
drop trigger if exists trg_hiring_success_fees_basis_update on public.hiring_success_fees;
drop trigger if exists trg_hiring_success_fees_basis_insert on public.hiring_success_fees;
drop function if exists public._trg_hire_line_regime_guard();
drop function if exists public._trg_checkout_basis();
drop function if exists public._trg_fee_update_basis();
drop function if exists public._trg_fee_insert_basis();
drop function if exists public._hiring_has_active_hire_line(uuid);
drop function if exists public._hiring_process_basis(uuid);
drop function if exists public._billing_regime_active(uuid, timestamptz);
drop function if exists public._hiring_lock(uuid);
drop function if exists public.admin_set_billing_regime(uuid, timestamptz);
drop function if exists public.admin_set_process_billing_basis(uuid, text, text);
drop function if exists public.admin_billing_regime_status(uuid);
-- 0040 の元の定義
create or replace function public.get_admin_billing_integrity_issues()
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

  with issues as (
    -- 1. hiredなのに成功報酬が無い
    select 'missing_success_fee'::text as issue_type, 'critical'::text as severity,
           p.id as hiring_process_id, null::uuid as success_fee_id,
           s.organization_id, p.store_id, p.stylist_user_id,
           p.hired_at,
           '採用が成立していますが、成功報酬の記録がありません。'::text as message
    from public.store_hiring_processes p
    join public.salon_stores s on s.id = p.store_id
    where p.status = 'hired'
      and not exists (select 1 from public.hiring_success_fees f where f.hiring_process_id = p.id)

    union all
    -- 2. 成功報酬があるのに採用進捗がhiredではない
    select 'process_not_hired', 'critical',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           '成功報酬の記録がありますが、対応する採用進捗が「採用」になっていません。'
    from public.hiring_success_fees f
    join public.store_hiring_processes p on p.id = f.hiring_process_id
    where p.status <> 'hired'

    union all
    -- 3. store_idの不一致
    select 'store_mismatch', 'critical',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           '成功報酬の店舗が、採用進捗の店舗と一致しません。'
    from public.hiring_success_fees f
    join public.store_hiring_processes p on p.id = f.hiring_process_id
    where f.store_id <> p.store_id

    union all
    -- 4. stylist_user_idの不一致
    select 'stylist_mismatch', 'critical',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           '成功報酬の美容師が、採用進捗の美容師と一致しません。'
    from public.hiring_success_fees f
    join public.store_hiring_processes p on p.id = f.hiring_process_id
    where f.stylist_user_id <> p.stylist_user_id

    union all
    -- 6. hired_atの不一致（採用進捗のhired_atが空の場合も不一致として扱う）
    select 'hired_at_mismatch', 'critical',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           '成功報酬の採用成立日が、採用進捗の採用成立日と一致しません。'
    from public.hiring_success_fees f
    join public.store_hiring_processes p on p.id = f.hiring_process_id
    where f.hired_at is distinct from p.hired_at

    union all
    -- 履歴との不整合（成功報酬の状態と最新eventのto_statusが違う／履歴が無い）
    select 'event_status_mismatch', 'warning',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           case when le.to_status is null
                then '成功報酬の履歴が記録されていません。'
                else '成功報酬の状態が、履歴の最新の状態と一致しません。' end
    from public.hiring_success_fees f
    left join lateral (
      select e.to_status
      from public.hiring_success_fee_events e
      where e.success_fee_id = f.id
      order by e.created_at desc, e.id desc
      limit 1
    ) le on true
    where le.to_status is distinct from f.fee_status
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'issue_type', i.issue_type,
    'severity', i.severity,
    'hiring_process_id', i.hiring_process_id,
    'success_fee_id', i.success_fee_id,
    'organization_id', i.organization_id,
    'store_id', i.store_id,
    'store_name', st.store_name,
    'stylist_name', sp.public_name,
    'hired_at', i.hired_at,
    'message', i.message
  ) order by (i.severity = 'critical') desc, i.hired_at desc nulls last, i.issue_type), '[]'::jsonb)
  into v_result
  from issues i
  left join public.salon_stores st on st.id = i.store_id
  left join public.stylist_profiles sp on sp.user_id = i.stylist_user_id;

  return v_result;
end;
$$;
revoke all on function public.get_admin_billing_integrity_issues() from public, anon;
grant execute on function public.get_admin_billing_integrity_issues() to authenticated;

commit;
```


## 5. 0064 の停止（記録と二重請求防止を残す）

`0064_suspend_keep_guard.draft.sql`

```sql
-- 0064 の【停止（記録と二重請求防止を残す）】（草案）。運用開始後に問題が出たときの第一手段。
-- 切替の記録・案件ごとの判定・二重請求防止のトリガー・内部関数は一切変えない（旧成功報酬と新採用料の相互の抑止、月額の拒否はそのまま働く）。
-- 止めるのは「新しい切替の操作」だけ（会社の切替・案件の判定を運営画面から実行する関数の実行権限を外す）。読み取りの状況確認は残す。
-- 復旧は 0064_resume.draft.sql。0064そのものを外す 0064_rollback は、切替の記録や有効な新採用料があると自分で中止する。
begin;
revoke execute on function public.admin_set_billing_regime(uuid, timestamptz), public.admin_set_process_billing_basis(uuid, text, text)
  from public, anon, authenticated, service_role;
commit;
```


## 6. 0064 の再開

`0064_resume.draft.sql`

```sql
-- 0064_suspend_keep_guard の復旧（草案）: 切替の操作の実行権限を authenticated に戻す（関数内で運営者権限を再確認する）。
begin;
grant execute on function public.admin_set_billing_regime(uuid, timestamptz), public.admin_set_process_billing_basis(uuid, text, text) to authenticated;
commit;
```


## 7. 0063 の巻き戻しSQL

`0063_rollback.draft.sql`

```sql
-- 0063 の巻き戻し（草案）。会社所在地の入力内容と変更履歴が消えるため、実運用後は先にエクスポートすること。
begin;
drop function if exists public.admin_set_organization_location(uuid, text, text, text);
drop function if exists public.admin_get_organization_location(uuid);
drop table if exists public.organization_location_events;
alter table public.salon_organizations drop column if exists hq_prefecture, drop column if exists hq_city, drop column if exists hq_street_address,
  drop column if exists hq_location_updated_at, drop column if exists hq_location_updated_by;
drop function if exists public.is_known_prefecture(text);
commit;
```


## 8. 0062 の停止（データを残す）

`0062_suspend_keep_data.draft.sql`

```sql
-- 0062 の【停止（データを残す）】（草案）。運用開始後に問題が出たときの第一手段。
-- 表・データ・トリガー・内部関数は一切変えない（料金の規則・二重請求防止・ロックはそのまま働く）。
-- アプリから呼べる公開RPCの実行権限だけを外す（請求の作成・見積・決済の開始・会社側の請求一覧が止まる）。
-- 復旧は 0062_resume.draft.sql。完全削除は、データを書き出して保管した後に、人が判断して別途行う。
begin;
revoke execute on function public.admin_propose_quote(uuid, integer, text), public.admin_withdraw_quote(uuid), public.admin_create_invoice(uuid, uuid),
  public.admin_add_fee_line(uuid, text, uuid), public.admin_add_registration_line(uuid), public.admin_void_line(uuid), public.admin_advance_invoice(uuid, text),
  public.company_list_quotes(uuid), public.company_respond_quote(uuid, boolean), public.billing_list_invoices(uuid), public.billing_begin_checkout(uuid),
  public.admin_correct_hire_line(uuid, text), public.admin_recalculate_registration_line(uuid), public.admin_flag_billing_case(uuid, text, text)
  from authenticated;
commit;
```


## 9. 0062 の再開

`0062_resume.draft.sql`

```sql
-- 0062 の【再開】（草案）。0062_suspend_keep_data で外した公開RPCの実行権限を、authenticated にだけ戻す。
begin;
grant execute on function public.admin_propose_quote(uuid, integer, text), public.admin_withdraw_quote(uuid), public.admin_create_invoice(uuid, uuid),
  public.admin_add_fee_line(uuid, text, uuid), public.admin_add_registration_line(uuid), public.admin_void_line(uuid), public.admin_advance_invoice(uuid, text),
  public.company_list_quotes(uuid), public.company_respond_quote(uuid, boolean), public.billing_list_invoices(uuid), public.billing_begin_checkout(uuid),
  public.admin_correct_hire_line(uuid, text), public.admin_recalculate_registration_line(uuid), public.admin_flag_billing_case(uuid, text, text)
  to authenticated;
commit;
```


## 10. 0062 の未使用時の完全削除

`0062_rollback_unused.draft.sql`

```sql
-- 0062 の【未使用時の完全削除】（草案）。請求・見積・決済の記録が1行も無いことを確認できた場合だけ使う。
-- 1行でもあれば、何も消さずに中止する（記録を失わないための安全装置）。運用開始後は 0062_suspend_keep_data.draft.sql（停止）を使う。
begin;
do $$
declare n bigint := 0; t text;
begin
  foreach t in array array['admin_quotes','admin_invoices','admin_invoice_lines','admin_invoice_checkouts','admin_invoice_webhook_events','admin_unresolved_billing_cases'] loop
    execute format('select count(*) from public.%I', t) into n;
    if n > 0 then raise exception '0062 のデータが残っています（% に % 行）。完全削除は中止しました。停止（0062_suspend_keep_data）を使ってください', t, n; end if;
  end loop;
end $$;
drop trigger if exists trg_admin_visit_case_fee_guard on public.admin_visit_cases;
drop function if exists public.admin_correct_hire_line(uuid, text), public.admin_recalculate_registration_line(uuid), public.admin_flag_billing_case(uuid, text, text), public._admin_assert_invoice_correctable(uuid),
  public.billing_begin_checkout(uuid), public.billing_list_invoices(uuid), public.company_respond_quote(uuid, boolean), public.company_list_quotes(uuid),
  public.admin_advance_invoice(uuid, text), public.admin_void_line(uuid), public.admin_add_registration_line(uuid), public.admin_add_fee_line(uuid, text, uuid),
  public.admin_create_invoice(uuid, uuid), public.admin_withdraw_quote(uuid), public.admin_propose_quote(uuid, integer, text);
drop table if exists public.admin_unresolved_billing_cases, public.admin_invoice_webhook_events, public.admin_invoice_checkouts, public.admin_invoice_lines,
  public.admin_invoices, public.admin_quotes cascade;
drop function if exists public._admin_visit_case_fee_guard(), public._admin_invoice_requires_amounts(), public._admin_invoice_line_rules(), public._admin_quotes_rules(),
  public._admin_invoice_payable_by(uuid, uuid), public._admin_org_billing_actor(uuid, uuid), public._admin_tax(integer), public.registration_fee_for_store_count(integer);
commit;
```


## 11. 追加した検証: 0064 巻き戻しの予行

`0064_rollback_rehearsal.sh`

```bash
#!/bin/bash
# 0064 の巻き戻し・停止・再開の予行（ローカル用）。ベースDB(0061適用済み)から作り直して実行する。
BASE=${1:-b62}; D=$(cd "$(dirname "$0")" && pwd); P="su postgres -c"; pass=0; fail=0
ok(){ if [ "$2" = "1" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 :: $3"; fail=$((fail+1)); fi; }
mk(){ $P "dropdb --if-exists $1; createdb -T $BASE $1"; for f in 0062_admin_billing.draft.sql 0063_company_location.draft.sql 0064_billing_regime_legacy_guard.draft.sql; do $P "psql -q -d $1 -v ON_ERROR_STOP=1 -f $D/$f" >/dev/null 2>&1; done; }
q(){ $P "psql -X -At -d $1 -c \"$2\"" 2>/dev/null; }
trg(){ q $1 "select count(*) from pg_trigger where tgname in ('trg_admin_invoice_lines_regime_guard','trg_stripe_checkout_basis','trg_hiring_success_fees_basis_update','trg_hiring_success_fees_basis_insert')"; }
rb(){ $P "psql -q -d $1 -v ON_ERROR_STOP=1 -f $D/0064_rollback.draft.sql" 2>&1 | grep -m1 "ERROR" ; }
# 1) 切替の記録が1件でもあれば中止（何も変更しない）
mk rh1; $P "psql -q -d rh1 -c \"insert into auth.users(id,email) values ('00000000-0000-0000-0000-00000000dd01','d@t'); insert into public.salon_organizations(id,name) values ('00000000-0000-0000-0000-0000000dd001','D'); insert into public.organization_billing_regime(organization_id,effective_from,decided_by) values ('00000000-0000-0000-0000-0000000dd001', now()+interval '30 days','00000000-0000-0000-0000-00000000dd01')\""
E=$(rb rh1); ok "RB1 切替の記録がある（効力が未来日でも）と、巻き戻しは中止。トリガー4本・関数・記録はそのまま" "$([ -n "$E" ] && [ "$(trg rh1)" = 4 ] && [ "$(q rh1 "select count(*) from pg_proc where proname in ('_hiring_lock','_billing_regime_active','admin_set_billing_regime')")" = 3 ] && [ "$(q rh1 "select count(*) from public.organization_billing_regime")" = 1 ] && echo 1)" "$E"
# 2) 案件ごとの判定の記録だけでも中止
mk rh2; $P "psql -q -d rh2 -c \"alter table public.hiring_process_billing_basis disable trigger trg_basis_append_only; insert into auth.users(id,email) values ('00000000-0000-0000-0000-00000000dd01','d@t'); insert into public.salon_organizations(id,name) values ('00000000-0000-0000-0000-0000000dd001','D'); insert into public.salon_stores(id,organization_id,store_name) values ('00000000-0000-0000-0000-0000000dd011','00000000-0000-0000-0000-0000000dd001','D1'); insert into public.store_hiring_processes(id,store_id,stylist_user_id,status,source) values ('00000000-0000-0000-0000-0000000dd021','00000000-0000-0000-0000-0000000dd011','00000000-0000-0000-0000-00000000dd01','contacting','interest'); insert into public.hiring_process_billing_basis(hiring_process_id,basis,reason,decided_by) values ('00000000-0000-0000-0000-0000000dd021','legacy','x','00000000-0000-0000-0000-00000000dd01')\""
E=$(rb rh2); ok "RB2 案件ごとの判定の記録だけがある場合も中止" "$([ -n "$E" ] && [ "$(trg rh2)" = 4 ] && echo 1)" "$E"
# 3) 切替後に有効な新採用料の行がある（効力が生じた会社）: 0064_effective_from.sh の後の状態で中止
$P "dropdb --if-exists rh3; createdb -T $BASE rh3"; for f in 0062_admin_billing.draft.sql 0063_company_location.draft.sql 0064_billing_regime_legacy_guard.draft.sql; do $P "psql -q -d rh3 -v ON_ERROR_STOP=1 -f $D/$f" >/dev/null 2>&1; done
$P "bash $D/0064_effective_from.sh rh3" 2>&1 | grep "===" | sed 's/^/   [準備] effective_from: /'
E=$(rb rh3); ok "RB3 切替後（記録あり・有効な新採用料の行あり）の巻き戻しは中止。二重請求防止のトリガーは残る" "$([ -n "$E" ] && [ "$(trg rh3)" = 4 ] && [ "$(q rh3 "select count(*) from public.admin_invoice_lines where fee_kind like 'hire%' and voided_at is null")" -ge 1 ] && echo 1)" "$E"
# 4) 切替後でも、停止（記録と二重請求防止を残す）は実行できる／再開できる
$P "psql -q -d rh3 -v ON_ERROR_STOP=1 -f $D/0064_suspend_keep_guard.draft.sql" >/dev/null 2>&1
ok "SU1 停止後: 切替の操作は誰も実行できない。トリガー・記録・状況確認は残る" "$([ "$(q rh3 "select count(*) from pg_proc p where proname in ('admin_set_billing_regime','admin_set_process_billing_basis') and (has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute'))")" = 0 ] && [ "$(trg rh3)" = 4 ] && [ "$(q rh3 "select count(*) from public.organization_billing_regime")" = 1 ] && [ "$(q rh3 "select has_function_privilege('authenticated','public.admin_billing_regime_status(uuid)','execute')")" = t ] && echo 1)"
$P "psql -q -d rh3 -v ON_ERROR_STOP=1 -f $D/0064_resume.draft.sql" >/dev/null 2>&1
ok "SU2 再開後: 切替の操作の実行権限が authenticated に戻る（anon/service_roleには戻らない）" "$([ "$(q rh3 "select count(*) from pg_proc p where proname in ('admin_set_billing_regime','admin_set_process_billing_basis') and has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute')")" = 2 ] && echo 1)"
# 5) 何も使っていない（記録も新採用料も無い）場合は、巻き戻せる。再実行しても失敗しない
mk rh5; E=$(rb rh5); E2=$(rb rh5)
ok "RB4 記録も新採用料も無ければ巻き戻せる（トリガー0本・関数なし）。再実行も失敗しない" "$([ -z "$E" ] && [ -z "$E2" ] && [ "$(trg rh5)" = 0 ] && [ "$(q rh5 "select count(*) from pg_proc where proname in ('_hiring_lock','_billing_regime_active','admin_set_billing_regime','_trg_hire_line_regime_guard')")" = 0 ] && echo 1)" "$E $E2"
echo "=== $pass PASS / $fail FAIL"
```


## 12. 追加した検証: 0064 同時実行

`0064_concurrency.sh`

```bash
#!/bin/bash
# 0064 同時実行テスト（ローカル検証用）。0062→0063→0064 を適用した、データを「コミット」する専用DBで実行する（本番では実行しない）。
# 使い方: bash 0064_concurrency.sh <DB名>
# 目的: 新方式の採用料の行と旧成功報酬の「存在確認・作成・方式変更」が、採用進行IDの共通ロックで直列化され、
#       どちらの順で同時に走っても「1つの採用に請求は1つだけ」になることを確認する。
DB=${1:-c64}
U=00000000-0000-0000-0000-00000000b
ADM=${U}001
X=00000000-0000-0000-0000-0000000b0a01; X1=00000000-0000-0000-0000-0000000b0b01
pass=0; fail=0
ok(){ if [ "$2" = "1" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 :: $3"; fail=$((fail+1)); fi; }
q(){ psql -X -At -d $DB -c "$1"; }
claims(){ echo "select set_config('request.jwt.claims','{\"sub\":\"$1\"}', false)"; }
# 先行/後続（運営者のRPC）
slow(){ psql -X -At -d $DB -v ON_ERROR_STOP=1 -c "begin" -c "set role authenticated" -c "$(claims $ADM)" -c "$1" -c "select pg_sleep(2)" -c "commit" >/dev/null 2>&1; }
fast(){ local t0=$(date +%s.%N); local o; o=$(psql -X -At -d $DB -v ON_ERROR_STOP=1 -c "set role authenticated" -c "$(claims $ADM)" -c "$1" 2>&1)
  local t1=$(date +%s.%N); ELAPSED=$(echo "$t1 - $t0" | bc)
  if echo "$o" | grep -q 'ERROR:'; then RES="ERR:$(echo "$o" | grep -m1 'ERROR:' | sed 's/^.*ERROR:  //')"; else RES=$(echo "$o" | tail -1); fi; }
# DB所有者として実行する版（採用成立の記録＝旧成功報酬の自動作成を起こす側。アプリの採用確定に相当）
slowsu(){ psql -X -At -d $DB -v ON_ERROR_STOP=1 -c "begin" -c "$1" -c "select pg_sleep(2)" -c "commit" >/dev/null 2>&1; }
fastsu(){ local t0=$(date +%s.%N); psql -X -At -d $DB -v ON_ERROR_STOP=1 -c "$1" >/dev/null 2>&1; local t1=$(date +%s.%N); ELAPSED=$(echo "$t1 - $t0" | bc); }
waited(){ [ "$(echo "$ELAPSED > 1.0" | bc)" = "1" ] && echo 1 || echo 0; }
P(){ echo "00000000-0000-0000-0000-0000000b6$(printf %03d $1)"; }
CS(){ echo "00000000-0000-0000-0000-0000000b7$(printf %03d $1)"; }
FEES(){ q "select count(*) from public.hiring_success_fees where hiring_process_id='$1' and fee_status not in ('cancelled','waived')"; }
LINES(){ q "select count(*) from public.admin_invoice_lines where hiring_process_id='$1' and fee_kind like 'hire%' and voided_at is null"; }

psql -X -q -d $DB <<SQL
insert into auth.users (id, email) select ('${U}' || lpad(g::text,3,'0'))::uuid, 'b'||g||'@t' from generate_series(1,30) g on conflict do nothing;
insert into public.platform_admins (user_id) values ('${ADM}') on conflict do nothing;
insert into public.salon_organizations (id, name) values ('$X','X社') on conflict do nothing;
insert into public.salon_stores (id, organization_id, store_name) values ('$X1','$X','X1') on conflict do nothing;
-- 切替前から進行中の案件（旧）: P1〜P4。切替後に始まる案件（新）は後で作る
insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source, created_at)
  select ('00000000-0000-0000-0000-0000000b6' || lpad(g::text,3,'0'))::uuid, '$X1', ('${U}' || lpad((10+g)::text,3,'0'))::uuid, 'contacting', 'interest', now() - interval '1 day' from generate_series(1,4) g;
SQL
psql -X -At -d $DB -c "set role authenticated" -c "$(claims $ADM)" -c "select public.admin_set_billing_regime('$X', now())" >/dev/null
sleep 1
# 切替後に始まる案件（新）: P5〜P8。見学案件も作る
psql -X -q -d $DB <<SQL
insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source)
  select ('00000000-0000-0000-0000-0000000b6' || lpad(g::text,3,'0'))::uuid, '$X1', ('${U}' || lpad((10+g)::text,3,'0'))::uuid, 'contacting', 'interest' from generate_series(5,8) g;
insert into public.admin_visit_cases (id, stylist_user_id, store_id, status, visit_confirmed_at, stylist_intent, salon_intent, hiring_decision, hiring_process_id)
  select ('00000000-0000-0000-0000-0000000b7' || lpad(g::text,3,'0'))::uuid, ('${U}' || lpad((10+g)::text,3,'0'))::uuid, '$X1', 'visit_confirmed', now(), 'interested','interested','offered',
         ('00000000-0000-0000-0000-0000000b6' || lpad(g::text,3,'0'))::uuid from generate_series(5,8) g;
SQL
newinv(){ psql -X -At -d $DB -c "set role authenticated" -c "$(claims $ADM)" -c "select public.admin_create_invoice('$X')" | tail -1; }

# K1: 新方式の採用料の作成（先行）→ 同時の採用成立（旧成功報酬の自動作成。後続）。旧成功報酬は作られず、採用の請求は採用料の1行だけ
I=$(newinv)
slow "select public.admin_add_fee_line('$I','hire_stylist','$(CS 5)')" & sleep 0.7
fastsu "update public.store_hiring_processes set status='hired', hired_at=now() where id='$(P 5)'"; wait
ok "K1 新採用料の作成→同時の採用成立: 後続は待たされ、この採用の請求は 採用料1行・旧成功報酬0件" "$([ "$(waited)" = 1 ] && [ "$(LINES $(P 5))" = 1 ] && [ "$(FEES $(P 5))" = 0 ] && echo 1)" "lines=$(LINES $(P 5)) fees=$(FEES $(P 5)) waited=$ELAPSED"
# K2: 採用成立（先行）→ 同時の新採用料の作成（後続）。後続は待たされ、結果は同じ（採用料1行・旧成功報酬0件）
I=$(newinv)
slowsu "update public.store_hiring_processes set status='hired', hired_at=now() where id='$(P 6)'" & sleep 0.7
fast "select public.admin_add_fee_line('$I','hire_stylist','$(CS 6)')"; wait
ok "K2 採用成立→同時の新採用料の作成: 後続は待たされ、採用料1行・旧成功報酬0件" "$([ "${RES#ERR:}" = "$RES" ] && [ "$(waited)" = 1 ] && [ "$(LINES $(P 6))" = 1 ] && [ "$(FEES $(P 6))" = 0 ] && echo 1)" "res=$RES lines=$(LINES $(P 6)) fees=$(FEES $(P 6))"
# K3: 旧の案件(P1)の採用成立で旧成功報酬が作られる（先行）→ 同時に、運営がその案件を新へ（後続）。後続は待たされ、作られた旧成功報酬を取消にして新へ移す
slowsu "update public.store_hiring_processes set status='hired', hired_at=now() where id='$(P 1)'" & sleep 0.7
fast "select public.admin_set_process_billing_basis('$(P 1)','new','同時実行テスト')"; wait
ok "K3 旧成功報酬の自動作成→同時の新方式への移行: 後続は待たされ、作られた旧成功報酬を取消にして新へ。有効な旧成功報酬は0件" "$([ "${RES#ERR:}" = "$RES" ] && [ "$(waited)" = 1 ] && [ "$(FEES $(P 1))" = 0 ] && [ "$(q "select basis from public.hiring_process_billing_basis where hiring_process_id='$(P 1)'")" = new ] && [ "$(q "select count(*) from public.hiring_success_fees where hiring_process_id='$(P 1)' and fee_status='cancelled'")" = 1 ] && echo 1)" "res=$RES fees=$(FEES $(P 1))"
# K4: 新方式への移行（先行）→ 同時の採用成立（後続）。旧成功報酬は作られない
slow "select public.admin_set_process_billing_basis('$(P 2)','new','同時実行テスト')" & sleep 0.7
fastsu "update public.store_hiring_processes set status='hired', hired_at=now() where id='$(P 2)'"; wait
ok "K4 新方式への移行→同時の採用成立: 後続は待たされ、旧成功報酬は作られない（0件）" "$([ "$(waited)" = 1 ] && [ "$(FEES $(P 2))" = 0 ] && [ "$(q "select count(*) from public.hiring_success_fees where hiring_process_id='$(P 2)'")" = 0 ] && echo 1)" "fees=$(FEES $(P 2)) waited=$ELAPSED"
# K5: 旧成功報酬の確定（先行）→ 同時の新方式への移行（後続）。後続は待たされ、確定済みなので拒否
q "update public.store_hiring_processes set status='hired', hired_at=now() where id='$(P 3)'" >/dev/null
slowsu "update public.hiring_success_fees set fee_status='confirmed', fee_amount=100000, tax_amount=10000, total_amount=110000, confirmed_at=now() where hiring_process_id='$(P 3)'" & sleep 0.7
fast "select public.admin_set_process_billing_basis('$(P 3)','new','同時実行テスト')"; wait
ok "K5 旧成功報酬の確定→同時の新方式への移行: 後続は待たされ『確定済み』で拒否。旧成功報酬は確定のまま" "$([ "$RES" = "ERR:success fee already progressed; cannot move to the new regime" ] && [ "$(waited)" = 1 ] && [ "$(q "select fee_status from public.hiring_success_fees where hiring_process_id='$(P 3)'")" = confirmed ] && [ "$(LINES $(P 3))" = 0 ] && echo 1)" "res=$RES"
# K6: 新採用料の作成の同時再送（同じ請求・同じ案件・同じ区分）。後続は先行を待ち、同じ行を返す。採用の請求は1行
I=$(newinv)
slow "select public.admin_add_fee_line('$I','hire_stylist','$(CS 7)')" & sleep 0.7
fast "select public.admin_add_fee_line('$I','hire_stylist','$(CS 7)')"; wait
ok "K6 新採用料作成の同時再送: 後続は待たされ、同じ行を返す。採用の請求は1行" "$([ "$RES" = "$(q "select id from public.admin_invoice_lines where visit_case_id='$(CS 7)' and fee_kind='hire_stylist' and voided_at is null")" ] && [ "$(waited)" = 1 ] && [ "$(LINES $(P 7))" = 1 ] && echo 1)" "res=$RES"
echo "=== $pass PASS / $fail FAIL"
```


## 13. 追加した検証: 未来日の切替の前後

`0064_effective_from.sh`

```bash
#!/bin/bash
# 0064 effective_from（未来日の切替）の前後検証（ローカル用）。コミットされるDBと実時間の待機（sleep）が必要なため、1トランザクションの検証SQLでは確認できない。
# 使い方: bash 0064_effective_from.sh <DB名>   ※0062→0063→0064適用済みの専用DB。本番では実行しない。
# 流れ: 切替を「約8秒後」の日時で記録 → 【切替の記録はあるが、効力は未発生】の判定を確認 → 待つ → 【効力発生後】の判定を確認。
DB=${1:-c64e}
U=00000000-0000-0000-0000-00000000b
ADM=${U}001; E=00000000-0000-0000-0000-0000000b0e01; E1=00000000-0000-0000-0000-0000000b0e11
pass=0; fail=0
ok(){ if [ "$2" = "1" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 :: $3"; fail=$((fail+1)); fi; }
pick(){ local o; o=$(cat); if echo "$o" | grep -q '^ERROR:'; then echo "$o" | grep -m1 '^ERROR:' | sed 's/^ERROR:  //'; else echo "$o" | grep -v '^$' | grep -v '^INSERT\|^UPDATE\|^SET' | tail -1; fi; }
q(){ psql -X -At -d $DB -c "$1" 2>&1 | pick; }
adm(){ psql -X -At -d $DB -v ON_ERROR_STOP=0 -c "set role authenticated" -c "select set_config('request.jwt.claims','{\"sub\":\"$ADM\"}', false)" -c "$1" 2>&1 | pick; }
MONTHLY="insert into public.stripe_checkout_records (organization_id, purpose, expected_amount, amount_excl_tax, tax_rate, tax_amount, total_amount, livemode, created_by_user_id, expires_at) values ('$E','monthly_subscription',110,100,10,10,110,false,'$ADM', now()+interval '1 hour') returning id"
PR(){ echo "00000000-0000-0000-0000-0000000be$(printf %03d $1)"; }
CSE(){ echo "00000000-0000-0000-0000-0000000bf$(printf %03d $1)"; }
FEES(){ q "select count(*) from public.hiring_success_fees where hiring_process_id='$1' and fee_status not in ('cancelled','waived')"; }

psql -X -q -d $DB <<SQL
insert into auth.users (id, email) select ('${U}' || lpad(g::text,3,'0'))::uuid, 'b'||g||'@t' from generate_series(1,30) g on conflict do nothing;
insert into public.platform_admins (user_id) values ('${ADM}') on conflict do nothing;
insert into public.salon_organizations (id, name) values ('$E','E社') on conflict do nothing;
insert into public.salon_stores (id, organization_id, store_name) values ('$E1','$E','E1') on conflict do nothing;
SQL
# 切替の記録（約8秒後に効力）。記録の「前」に始まった案件 P1
psql -X -q -d $DB -c "insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source) values ('$(PR 1)','$E1','${U}011','contacting','interest')"
sleep 1
R=$(adm "select public.admin_set_billing_regime('$E', now() + interval '8 seconds')")
EFF=$(q "select effective_from from public.organization_billing_regime where organization_id='$E'")
# 記録の後・効力の前に始まった案件 P2（見学案件も作る）
psql -X -q -d $DB <<SQL
insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source) values ('$(PR 2)','$E1','${U}012','contacting','interest'),('$(PR 3)','$E1','${U}013','contacting','interest');
insert into public.admin_visit_cases (id, stylist_user_id, store_id, status, visit_confirmed_at, stylist_intent, salon_intent, hiring_decision, hiring_process_id)
  select ('00000000-0000-0000-0000-0000000bf' || lpad(g::text,3,'0'))::uuid, ('${U}' || lpad((10+g)::text,3,'0'))::uuid, '$E1', 'visit_confirmed', now(), 'interested','interested','offered', ('00000000-0000-0000-0000-0000000be' || lpad(g::text,3,'0'))::uuid from generate_series(1,3) g
  on conflict do nothing;
SQL
INV=$(adm "select public.admin_create_invoice('$E')")
echo "--- 効力発生前（切替の記録はある。effective_from=$EFF）---"
ok "E1 効力発生前: 切替の記録があっても、新方式は効いていない（is_effective=false）" "$([ "$(q "select public._billing_regime_active('$E')")" = f ] && echo "$(adm "select public.admin_billing_regime_status('$E')")" | grep -q '"is_effective": false' && echo 1)"
ID=$(q "$MONTHLY"); ok "E2 効力発生前: 月額（旧）の決済開始は拒否されない（記録の存在だけで切り替えない）" "$([ "$(echo $ID | grep -cE '^[0-9a-f-]{36}$')" = 1 ] && echo 1)" "$ID"
q "update public.stripe_checkout_records set status='expired' where organization_id='$E'" >/dev/null
M=$(adm "select public.admin_add_fee_line('$INV','hire_stylist','$(CSE 2)')"); ok "E3 効力発生前: 新方式の採用料の行は作れない" "$([ "$M" = "organization is not on the new billing regime" ] && echo 1)" "$M"
M=$(adm "select public.admin_set_process_billing_basis('$(PR 2)','new','効力前の移行テスト')"); ok "E4 効力発生前: 案件を明示的に新へは移せない" "$([ "$M" = "organization is not on the new regime yet" ] && echo 1)" "$M"
q "update public.store_hiring_processes set status='hired', hired_at=now() where id='$(PR 2)'" >/dev/null
ok "E5 効力発生前に採用成立した案件(P2)は旧: 旧成功報酬が通常どおり作られる" "$([ "$(FEES $(PR 2))" = 1 ] && [ "$(q "select public._hiring_process_basis('$(PR 2)')")" = legacy ] && echo 1)"
echo "--- 待機（効力発生まで）---"
while [ "$(q "select now() < '$EFF'::timestamptz")" = t ]; do sleep 1; done; sleep 1
echo "--- 効力発生後 ---"
ok "E6 効力発生後: 新方式が効く（is_effective=true）" "$([ "$(q "select public._billing_regime_active('$E')")" = t ] && echo "$(adm "select public.admin_billing_regime_status('$E')")" | grep -q '"is_effective": true' && echo 1)"
ID=$(q "$MONTHLY"); ok "E7 効力発生後: 月額の決済開始は拒否される" "$(echo "$ID" | grep -q 'monthly subscription is not billed' && echo 1)" "$ID"
psql -X -q -d $DB -c "insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source) values ('$(PR 4)','$E1','${U}014','contacting','interest')"
ok "E8 切替の記録の前・効力の前に始まった案件(P1,P3)は旧のまま／効力後に始まった案件(P4)は新" "$([ "$(q "select public._hiring_process_basis('$(PR 1)')")" = legacy ] && [ "$(q "select public._hiring_process_basis('$(PR 3)')")" = legacy ] && [ "$(q "select public._hiring_process_basis('$(PR 4)')")" = new ] && echo 1)"
M=$(adm "select public.admin_add_fee_line('$INV','hire_stylist','$(CSE 3)')"); ok "E9 効力発生後でも、旧のままの案件(P3)には新採用料の行を作れない" "$([ "$M" = "hiring process is on the legacy billing basis" ] && echo 1)" "$M"
psql -X -q -d $DB -c "insert into public.admin_visit_cases (id, stylist_user_id, store_id, status, visit_confirmed_at, stylist_intent, salon_intent, hiring_decision, hiring_process_id) values ('$(CSE 4)','${U}014','$E1','visit_confirmed',now(),'interested','interested','offered','$(PR 4)')"
M=$(adm "select public.admin_add_fee_line('$INV','hire_stylist','$(CSE 4)')"); ok "E10 効力発生後: 新方式の案件(P4)には新採用料の行を作れる" "$(echo "$M" | grep -qE '^[0-9a-f-]{36}$' && echo 1)" "$M"
q "update public.store_hiring_processes set status='hired', hired_at=now() where id='$(PR 4)'" >/dev/null
ok "E11 効力発生後に始まった案件(P4)の採用成立: 旧成功報酬は作られない" "$([ "$(FEES $(PR 4))" = 0 ] && echo 1)"
M=$(adm "select public.admin_set_process_billing_basis('$(PR 3)','new','効力後の移行')"); ok "E12 効力発生後: 進行中で旧の案件(P3)を、運営が明示的に新へ移せる" "$(echo "$M" | grep -q '"basis": "new"' && echo 1)" "$M"
M=$(adm "select public.admin_set_process_billing_basis('$(PR 2)','new','確定済みの案件')"); q "update public.hiring_success_fees set fee_status='confirmed', fee_amount=1, tax_amount=0, total_amount=1, confirmed_at=now() where hiring_process_id='$(PR 2)'" >/dev/null
ok "E13 記録の存在だけでは変わらず、すでに作られた旧成功報酬(P2)は削除・書換えされない（行は残る）" "$([ "$(q "select count(*) from public.hiring_success_fees where hiring_process_id='$(PR 2)'")" = 1 ] && echo 1)" "$M"
echo "=== $pass PASS / $fail FAIL"
```


## 14. 追加した検証: 既定権限DBでの権限確認

`0062_0064_privilege_check.sh`

```bash
#!/bin/bash
# 0062・0063・0064 で【新しく作られた】全ての表・関数・シーケンスについて、実効権限を確認する（ローカル用）。
# 使い方: bash 0062_0064_privilege_check.sh <ベースDB(0061適用済み)> <作業DB名>
# 方式: 作業DBに「Supabaseの既定権限を模した設定（ALTER DEFAULT PRIVILEGES … TO anon, authenticated, service_role）」を先に入れてから 0062→0063→0064 を適用し、
#       ベースDBとの差分＝新設オブジェクトを自動で列挙して、PUBLIC/anon/authenticated/service_role それぞれの実効権限を数える。
BASE=${1:-b62}; DB=${2:-d64}; D=$(cd "$(dirname "$0")" && pwd)
su postgres -c "dropdb --if-exists $DB; createdb -T $BASE $DB"
su postgres -c "psql -q -d $DB" <<'SQL'
-- Supabase の既定: postgres が作る public のオブジェクトに、anon/authenticated/service_role へ全権限が自動付与される
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
SQL
for f in 0062_admin_billing.draft.sql 0063_company_location.draft.sql 0064_billing_regime_legacy_guard.draft.sql; do su postgres -c "psql -q -d $DB -v ON_ERROR_STOP=1 -f $D/$f" 2>&1 | tail -2; done
LIST="select 'T', c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','S') union all select 'F', p.oid::regprocedure::text from pg_proc p where p.pronamespace='public'::regnamespace"
su postgres -c "psql -At -d $BASE -c \"$LIST\"" | sort > /tmp/priv_base.txt
su postgres -c "psql -At -d $DB   -c \"$LIST\"" | sort > /tmp/priv_new.txt
comm -13 /tmp/priv_base.txt /tmp/priv_new.txt > /tmp/priv_added.txt
echo "新設オブジェクト: 表 $(grep -c '^T' /tmp/priv_added.txt) / 関数 $(grep -c '^F' /tmp/priv_added.txt)"
su postgres -c "psql -q -d $DB" <<'SQL'
create temp table added(kind text, name text);
SQL
{ echo "create table if not exists public._priv_added(kind text, name text);"; awk -F'|' '{gsub("\x27","\x27\x27",$2); printf "insert into public._priv_added values (\x27%s\x27,\x27%s\x27);\n",$1,$2}' /tmp/priv_added.txt; } | su postgres -c "psql -q -d $DB"
su postgres -c "psql -X -At -d $DB" <<'SQL'
-- 表: PUBLIC/anon/authenticated/service_role の、どの権限も無いこと（所有者以外のACLが空）
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' 新設の表(' || (select count(*) from public._priv_added where kind='T') || '件): 所有者以外にACLが一つも付いていない（PUBLIC/anon/authenticated/service_role を含む）' || coalesce(' :: ' || string_agg(name, ','), '')
  from (select distinct a.name from public._priv_added a join pg_class c on c.oid = ('public.' || quote_ident(a.name))::regclass, aclexplode(c.relacl) x where a.kind='T' and x.grantee <> c.relowner) z;
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' 新設の表: has_table_privilege が anon/authenticated/service_role すべて全権限で false' || coalesce(' :: ' || string_agg(name || ':' || ro, ','), '')
  from (select distinct a.name, ro from public._priv_added a cross join unnest(array['anon','authenticated','service_role']) ro, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pv
         where a.kind='T' and has_table_privilege(ro, ('public.' || quote_ident(a.name))::regclass, pv)) z;
-- 関数: 公開RPC=authenticatedだけ。内部=誰にも無い。PUBLIC(grantee 0) は常に無い
create or replace temp view f as select a.name, p.oid, p.proname, p.proowner, p.proacl from public._priv_added a join pg_proc p on p.oid = a.name::regprocedure where a.kind='F';
create or replace temp view pub as (select oid, proname from f where proname in ('admin_propose_quote','admin_withdraw_quote','admin_create_invoice','admin_add_fee_line','admin_add_registration_line','admin_void_line','admin_advance_invoice','company_list_quotes','company_respond_quote','billing_list_invoices','billing_begin_checkout','admin_correct_hire_line','admin_recalculate_registration_line','admin_flag_billing_case','admin_set_billing_regime','admin_set_process_billing_basis','admin_billing_regime_status','admin_get_organization_location','admin_set_organization_location','is_known_prefecture'));
select case when (select count(*) from pub) = (select count(*) from pub where has_function_privilege('authenticated', oid, 'EXECUTE') and not has_function_privilege('anon', oid, 'EXECUTE') and not has_function_privilege('service_role', oid, 'EXECUTE')) then 'PASS' else 'FAIL' end
  || ' 新設の公開RPC(' || (select count(*) from pub) || '本): authenticated のみ実行可（anon・service_role は不可）';
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' 新設の関数(' || (select count(*) from f) || '本)すべて: PUBLICへの実行権限が無い' || coalesce(' :: ' || string_agg(name, ','), '')
  from (select f.name from f, aclexplode(f.proacl) x where x.grantee = 0) z;
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' 新設の内部関数(公開RPC以外)は、anon/authenticated/service_role のどれにも実行権限が無い' || coalesce(' :: ' || string_agg(name, ','), '')
  from (select f.name from f where f.oid not in (select oid from pub) and (has_function_privilege('anon', f.oid, 'EXECUTE') or has_function_privilege('authenticated', f.oid, 'EXECUTE') or has_function_privilege('service_role', f.oid, 'EXECUTE'))) z;
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' 新設のシーケンスは無い（あれば権限の確認が別途必要）' from public._priv_added where kind='T' and name in (select relname from pg_class where relkind='S');
-- 参考: 既存の関数 get_admin_billing_integrity_issues（0040の再定義）の権限は、従来どおり authenticated のみ
select case when has_function_privilege('authenticated','public.get_admin_billing_integrity_issues()','EXECUTE') and not has_function_privilege('anon','public.get_admin_billing_integrity_issues()','EXECUTE') then 'PASS' else 'FAIL' end || ' 再定義した get_admin_billing_integrity_issues: authenticated のみ（anon不可）';
SQL
echo "--- 新設オブジェクトの一覧 ---"; cat /tmp/priv_added.txt | sed 's/^/  /' | cut -c1-110
```
