# 実環境検証の手順書（検証環境 yegjxkstxhwrknshlaip／本番には触れない）
前提: 0116・0117・0118・0120・0121 適用済み・事後チェック合格。既存法人は区分未設定のまま維持。新規法人で通常10件・キャンペーン5件を試験。
禁止: 本番へのpush・DB適用・実請求（Stripeは必ずテストモード、メールは自分が管理する宛先のみ）。

## 0. 起動（検証用アプリ）
1. `cp scripts/verify-env/env.verification.example .env.verification.local` に値を入れる（Git管理外）。
2. Supabase Dashboard › Authentication › URL Configuration の Redirect URLs に `<NEXT_PUBLIC_SITE_URL>/auth/callback` を追加。
3. `set -a; . ./.env.verification.local; set +a; node scripts/verify-env/preflight.mjs` → 全行 OK（接続先が検証プロジェクトか・Stripeがテストキーか・本番ドメインでないかを確認。書き込みなし）。
4. `bash scripts/verify-env/start.sh`（ビルド→起動）。別ターミナルで `stripe listen --forward-to localhost:3000/api/stripe/webhook`（表示された whsec_ を設定→再起動）。
※ この作業環境（Claude側）は Supabase / Stripe に到達できないため、起動と画面操作はあなたのPC（または Vercel のプレビュー）で行い、結果を共有してください。

## 1. 責任者アカウント
検証用の責任者（platform_admins 登録済み）でログインできることを確認。以降「責任者」。

## 2. 新規法人: 本部発行・招待メール・登録区分（通常）
| 操作 | 期待結果 | 証拠 |
|---|---|---|
| /admin/salons/issue で 検証用メールA・サロン名・通常登録 を発行 | 発行履歴が issued、パスワード設定メールが届く | 画面＋受信メール |
| メールのリンク → パスワード設定 → ログイン | /update-password へ遷移し設定、ログインできる | |
| 初回のオンボーディングを完了（会社・店舗が作られる） | 登録区分=通常が結び付く（trigger） | SQL-A |
| 店舗のスカウト残高表示 | 未付与10件（残高10） | 画面 |
| 1件送信 | 初回10付与＋消費1＝残高9 | SQL-B |
## 3. 新規法人: キャンペーン
同様にメールB・キャンペーン登録で発行 → 残高表示5件 → 1件送信で残高4（SQL-B）。
## 4. 既存法人は未設定のまま
/admin/scout-ledger の一覧で既存法人の区分が「未設定」、残高28（購入分に期限）。送信1件で27、無料分から消費。
## 5. 一般登録の閉鎖（認証側）
1. /admin/salons/issue 上部「一般登録を閉じる」→ 確認。
2. 公開の /signup/salon が案内表示になる。
3. 公開キーで直接 `POST {SUPABASE_URL}/auth/v1/signup`（body: email, password, data:{role:"salon"}）→ **拒否**（"salon registration is by invitation only"）。※拒否されなかった場合は即中止し報告（検証用アカウントが作られてしまう）。
4. 同じ呼び出しで data:{role:"stylist"}（美容師）→ 成功すること（確認メールは自分宛）。
5. 既存サロンのログイン → 成功。招待済みのメールCで本部発行 → 成功。
## 6. 手動請求と請求書PDF
1. 見学・体験料の請求対象を用意（検証用データ）→ /admin/manual-billing で請求書を発行（税抜50,000／税込55,000）。
2. 発行事業者・振込先が未設定の状態で「請求書PDFを発行」→ 止まり、不足項目が表示される（Storageにファイルが無いこと）。
3. /admin/issuer-settings と会社の請求先情報を設定 → PDF発行 → 「PDFを確認」で開ける。会計担当が記載項目（登録番号・税率別税額・実施日・振込先）を確認。
4. 2回目の発行は拒否。会社 owner/admin で取得でき、他社では取得できない。
5. 請求書番号が既存と重複しない（SQL-C）。
6. 状態表示: 発行直後「請求済み（未入金）」→ 一部入金「請求済み（一部入金）」→ 全額「入金済み」。入金取消で戻る。過入金は拒否。
7. 手動請求中は同じ請求のカード決済が開始できない。採用料は自動請求OFFのまま（設定値を確認）。
## 7. Stripe テストモード
テストカード 4242 4242 4242 4242 で追加購入（10件・税込11,000円）→ 台帳に購入＋期限（1年後）。Webhook再送で二重付与されない（`stripe events resend`）。二重決済・金額不一致は自動返金されず「要確認」になる（/admin/stripe）。
## 8. 日次失効
`curl -H "Authorization: Bearer $CRON_SECRET" {SITE}/api/cron/scout-expiry` → 実行履歴が /admin/scout-ledger に出る。期限内なので失効0件。
## 9. 後始末
検証用の一般登録の閉鎖を元に戻す（必要なら）。検証用アカウント・法人は残す（初期化しない）。

## 証拠SQL（読み取り専用。SQL Editorで実行）
**SQL-A（区分の結び付き）**
select i.status, i.plan_code, o.name, r.plan_code as registered_plan, r.initial_grant from public.salon_account_issuances i left join public.salon_organizations o on o.id = i.organization_id left join public.organization_scout_registration r on r.organization_id = i.organization_id order by i.created_at desc limit 10;
**SQL-B（台帳）**
select o.name, e.entry_type, e.quantity, e.pool, e.created_at from public.scout_ledger_entries e join public.salon_organizations o on o.id = e.organization_id order by e.created_at desc limit 30;
**SQL-C（請求書番号の重複と手動請求）**
select 'dup' as k, count(*)::text from (select n from (select invoice_number n from public.invoice_documents union all select invoice_number from public.subscription_invoice_documents union all select invoice_number from public.hiring_success_fees where invoice_number is not null union all select invoice_no from public.manual_invoices) x group by n having count(*) > 1) y union all select m.invoice_no, m.status || ' ' || m.paid_total || '/' || m.total_amount from public.manual_invoices m order by 1;
**SQL-D（設定が変わっていない）**
select key, value from public.billing_settings where key in ('salon_card_required','auto_charge_enabled');  -- 両方 false
