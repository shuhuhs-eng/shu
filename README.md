# Beauty Reach

「才能を、多彩に評価する。」美容師×サロンのAI診断マッチングSaaS（開発中・Phase 5まで完了）。

美容師は30問の才能診断を受けると、6つの才能スコア・12タイプ・市場価値の参考値がわかります。サロンも14問の診断を受けられます。診断はルールベースで判定し、AIは解説・アドバイスの生成にのみ使用します。

## 現在の実装範囲

- 美容師／サロン共通の認証基盤（メール＋パスワード、メール確認、パスワード再設定）
- role（`stylist`/`salon`）に応じたオンボーディング・プロフィール登録・編集
- Supabase Auth / PostgreSQL / Storage、Row Level Security、SECURITY DEFINER RPCによる書き込み制御
- 診断ロジック（6才能スコア・12タイプ判定・市場価値算出・相性計算）とそのスナップショットテスト
- 未ログイン診断結果の会員アカウントへの引き継ぎ（`pending_diagnoses` → `diagnosis_results`）
- AI解説の非同期生成（`diagnosis_results.ai_status`）
- マイページ（美容師／サロン）

**未実装（今後のフェーズ）**：診断クイズ入力画面（30/14問フォームUI）、スカウト機能、美容師検索・マッチング一覧、求人機能。

## 技術スタック

- Next.js 15（App Router）／ React 19 ／ TypeScript
- Supabase（Auth・PostgreSQL・Storage）
- Tailwind CSS
- zod（バリデーション）

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

**重要**：`@supabase/ssr`・`@supabase/supabase-js`・`typescript`・`eslint`はキャレット（`^`）ではなく**固定バージョン**で指定しています（それぞれ`0.5.2` / `2.45.4` / `5.9.3` / `8.57.1`）。

- Supabase系：`@supabase/ssr@0.5.2`（0.x系＝pre-1.0）と、キャレット指定により解決される可能性のある新しい`@supabase/supabase-js`（例：2.112.2系）との間で型定義の非互換が確認されたため
- ESLint：`eslint`は`overrides`で依存ツリー全体を`8.57.1`に強制統一している。ただし実際の根本原因はバージョン統一ではなく、**Flat Config（`eslint.config.mjs`）とNext.js 15.0.3の`next lint`の非互換**だった。ESLint 8.xはプロジェクトルートに`eslint.config.mjs`が存在するだけで（環境変数の設定に関わらず）自動的にFlat Configモードへ切り替わるが、Next.js 15.0.3時点の`next lint`はESLintクラスをレガシー（eslintrcモード）のオプションで無条件に呼び出す実装のため、両者が衝突し`Invalid Options`エラーになる。このため**Flat Config（`eslint.config.mjs`）は廃止し、レガシー形式の`.eslintrc.json`を採用している**

過去に`npm install`を実行済みで、キャレット指定時代の`package-lock.json`や`node_modules`が残っている場合は、削除してから再インストールしてください。

```bash
rm -rf node_modules package-lock.json
npm install
npm list @supabase/supabase-js @supabase/ssr eslint  # 2.45.4 / 0.5.2 / 8.57.1 が解決されていることを確認
```

### 2. 環境変数の設定

```bash
cp .env.example .env.local
```

`.env.local` に実際の値を記入してください（`.env.example` には変数名のみで、実際のキー・シークレットは含まれていません）。

| 変数名 | 用途 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | SupabaseプロジェクトURL（ブラウザに公開可） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonキー（ブラウザに公開可） |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service roleキー（**サーバー専用**。RLSをバイパスするため厳重管理） |
| `ANTHROPIC_API_KEY` | AI解説生成用（**サーバー専用**） |
| `NEXT_PUBLIC_SITE_URL` | メール認証・パスワード再設定のリダイレクト先の基点 |
| `CRON_SECRET` | 期限切れ診断データ削除の定期実行エンドポイント認証用（**サーバー専用**） |

### 3. Supabaseマイグレーションの適用

`supabase/migrations/0001_init.sql` を対象のSupabaseプロジェクトへ適用してください。

```bash
supabase db push
```

または、Supabase Studio の SQL Editor で同ファイルの内容を実行してください。このマイグレーションには、テーブル定義・RLSポリシー・RPC（`save_stylist_profile` / `save_salon_profile` / `create_ai_output` / `activate_ai_output` / `start_pending_diagnosis_claim` / `complete_pending_diagnosis_claim` / `set_diagnosis_ai_status` / `cleanup_expired_pending_diagnoses` 等）・`handle_new_user` トリガー・`avatars` Storageバケット設定がすべて含まれています。

