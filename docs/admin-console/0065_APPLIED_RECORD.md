# 0065 本番適用の記録

記録日: 2026-11-15（日本時間）。**以下はユーザー（運営）からの報告に基づく記録です。Claude は本番DBに接続しておらず、本番での確認は未実施（報告内容の転記）です。**

## 適用した内容と結果
| 順 | 内容 | 結果（報告） |
|---|---|---|
| 1 | `0065_preapply_check.sql` | 実行済み（確認のうえ進行） |
| 2 | `0065_admin_billing_reads.draft.sql`（0065本体 v2・読み取り専用RPC 8本） | 実行成功 |
| 3 | `0065_postapply_check.sql` | **21 PASS / 0 FAIL / 9 INFO**。INFOは適用前と一致 |

適用したSQLの版: コミット `ab48003`。`0065_verify.sql` はローカル検証用で、本番では実行していません。

## 現在の状態
- 追加: `admin_billing_summary` / `admin_list_quotes` / `admin_list_invoices` / `admin_get_invoice` / `admin_list_billable_cases` / `admin_list_unresolved_billing_cases` / `company_billing_overview` / `company_get_invoice`（いずれも読み取り専用、authenticatedのみ実行可、一覧は limit/offset と総件数つき）。
- データの変更・料金方式の切替・請求・課金・メール送信は行っていません。アプリ側（運営画面・会社画面）はまだ呼んでいません。

## 問題が出たとき
`0065_rollback.draft.sql`（8関数のみを削除。データ・他の関数には影響しない）。
