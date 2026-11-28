# 請求書PDF機能の再利用（実装済み・本番未適用）

## 再利用したもの
- PDF描画 `renderInvoicePdf`（日本語フォント・適格請求書の記載項目・振込先）、保存先バケット invoice-documents、取得時のSHA-256照合、発行事業者設定（/admin/issuer-settings）、請求先情報（会社ごと）、snapshot digest。
- 描画の変更は最小限: 明細に任意の `transaction_label` を追加（手動請求は「実施日」「入社予定日」。無ければ従来どおり「採用成立日」）。既存の成功報酬・月額のPDFは変わらない（テストで確認）。

## 追加したもの（0121・未適用）
- 表: manual_invoice_documents（1請求1通・発行後は変更/削除不可）、manual_invoice_document_events（発行・取得の監査）。
- RPC（責任者のみ）: admin_manual_invoice_pdf_readiness / _prepare / _register、取得の権限確認 authorize_manual_invoice_document_download（責任者、または対象会社の company_owner / company_admin）。
- アプリ: 請求詳細(/admin/manual-billing/[id])の「請求書PDFを発行」パネル、取得API /api/manual-invoices/[documentId]/pdf。

## 請求書番号
- 手動請求の番号は、成功報酬・月額と同じ全社共通カウンタ allocate_invoice_number で採番（0118を修正。別カウンタは廃止）。形式 BR-YYYY-NNNNNN。
- 念のため、作成時に既存の書類・成功報酬と同じ番号でないかを確認し、重なれば作成しない。PDF登録時にも同様に確認。全種類の番号の重複確認は事前/事後チェックSQLに含む。

## 発行を止める条件（DB）
発行事業者の名称・インボイス登録番号・住所、振込先5項目（銀行・支店・種別・口座番号・名義）、会社の請求先情報のいずれかが未設定、または請求が入金済み・取消済みなら、PDFを作らず保存もしない。画面に不足項目を日本語で表示。

## 未確認
本番の発行事業者設定・請求先情報が埋まっているか／実Storageへの保存・取得／PDFの実機での見た目（ローカルでpdftotextによる文字確認のみ）。
