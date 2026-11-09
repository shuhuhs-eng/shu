# Phase 54: Security / Production Hardening

最終監査（High・重要Medium）への対応。**0053 migration は未適用（local検証のみ）**。適用はユーザー承認後。

## 変更の要点
| 項目 | 内容 |
|---|---|
| A Bot対策 | Turnstileウィジェット（signup/login/reset/account-recovery）。Auth系はトークンを `captchaToken` としてSupabase Authへ渡し、検証はSupabase Auth CAPTCHAが行う。account-recoveryはサーバーがsiteverifyで検証。fail-closed。開発bypassは `BOT_PROTECTION_DEV_BYPASS=true` かつ NODE_ENV≠production のときだけ |
| A Rate limit | DBベースの共有レート制限（0053 `check_rate_limit`、service_role専用）。キーはSHA-256。IP単位＋メール単位。DB障害時はメモリ制限へ縮退。クライアントIPは `x-vercel-forwarded-for` → `x-real-ip` → `x-forwarded-for` の順 |
| B 旧RPC | `send_scout` / `create_salary_offer` / `set_salon_interest` を authenticated から revoke（定義は残す）。旧UI・旧Server Action・未使用コンポーネントを除去 |
| C cron | `/api/cron/cleanup-pending-diagnoses` を GET/POST 両対応（同じBearer認証）。`vercel.json` で毎日 03:00 JST。削除対象は期限切れ pending_diagnoses と古い rate_limit_counters のみ |
| D diagnosis_results | 直接INSERTを廃止（INSERT権限・ポリシー除去）。保存は認証済み本人の user_id と、サーバーが再計算した値を service role で INSERT |
| E env | 本番で必須env不足・localhost URL・Test/Live混在・DEV_BYPASS設定があれば起動失敗（全リクエスト500＋`[env]`ログ）。`getSiteUrl()` は本番で不正なら例外 |
| F grant | anon: 書き込み系・TRUNCATE等を全剥奪。authenticated: TRUNCATE/REFERENCES/TRIGGER 剥奪、INSERT/UPDATE/DELETE は salon_links(INSERT/DELETE) 以外すべて剥奪、シーケンス・トリガー関数のEXECUTE剥奪 |

## 人間がDashboardで行う設定（公開前）
1. Cloudflare Turnstile ウィジェット作成（ドメイン＝本番ドメイン）。サイトキー／シークレットキーを控える。
2. Supabase Dashboard > Authentication > Attack Protection > CAPTCHA を有効化（Turnstile、シークレット入力）。
3. `npm run verify:auth-captcha` が OK になることを確認。
4. Vercel の環境変数に `TURNSTILE_SECRET_KEY` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `CRON_SECRET` 等を設定（`.env.example` 参照）。`BOT_PROTECTION_DEV_BYPASS` は設定しない。
5. Vercel Cron は `CRON_SECRET` が設定されていれば `Authorization: Bearer` を自動付与する。
6. 0053 を（承認後）Supabase へ適用。

## 補足・既知の制限
- guest診断（未ログインの診断保存）はTurnstileを付けず、共有レート制限（IP単位30回/時）と32KBの上限で守る。pending_diagnoses は cron で期限削除。
- Supabase Auth CAPTCHA が Dashboard で無効だと、ブラウザからSupabase Authを直接叩く登録は防げない（アプリ側はトークン有無のみ確認）。必ず上記3で確認する。
- 新しいテーブルを作る将来のmigrationは、Supabaseの既定権限（anon/authenticatedにALL）を明示的にrevokeすること。