適用後、Supabase Auth側の設定（メール確認の有効化、Redirect URLsへの `{NEXT_PUBLIC_SITE_URL}/auth/callback` 追加、パスワードポリシーの設定 [8文字以上・英字必須・数字必須] ）も必要です。詳細は `docs/integration-test-plan.md` の「1. 実行前の環境チェック」を参照してください。

### 4. 開発サーバーの起動

```bash
npm run dev
```

`http://localhost:3000` を開いてください。

## 利用可能なコマンド

```bash
npm run dev              # 開発サーバー起動
npm run build             # 本番ビルド
npm run start              # 本番サーバー起動（build後）
npm run typecheck        # TypeScript型チェック
npm run lint                # ESLint
npm run verify:diagnosis # 診断ロジックのスナップショットテスト（旧ロジックとの一致率100%を確認）
npm run generate:golden  # 診断ロジック変更時のgolden再生成（意図的な変更をレビュー済みの場合のみ）
```

## プロジェクト構成

```
app/                      Next.js App Router
  (auth)/                 ログイン・新規登録・パスワード再設定（route group）
  auth/callback/           メール確認・パスワード再設定リンクのコールバック
  onboarding/               美容師オンボーディング（onboarding/salon/ はサロン版）
  profile/edit/            プロフィール編集（profile/edit/salon/ はサロン版）
  mypage/                    マイページ（role別に表示を分岐）
  api/diagnosis/guest/     未ログイン診断の一時保存API
  api/cron/                期限切れデータ削除の定期実行エンドポイント
components/                UIコンポーネント（auth/ profile/ salon-profile/ mypage/）
lib/
  diagnosis/                診断ロジック本体（6才能・12タイプ・市場価値・相性計算）
  diagnosis-handoff/       未ログイン診断結果のアカウントへの引き継ぎ
  auth/                       認証Server Actions・onboarding_step定数・遷移先判定
  profile/ salon/         プロフィール保存Server Actions
  supabase/                  Supabaseクライアント（server/client/middleware/service）
  validation/               zodバリデーションスキーマ
  storage/                    署名付きURL生成
  ai/                          AI解説生成（Anthropic API呼び出し）
types/database.ts        Supabase Database型定義（手書き）
supabase/migrations/      マイグレーションSQL（テーブル・RLS・RPC・トリガー・Storage設定）
scripts/                     診断ロジックのスナップショットテスト・golden生成
docs/integration-test-plan.md  Phase 5 受け入れテスト仕様書
```

## 設計上の重要な方針

- **判定はルールベースで固定、AIは解説・アドバイスの生成にのみ使用**（タイプ判定そのものはAIにさせない）
- **書き込みはRPC経由のみ**：`profiles`/`stylist_private`/`stylist_profiles`/`salon_profiles`/`user_settings`/`diagnosis_ai_outputs` への直接INSERT/UPDATE権限はクライアントに与えていません。すべてSECURITY DEFINER RPC経由で、所有権検証・トランザクション境界・エラーハンドリングを一元管理しています
- **`save_stylist_profile()` と `save_salon_profile()` は対称構造を維持する方針**（開発ルール）。保存先テーブル以外（avatar検証・トランザクション範囲・`profile_version`更新・`onboarding_step`更新・UPSERT戦略・エラーハンドリング）は完全に同一構造です。将来どちらかを変更する場合は、もう一方にも同じ変更が必要かを必ず確認してください（詳細は `supabase/migrations/0001_init.sql` 内の当該RPC直前のコメントを参照）
- **個人情報と公開情報の分離**：美容師の氏名・年代・性別は `stylist_private` に隔離し、サロンへ自動公開されません
- **診断ロジックのバージョニング**：`DIAGNOSIS_VERSION` と `GOLDEN_TEST_VERSION` を独立管理し、ロジック変更時は `npm run generate:golden` でスナップショットを更新します

## 既知の制約

- この開発環境ではネットワークが利用できなかったため、`npm install` 以降の実行確認はこのリポジトリの作成過程では行えていません。**必ずご自身の環境で `npm install && npm run typecheck && npm run lint && npm run build` を実行し、エラー0件を確認してからお使いください。**
- 診断クイズのフォーム画面（30/14問のUI）は未実装です。`lib/diagnosis` にロジックは揃っていますが、これを使って回答を入力する画面はまだありません。
- サロン・美容師間のスカウト機能、マッチング一覧、求人機能は未実装です。
- 詳細な受け入れテスト手順は `docs/integration-test-plan.md` を参照してください。
