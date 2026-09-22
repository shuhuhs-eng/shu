# Beauty Reach — Phase 5 完了判定のための統合テスト手順書

対象: 美容師/サロンの新規登録〜プロフィール保存〜マイページまでの一連のフロー（Phase 4後半＋Phase 5）。

## テスト実施情報

**テストを開始する前に、必ず記入してください。** この記入が無い実施結果は、どのコミット・どの環境に対する結果か追跡できないため無効とします。

| 項目 | 記入内容 |
|---|---|
| テスト対象コミット（Git SHA） | |
| テスト実施日 | |
| 実施者 | |
| アプリ環境（Local / Preview / Production） | |
| Supabaseプロジェクト名 | |
| ブラウザ・バージョン | |

複数回に分けて実施する場合（例: 1章を月曜、3章を火曜）は、実施日ごとに上記を分けて記録してください。コミットが途中で進んだ場合は、その時点から新しい行として記録し直してください。

## この文書の位置づけ

これまでの開発サイクルでは、実際のSupabase・ブラウザに接続できない作業環境の制約により、以下2種類の検証のみを行ってきました。

- **🟢 実行シミュレーション済み**：ロジックを実際にコードとしてimportして実行し、pass/failを確認したもの（`determinePostAuthPath`の9パターン、middlewareのパス判定16パターン、`save_stylist_profile`/`save_salon_profile`のupsert・avatar検証ロジック16パターン、`handle_new_user`のrole判定7パターン、診断ロジックのスナップショットテスト3000件）
- **🔵 コード精査のみ**：ファイルを読み、配線・ロジックを追跡して確認したもの（実行はしていない）

**いずれも、実際のPostgres（RLS・トリガー・制約・外部キー）、実際のSupabase Auth（メール送信・セッションCookie）、実際のブラウザ（フォーム送信・Storage APIの挙動）を通した検証ではありません。** 本手順書の各テスト項目には、それぞれ「🟢シミュレーション済み」「🔵コード精査のみ」「⚪実環境で初めて検証」のいずれかを明記しています。⚪の項目は、この手順書による実環境テストが最初の検証機会です。

この手順書を実環境（実際のSupabaseプロジェクト・実際のブラウザ）で最後まで実施し、その結果をもってPhase 5の完了を判定します。

### DB確認用SQLの原則

本手順書内でDB状態の**確認**に使うSQLは、原則として`SELECT`文のみとします。`UPDATE`/`DELETE`等の書き込みを伴う操作がテスト上どうしても必要な箇所（2.4・7-6）には、その都度以下3点を明記しています。これが無い`UPDATE`/`DELETE`は本手順書の範囲外であり、実施しないでください。

- **テストデータ専用**：対象を本手順書で作成したテストデータのみに限定する条件（IDやメールアドレスのパターン等）
- **実運用データでは実行しない**：本番の実ユーザーデータに対して同じ操作を行わないことの明記
- **復旧手順**：操作前の状態に戻す方法、または「復旧不可・削除前に確認結果を記録しておく」旨

---

## 1. 実行前の環境チェック

実環境テストを始める前に、以下がすべて整っていることを確認してください。1つでも欠けていると、以降のテストが正しい理由で失敗するか、誤った理由で失敗するかの切り分けができなくなります。

### 1.1 マイグレーション

| # | チェック項目 | 確認方法 | 期待結果 |
|---|---|---|---|
| 1.1.1 | `supabase/migrations/0001_init.sql` が対象プロジェクトに適用済み | `supabase db push`（またはSQL Editorで全文実行） | エラー無く完了 |
| 1.1.2 | 全テーブルが存在する | Supabase Studio → Table Editor | `profiles` `stylist_private` `stylist_profiles` `salon_profiles` `employee_size_master` `user_settings` `pending_diagnoses` `diagnosis_results` `diagnosis_ai_outputs` の9テーブル |
| 1.1.3 | 全enum型が存在する | SQL Editor: `select typname from pg_type where typtype='e';` | `user_role` `gender_type` `age_band` `employment_type` `job_change_intent` `salary_band` `diagnosis_mode` `profile_visibility` `ai_output_type` `pending_diagnosis_claim_status` `ai_generation_status` の11種 |
| 1.1.4 | `employee_size_master` に初期データが投入済み | SQL Editor: `select * from employee_size_master order by sort_order;` | `1_5` `6_15` `16_30` `31_plus` の4行、いずれも `is_active=true` |
| 1.1.5 | 全RPCが存在する | SQL Editor: `select proname from pg_proc where pronamespace='public'::regnamespace and prokind='f';` | `save_stylist_profile` `save_salon_profile` `validate_and_normalize_avatar_path` `create_ai_output` `activate_ai_output` `set_diagnosis_ai_status` `start_pending_diagnosis_claim` `complete_pending_diagnosis_claim` `cleanup_expired_pending_diagnoses` `handle_new_user` `set_updated_at` `enforce_ai_output_immutable_fields` の12個 |

### 1.2 RLS

| # | チェック項目 | 確認方法 | 期待結果 |
|---|---|---|---|
| 1.2.1 | 全テーブルでRLSが有効 | SQL Editor: `select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r';` | 対象9テーブルすべて `relrowsecurity = true` |
| 1.2.2 | `pending_diagnoses` にポリシーが一切無い | SQL Editor: `select policyname from pg_policies where tablename='pending_diagnoses';` | 0行（ポリシー無し＝RLS有効かつ全拒否） |
| 1.2.3 | 各テーブルのポリシーがSELECT系のみ（書き込みポリシー無し） | `select tablename, cmd from pg_policies where schemaname='public';` | `profiles` `stylist_private` `stylist_profiles` `salon_profiles` `user_settings` `diagnosis_ai_outputs` `employee_size_master` は `SELECT` のみ。`diagnosis_results` は `SELECT`+`INSERT` のみ |

### 1.3 RPC・テーブル権限（GRANT/REVOKE）

⚪ **この項目は今回のテストで初めて実環境検証します**（REVOKE/GRANT文はSQLとして書きましたが、実際にPostgres上で意図通り効いているかは未確認です）。

| # | チェック項目 | 確認方法 | 期待結果 |
|---|---|---|---|
| 1.3.1 | `save_stylist_profile`/`save_salon_profile`/`create_ai_output`/`activate_ai_output`/`start_pending_diagnosis_claim`/`complete_pending_diagnosis_claim`/`set_diagnosis_ai_status` の実行権限が `authenticated` のみ | SQL Editor: `select routine_name, grantee, privilege_type from information_schema.role_routine_grants where routine_schema='public';` | `grantee` に `anon` や `PUBLIC` が含まれない。`authenticated` のみ |
| 1.3.2 | `cleanup_expired_pending_diagnoses` に誰の実行権限も無い | 同上クエリで対象関数を確認 | 行が1件も無い（誰にもGRANTされていない） |
| 1.3.3 | `profiles`/`stylist_private`/`stylist_profiles`/`salon_profiles`/`user_settings` はSELECTのみGRANT | `select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee='authenticated';` | 対象テーブルは `SELECT` のみ（`INSERT`/`UPDATE`が無い） |
| 1.3.4 | `diagnosis_ai_outputs` はSELECTのみGRANT（INSERT/UPDATE無し） | 同上 | `SELECT` のみ |
| 1.3.5 | `diagnosis_results` はSELECT+INSERTのみ（UPDATE無し） | 同上 | `SELECT`,`INSERT` のみ |

### 1.4 Storage

| # | チェック項目 | 確認方法 | 期待結果 |
|---|---|---|---|
| 1.4.1 | `avatars` バケットが存在し非公開 | Supabase Studio → Storage | `public = false` |
| 1.4.2 | ファイルサイズ上限が設定されている | Storage → avatars → 設定 or `select * from storage.buckets where id='avatars';` | `file_size_limit = 5242880`（5MB） |
| 1.4.3 | 許可MIMEタイプが設定されている | 同上 | `allowed_mime_types = {image/jpeg,image/png,image/webp}` |
| 1.4.4 | `storage.objects` にRLSポリシーが4つ（select/insert/update/delete、いずれも本人フォルダ限定） | `select policyname, cmd from pg_policies where tablename='objects' and schemaname='storage';` | `avatars_select_own` `avatars_insert_own` `avatars_update_own` `avatars_delete_own` の4件 |

### 1.5 Supabase Auth設定

| # | チェック項目 | 確認方法 | 期待結果 |
|---|---|---|---|
| 1.5.1 | メール確認が必須になっている | Authentication → Providers → Email → "Confirm email" | ON |
| 1.5.2 | Site URLが設定されている | Authentication → URL Configuration → Site URL | 本番/検証環境のURL（例 `https://your-domain.com` またはローカルなら `http://localhost:3000`） |
| 1.5.3 | Redirect URLsに callback が許可されている | Authentication → URL Configuration → Redirect URLs | `{SITE_URL}/auth/callback` または `{SITE_URL}/auth/callback*` が含まれる |
| 1.5.4 | メールテンプレートが標準の `{{ .ConfirmationURL }}` を使用 | Authentication → Email Templates → Confirm signup / Reset password | デフォルトから変更していないこと（変更している場合は`code`パラメータが渡る形式か確認） |
| 1.5.5 | パスワードポリシーがアプリ側の検証条件と一致している | Authentication → Providers → Email → Password Requirements（または Auth → Policies） | 最小文字数8、英字(lowercase/uppercase)を要求、数字を要求。アプリ側（`lib/validation/auth.ts`のpasswordRule）と条件を揃えることで二重防御にする。ここが未設定でもアプリ側のzod検証で最低限は防げるが、API直叩き等のバイパスに備えてSupabase側の設定も必須とする |

### 1.6 環境変数（`.env.local`）

| # | 変数名 | 確認方法 | 期待結果 |
|---|---|---|---|
| 1.6.1 | `NEXT_PUBLIC_SUPABASE_URL` | ファイル確認 | 対象プロジェクトのURL |
| 1.6.2 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ファイル確認 | anonキーが設定済み |
| 1.6.3 | `SUPABASE_SERVICE_ROLE_KEY` | ファイル確認（**Gitにコミットされていないこと**も確認） | service roleキーが設定済み |
| 1.6.4 | `ANTHROPIC_API_KEY` | ファイル確認 | 有効なAPIキー |
| 1.6.5 | `NEXT_PUBLIC_SITE_URL` | ファイル確認 | 1.5.2のSite URLと一致 |
| 1.6.6 | `CRON_SECRET` | ファイル確認 | ランダムな文字列が設定済み（今回のフローでは未使用だが、cron検証を行う場合は必要） |

### 1.7 実行コマンド

| # | チェック項目 | コマンド | 期待結果 |
|---|---|---|---|
| 1.7.1 | 依存インストール | `npm install` | エラー無く完了 |
| 1.7.2 | 診断ロジックのパリティ | `npm run verify:diagnosis` | 3000件・一致率100%でPASS（🟢この項目のみ本環境でも既に実行検証済み。実環境でも再確認） |
| 1.7.3 | 型チェック | `npm run typecheck` | エラー0件 |
| 1.7.4 | Lint | `npm run lint` | エラー0件 |
| 1.7.5 | ビルド | `npm run build` | ビルド成功 |
| 1.7.6 | 開発サーバー起動 | `npm run dev` | `http://localhost:3000` にアクセス可能 |

**1.1〜1.7の全項目がPASS（該当しない場合はN/A）と判定できるまで、2章以降のテストには進まないでください。BLOCKEDの項目がある場合は、その要因を解消したうえで再試験し、PASSにしてから先へ進んでください。**

---

## 2. テストデータと事前準備

### 2.1 テストアカウント構成

| アカウントID | role | メールアドレス例 | 用途 |
|---|---|---|---|
| ST-1 | stylist | `qa-stylist-1@example.com` | 美容師フローのメインテスト（3章） |
| ST-2 | stylist | `qa-stylist-2@example.com` | 5章のクロスユーザーテスト（ST-1のデータを狙う側） |
| SA-1 | salon | `qa-salon-1@example.com` | サロンフローのメインテスト（4章） |
| SA-2 | salon | `qa-salon-2@example.com` | 5章のクロスユーザーテスト（SA-1のデータを狙う側） |

パスワードは全アカウント共通のテスト用パスワード（8文字以上）を1つ用意して使い回して構いません。実在しないメールアドレスでも、Supabaseのメール確認リンクは届く（開発中はSupabaseのログ／InbucketやMailtrap等のテストメーラー経由で確認）ため、`@example.com` 等のダミードメインではなく、実際に受信できるメールアドレス（+エイリアス、例: `you+qa-stylist-1@gmail.com`）を用意してください。

### 2.2 テスト画像の準備

| ファイル | 用途 | 想定サイズ・形式 |
|---|---|---|
| `avatar-ok.jpg` | 正常系アップロード | 500KB程度、JPEG |
| `avatar-ok.webp` | 正常系アップロード（差し替え用） | 500KB程度、WebP |
| `avatar-toolarge.jpg` | サイズ超過エラー確認 | 6MB以上、JPEG |
| `avatar-badtype.gif` | 形式エラー確認 | 任意サイズ、GIF（許可MIMEタイプ外） |
| `avatar-badtype.pdf` | 形式エラー確認 | 任意サイズ、PDF（拡張子偽装での確認用） |

### 2.3 権限確認用の準備（5章で使用）

- **Supabase Studio SQL Editor** への管理者アクセス（DB確認・直接クエリ実行用）
- **anonキーでのAPI直叩き用ツール**（curl・Postman・Insomnia等）。以下2種のリクエストが打てる状態にしておく。
  - `anon` キーのみ（未ログイン相当）でのREST API呼び出し
  - ST-1でログインして取得した `authenticated` セッションのアクセストークンでのREST API呼び出し（ST-2のデータを狙う）
- ブラウザのDevTools（Network・Application→Cookies）を開ける状態にしておく（`br_claim_token` Cookieの確認、リクエスト内容の確認に使用）

### 2.4 事前クリーンアップ

過去のテスト実行で作成されたテストアカウントが残っている場合は、Supabase Studio の Authentication → Users から削除する。

- **テストデータ専用**：削除対象は、2.1で定めたメールアドレスパターン（`qa-stylist-*@...` / `qa-salon-*@...`、または利用したエイリアス表記）に一致するアカウントのみとする。削除前に一覧のメールアドレスを目視で確認し、パターンに一致しないアカウントが混じっていないことを確認してから実行すること。
- **実運用データでは実行しない**：本番環境（アプリ環境＝Production）のSupabaseプロジェクトに対しては、このクリーンアップ手順を実行しない。実施するのは検証専用のSupabaseプロジェクト（Local/Preview）に限る。
- **復旧手順**：`auth.users`の削除は`profiles`以下（`stylist_private`/`stylist_profiles`/`salon_profiles`/`user_settings`/`diagnosis_results`等）へ`on delete cascade`で連鎖し、**復旧できない**。誤って対象外のアカウントを削除した場合、元に戻す手段は無いため、削除前に対象アカウントの一覧をスクリーンショット等で記録しておくこと。テスト用途のみのアカウントであれば、削除後は単純に2.1の手順で作り直せばよい。

---

## 3. 美容師フローの手動統合テスト

各テストの記録は8章の書式に従って残してください。

### 3-1. 新規登録

- **前提条件**：2.1のST-1がまだ作成されていない。ブラウザのCookieがクリアな状態。
- **操作手順**：
  1. `/` を開く
  2. 「美容師の方」カードをクリック（`/signup` へ遷移）
  3. 表示名「QAスタイリスト1」、ST-1のメールアドレス、パスワード、確認用パスワードを入力
  4. 「登録する」をクリック
- **画面上の期待結果**：「確認メールを送信しました」の成功バナーが表示され、フォームは消える。「ログイン画面へ」ボタンが表示される。
- **DB上の期待結果**：`auth.users` にST-1のユーザーが作成される。**メール確認前だが**、`handle_new_user()` トリガーは `auth.users` へのINSERT時点で発火するため、`profiles` に1行（`role='stylist'`, `onboarding_step=0`, `profile_version=1`）、`user_settings` に1行が既に作成されている。`stylist_private`/`stylist_profiles` はまだ0行（オンボーディング完了まで作成されない設計）。
- **失敗時に確認する箇所**：`lib/auth/actions.ts` の `performSignUp`／Supabase Authのメール送信設定（1.5.1）／`profiles` が作成されない場合は `handle_new_user()` トリガー自体（1.1.5・トリガー `on_auth_user_created` の存在）を確認。
- **検証区分**：⚪実環境で初めて検証（`signUpAction`の配線は🔵コード精査のみ）

### 3-2. メール確認

- **前提条件**：3-1完了、確認メールが受信できている。
- **操作手順**：
  1. 受信した確認メール内のリンクをクリック
- **画面上の期待結果**：`/auth/callback?code=...` を経由して `/onboarding` へ自動的にリダイレクトされる。
- **DB上の期待結果**：`auth.users.email_confirmed_at` にタイムスタンプが入る。`profiles.onboarding_step` はまだ `0`（このステップでは変化しない）。
- **失敗時に確認する箇所**：`app/auth/callback/route.ts`／Redirect URLs設定（1.5.3）／リンクの有効期限切れでないか。`/login?error=auth_callback_failed` に飛んだ場合はコード交換自体の失敗。
- **検証区分**：⚪実環境で初めて検証（`determinePostAuthPath`のrole/onboarding_step判定ロジック自体は🟢シミュレーション済み。ここで検証するのは「実際のメールリンク経由でこの関数まで正しくたどり着くか」という配線部分）

### 3-3. オンボーディング（プロフィール入力画面表示）

- **前提条件**：3-2完了、`/onboarding` が表示されている。
- **操作手順**：
  1. 画面の各セクション（公開プロフィール・個人情報・公開範囲/スカウト受信設定）が表示されていることを目視確認
- **画面上の期待結果**：公開名欄にサインアップ時の表示名「QAスタイリスト1」がプリフィルされている（`user_metadata.display_name` フォールバック）。他の項目は空。
- **DB上の期待結果**：変化なし（この時点ではまだ保存していない）。
- **失敗時に確認する箇所**：`app/onboarding/page.tsx`／`lib/profile/get-initial-values.ts` の `fallbackPublicName` 引数。
- **検証区分**：⚪実環境で初めて検証

### 3-4. プロフィール保存（オンボーディング完了）

- **前提条件**：3-3の画面が表示されている。
- **操作手順**：
  1. プロフィール画像として `avatar-ok.jpg` を選択
  2. 公開名・都道府県・経験年数・得意技術（1つ以上）・雇用形態・転職意欲・希望年収帯・氏名・年代・性別・公開範囲・スカウト受信設定をすべて入力
  3. 「プロフィールを保存して始める」をクリック
- **画面上の期待結果**：画像プレビューが表示された状態で保存が成功し、`/` へ自動遷移する。トップページのログイン状態バーに「マイページ」「プロフィール編集」「ログアウト」が表示される。
- **DB上の期待結果**：
  - `profiles.onboarding_step` が `4`（COMPLETE）になる
  - `profiles.profile_version` が `1→2` になる
  - `profiles.avatar_path` が `{ST-1のuser_id}/avatar.webp` になる
  - `stylist_private` に1行作成（`full_name`/`age_band`/`gender`が入力値通り）
  - `stylist_profiles` に1行作成（`public_name`等が入力値通り、`visibility`が選択値通り）
  - `user_settings.scout_enabled` が選択値通り
  - `storage.objects` に `avatars/{user_id}/avatar.webp` が1件存在し、`owner` がST-1のuser_id
- **失敗時に確認する箇所**：`lib/profile/actions.ts` の `saveProfileAction`／`save_stylist_profile` RPC（SQL Editorで直接 `select * from pg_proc where proname='save_stylist_profile';` して定義を確認）／Storageアップロード自体が失敗する場合は1.4のバケット設定。
- **検証区分**：⚪実環境で初めて検証（upsert・`profile_version`加算・`onboarding_step`更新の**ロジック自体**は🟢シミュレーション済み。ここで初めて検証するのは、実際のPostgresトランザクション・実際のStorageアップロード・実際のRLS/GRANTを通した end-to-end の成功）

### 3-5. プロフィール編集

- **前提条件**：3-4完了。
- **操作手順**：
  1. トップページの「プロフィール編集」をクリック（`/profile/edit`）
  2. 保存済みの値がすべてプリフィルされていることを確認
  3. 自己紹介文を変更し、画像を `avatar-ok.webp` に差し替える
  4. 「変更を保存」をクリック
- **画面上の期待結果**：ページ遷移せず、その場に「プロフィールを保存しました。」の成功バナーが表示される。画像プレビューが新しい画像に切り替わる。
- **DB上の期待結果**：
  - `profiles.profile_version` が `2→3` になる（保存のたびに必ず+1）
  - `profiles.onboarding_step` は `4` のまま変わらない（後退しない）
  - `stylist_profiles.bio` が新しい値に更新
  - `profiles.avatar_path` は変わらず `{user_id}/avatar.webp`（固定パス）だが、`storage.objects` の当該オブジェクトの内容（更新日時等）が更新されている
  - 旧画像を指すオブジェクトが別に残っていないこと（固定パス上書きのため元々1つしか無いが、念のため `storage.objects` を確認）
- **失敗時に確認する箇所**：同上3-4と同じRPC。編集時にリダイレクトしてしまう場合は `components/profile/profile-form.tsx` の `mode` 判定。
- **検証区分**：⚪実環境で初めて検証

### 3-6. ログアウト

- **前提条件**：3-5完了、ログイン状態。
- **操作手順**：
  1. 「ログアウト」をクリック
- **画面上の期待結果**：`/` へ遷移し、ログイン状態バーが消え、「美容師の方」「サロンの方」の入口カードが再表示される。
- **DB上の期待結果**：変化なし（`auth.users` のセッションのみ失効）。
- **失敗時に確認する箇所**：`lib/auth/actions.ts` の `signOutAction`。
- **検証区分**：⚪実環境で初めて検証

### 3-7. 再ログイン

- **前提条件**：3-6完了（ログアウト済み）。
- **操作手順**：
  1. `/login` を開き、ST-1のメールアドレス・パスワードでログイン
- **画面上の期待結果**：`/`（トップページ、ログイン状態バー付き）へ遷移する。**`/onboarding` へは遷移しない**（オンボーディング完了済みのため）。
- **DB上の期待結果**：変化なし。
- **失敗時に確認する箇所**：`determinePostAuthPath`（🟢ロジック自体は9パターンともシミュレーション済み。ここでは実際のログインセッション経由で正しく呼ばれるかを確認）。
- **検証区分**：⚪実環境で初めて検証

### 3-8. マイページ表示

- **前提条件**：3-7完了、ログイン中。まだ診断結果は無い状態。
- **操作手順**：
  1. 「マイページ」をクリック
- **画面上の期待結果**：「まだ診断結果がありません。」の空状態カードが表示される。サロン概要カードは表示されない（role=stylistのため）。
- **DB上の期待結果**：変化なし。
- **失敗時に確認する箇所**：`app/mypage/page.tsx` の `isSalon` 分岐。
- **検証区分**：⚪実環境で初めて検証（`DiagnosisSummary`がrole非依存であることは🔵コード精査で確認済み）

---

## 4. サロンフローの手動統合テスト

3章と同様の観点。差分がある箇所のみ詳しく記載します。

### 4-1. 新規登録

- **前提条件**：2.1のSA-1が未作成。
- **操作手順**：`/` →「サロンの方」カード →（`/signup/salon`）→ サロン名「QAサロン1」・SA-1のメール・パスワードを入力 →「登録する」
- **画面上の期待結果**：3-1と同様の成功バナー。
- **DB上の期待結果**：`profiles.role = 'salon'`（**ここが美容師と異なる唯一の分岐点**）、`onboarding_step=0`、`profile_version=1`。`salon_profiles` はまだ0行。`stylist_private`/`stylist_profiles` は作られない。
- **失敗時に確認する箇所**：`lib/auth/actions.ts` の `signUpSalonAction`→`performSignUp("salon",...)`。`role='stylist'`になってしまう場合は `handle_new_user()` の `raw_user_meta_data->>'role'` 読み取り部分（SQLで直接 `select raw_user_meta_data from auth.users where email='...';` して `role` キーが `"salon"` になっているか確認）。
- **検証区分**：⚪実環境で初めて検証（role解決ロジック自体は🟢シミュレーション済み・admin自己付与不可も確認済み）

### 4-2. メール確認

- 3-2と同様の手順。**期待結果の差分**：`/onboarding/salon` へリダイレクトされる（`/onboarding` ではない）。
- **検証区分**：⚪実環境で初めて検証

### 4-3. オンボーディング（画面表示）

- 3-3と同様。**期待結果の差分**：フィールドは「サロン名」「都道府県」「市区町村」「番地・建物名」「従業員数」「採用したい得意技術」「サロンのカルチャー・文化」「Instagram」「サロン紹介」「公開範囲」。個人情報セクション・スカウト受信設定は無い。
- 「従業員数」のセレクトボックスの選択肢が `employee_size_master` から取得した4件（1〜5名／6〜15名／16〜30名／31名以上）になっていることを確認（⚪ここは静的enumではなくDBマスタ参照のため、実環境で初めてクエリが正しく通るかを確認する箇所）。
- **検証区分**：⚪実環境で初めて検証

### 4-4. プロフィール保存

- 3-4と同様の手順。**DB上の期待結果の差分**：
  - `salon_profiles` に1行作成（`salon_name`/`prefecture`/`city`/`street_address`/`culture_description`/`employee_size_code`/`target_specialties`/`instagram_handle`/`bio`/`visibility`が入力値通り）
  - `stylist_private`/`stylist_profiles`/`user_settings.scout_enabled` は一切変化しない（サロン保存はこれらのテーブルに触れない設計）
  - `profiles.onboarding_step=4`、`profile_version`は`1→2`（美容師と完全に同じ更新ロジック）
- **検証区分**：⚪実環境で初めて検証

### 4-5. プロフィール編集

- 3-5と同様。`/profile/edit/salon` を使用。**期待結果の差分**：`salon_profiles`の値が更新され、`profiles.profile_version`が`2→3`になる。
- **検証区分**：⚪実環境で初めて検証

### 4-6. ログアウト／4-7. 再ログイン

- 3-6/3-7と同様。4-7の期待結果の差分：`determinePostAuthPath`が`role='salon'`かつ完了済みのため`/`へ（`/onboarding/salon`へは飛ばない）。
- **検証区分**：⚪実環境で初めて検証

### 4-8. マイページ表示

- **前提条件**：4-7完了、診断結果は無い状態。
- **操作手順**：「マイページ」をクリック
- **画面上の期待結果**：**「サロン概要」カード**（サロン名「QAサロン1」・都道府県+市区町村・従業員数ラベル・「編集」リンク）が最上部に表示され、その下に「まだ診断結果がありません。」が表示される。
- **DB上の期待結果**：変化なし。
- **失敗時に確認する箇所**：`app/mypage/page.tsx` の `salonSummary` 取得部分。従業員数ラベルが空の場合は `employee_size_master` への2段目クエリ（`employee_size_code`→`label`の解決）を確認。
- **検証区分**：⚪実環境で初めて検証

---

## 5. セキュリティ・権限テスト

**この章はすべて⚪実環境で初めて検証する項目です。** RLS・GRANT/REVOKEは実際のPostgresエンジンが評価するため、SQLとして正しく書けているかどうかと、実際に意図通り拒否されるかどうかは別問題です。

### 5-1. 他ユーザーのプロフィールデータ取得拒否

- **前提条件**：ST-1・ST-2ともログイン済みでオンボーディング完了。ST-1のアクセストークンを取得済み。
- **操作手順**：ST-1のトークンで、REST API経由（`GET {SUPABASE_URL}/rest/v1/stylist_profiles?user_id=eq.{ST-2のuser_id}`）にアクセス
- **画面上の期待結果**：（APIツールでの確認のためUI無し）
- **DB/API上の期待結果**：`200 OK`だが**結果は0行**（RLSのSELECTポリシーが`user_id = auth.uid()`のためST-2の行は返らない。エラーにはならず「見えない」形になる点に注意）
- **失敗時に確認する箇所**：`stylist_profiles_select_own`ポリシーの`using`句。
- **検証区分**：⚪実環境で初めて検証

### 5-2. 他ユーザーのプロフィールデータ直接更新拒否

- **前提条件**：5-1と同じ。
- **操作手順**：ST-1のトークンで、`PATCH {SUPABASE_URL}/rest/v1/stylist_profiles?user_id=eq.{ST-1自身のuser_id}` に任意の値を送信（**自分自身の行への直接UPDATE**を試みる）
- **期待結果**：**エラーになる**（`403`または`404`相当）。`stylist_profiles`には`UPDATE`のGRANT自体が無いため、RLSポリシー以前に権限エラーで拒否される。「自分の行だから通ってしまう」ことが無いのが正しい挙動（書き込みは`save_stylist_profile` RPC経由のみに限定する設計のため）。
- **失敗時に確認する箇所**：1.3.3のGRANT設定。もし成功してしまった場合は`revoke`文が実際に適用されていない可能性が高い（マイグレーション再適用漏れを疑う）。
- **検証区分**：⚪実環境で初めて検証（**最重要項目の1つ**：直接書き込み禁止という設計方針が実際に効いているかの根幹確認）

### 5-3. 他人のavatar_pathを指定した保存の拒否

- **前提条件**：ST-1・ST-2ともログイン済み。
- **操作手順**：ST-1でログインした状態で、SQL Editorから（または一時的にコードを書き換えて）`select public.save_stylist_profile(..., p_avatar_path := '{ST-2のuser_id}/avatar.webp')` を、`auth.uid()`がST-1になるロール（もしくはSQL Editorで`set local role authenticated; set local "request.jwt.claims" = '{"sub":"ST-1のuser_id"}';`のように擬似）で実行する。UIから行う場合は、ブラウザDevToolsでネットワークリクエストの`p_avatar_path`をST-2のパスに書き換えて再送信する。
- **画面上の期待結果**：保存失敗のエラー表示。
- **DB上の期待結果**：例外`invalid avatar path: must be under caller's own folder`が発生し、トランザクション全体がロールバックされる（`profiles.profile_version`等も変化しない）。
- **失敗時に確認する箇所**：`validate_and_normalize_avatar_path()`の`split_part`によるフォルダ一致チェック。
- **検証区分**：⚪実環境で初めて検証（🟢シミュレーションでは同等ロジックをJSで再現しPASSしているが、実Postgresでの`split_part`/`storage.objects`結合は未検証）

### 5-4. 実在しないavatar_pathを指定した保存の拒否

- **操作手順**：ST-1で、`p_avatar_path`に`{ST-1のuser_id}/does-not-exist.webp`（アップロードしていない架空のファイル名）を指定して保存を試みる。
- **期待結果**：例外`avatar object not found or not owned by caller`が発生し保存失敗。
- **検証区分**：⚪実環境で初めて検証

### 5-5. RPCの未認証・匿名実行拒否

- **操作手順**：`anon`キーのみ（ログインしていない状態）で、`POST {SUPABASE_URL}/rest/v1/rpc/save_stylist_profile` に任意のパラメータを送信
- **期待結果**：`401`または`403`相当のエラー（`anon`ロールにはEXECUTE権限が無いため、関数の中身が実行される前に拒否される）
- **失敗時に確認する箇所**：1.3.1の`revoke ... from anon`文。
- **検証区分**：⚪実環境で初めて検証

### 5-6. `diagnosis_ai_outputs` への直接INSERT拒否

- **操作手順**：ST-1のトークンで`POST {SUPABASE_URL}/rest/v1/diagnosis_ai_outputs`に、適当な`diagnosis_result_id`・`output_type`等を指定して直接INSERTを試みる
- **期待結果**：エラー（GRANTが無いため）。`create_ai_output`/`activate_ai_output` RPC経由以外での作成が一切できないことの確認。
- **検証区分**：⚪実環境で初めて検証

### 5-7. `pending_diagnoses` への直接アクセス拒否

- **操作手順**：ST-1のトークンで`GET {SUPABASE_URL}/rest/v1/pending_diagnoses`にアクセス
- **期待結果**：0行、またはエラー（RLS有効・ポリシー無しのため、`authenticated`ロールでも一切参照できない）
- **検証区分**：⚪実環境で初めて検証

### 5-8. `cleanup_expired_pending_diagnoses` の実行拒否

- **操作手順**：ST-1のトークン（`authenticated`）で`POST {SUPABASE_URL}/rest/v1/rpc/cleanup_expired_pending_diagnoses`を実行
- **期待結果**：エラー（誰にもGRANTしていないため、`authenticated`であっても拒否される）
- **検証区分**：⚪実環境で初めて検証

---

## 6. DB確認項目

各テスト完了時点での期待値一覧です。SQL Editorで以下のクエリを実行して目視確認してください。

```sql
-- profilesの状態確認
select id, role, onboarding_step, profile_version, avatar_path
from profiles
where id in ('{ST-1のuser_id}', '{SA-1のuser_id}');
```

| 列 | ST-1（美容師・3章完了後） | SA-1（サロン・4章完了後） |
|---|---|---|
| `role` | `stylist` | `salon` |
| `onboarding_step` | `4` | `4` |
| `profile_version` | `3`（初回保存+編集1回=+2、初期値1から） | `3`（同左） |
| `avatar_path` | `{ST-1のuser_id}/avatar.webp` | `{SA-1のuser_id}/avatar.webp` |

```sql
select * from stylist_private where user_id = '{ST-1のuser_id}';
select * from stylist_profiles where user_id = '{ST-1のuser_id}';
select * from salon_profiles where user_id = '{SA-1のuser_id}';
select * from user_settings where user_id in ('{ST-1のuser_id}', '{SA-1のuser_id}');
```

| テーブル | 期待される行数 | 備考 |
|---|---|---|
| `stylist_private`（ST-1） | 1行 | `full_name`/`age_band`/`gender`が3-4で入力した値と一致 |
| `stylist_profiles`（ST-1） | 1行 | `public_name`等が3-5の編集後の値になっている（最新値で上書きされている） |
| `salon_profiles`（SA-1） | 1行 | 同様に4-5の編集後の値 |
| `salon_profiles`（ST-1のuser_id） | **0行** | 美容師アカウントにはサロン用の行が作られないこと |
| `stylist_profiles`（SA-1のuser_id） | **0行** | サロンアカウントには美容師用の行が作られないこと |
| `user_settings`（両方） | 各1行 | `scout_enabled`はST-1のみ意味を持つ値（SA-1は既定値のまま） |

---

## 7. 異常系・再試行テスト

### 7-1. 入力エラー表示

- **前提条件**：`/onboarding`または`/onboarding/salon`表示中。
- **操作手順**：必須項目（公開名／サロン名）を空にしたまま送信。得意技術・採用したい得意技術を1つも選択せず送信。Instagramアカウントに絵文字を入力して送信。
- **画面上の期待結果**：各項目の直下にエラーメッセージ、フォーム上部にエラーバナーが表示される。ページ遷移しない。
- **DB上の期待結果**：変化なし（RPCが呼ばれる前にzodバリデーションで弾かれる）。
- **失敗時に確認する箇所**：`lib/validation/profile.ts`／`lib/validation/salon-profile.ts`。
- **検証区分**：⚪実環境で初めて検証

### 7-2. 通信失敗（保存中のネットワーク切断）

- **前提条件**：オンボーディングフォーム入力済み、送信直前。
- **操作手順**：DevTools → Network → Offline に切り替えてから「保存」をクリック。
- **画面上の期待結果**：エラーバナー「保存に失敗しました。しばらくしてから再度お試しください。」が表示される。フォームの入力値は保持されたまま。
- **DB上の期待結果**：変化なし、または一部のみ変化した場合は要注意（`save_*_profile`はトランザクションのため本来all-or-nothingのはず。**万一一部だけ反映されていたら重大な不具合として報告してください**）。
- **検証区分**：⚪実環境で初めて検証（トランザクション境界がロジック上正しいことは🔵コード精査済みだが、実際の接続断で本当にロールバックされるかは未検証）

### 7-3. アバター画像のサイズ超過・形式エラー

- **操作手順**：`avatar-toolarge.jpg`（6MB超）を選択。次に`avatar-badtype.gif`を選択。
- **画面上の期待結果**：クライアント側チェックで即座に「5MB以下の画像を選択してください。」「JPEG・PNG・WebP形式の画像を選択してください。」が表示される。
- **DB/Storage上の期待結果**：アップロードされない。
- **追加確認（重要）**：クライアント側チェックを迂回した場合（DevToolsでファイル選択のvalidationをスキップ、または`accept`属性を無視して直接アップロードAPIを叩く）に、**Storageバケット側の`file_size_limit`/`allowed_mime_types`で本当に拒否されるか**を確認してください。ここが1.4.2/1.4.3の実効性を確認する唯一の機会です。
- **検証区分**：⚪実環境で初めて検証

### 7-4. オンボーディング途中離脱

- **前提条件**：新規登録・メール確認済み、オンボーディング画面で一部入力したが保存していない状態。
- **操作手順**：ブラウザを閉じる。再度ログインする。
- **画面上の期待結果**：`/onboarding`（または`/onboarding/salon`）へ再度誘導される。入力途中のデータは保持されていない（初期値に戻る）。
- **DB上の期待結果**：`onboarding_step`は`0`のまま。`stylist_private`/`stylist_profiles`（または`salon_profiles`）は依然として0行。
- **失敗時に確認する箇所**：`determinePostAuthPath`が正しく未完了と判定し続けるか。
- **検証区分**：⚪実環境で初めて検証

### 7-5. 保存ボタンの二重クリック・重複保存

- **前提条件**：オンボーディングフォーム入力済み。
- **操作手順**：「保存」ボタンを素早く2回連続でクリックする。
- **画面上の期待結果**：1回目のクリックで送信中はボタンが無効化・入力欄がグレーアウトする（`PendingFieldset`）ため、2回目のクリックは実質的に無効。
- **DB上の期待結果**：`stylist_profiles`（`salon_profiles`）が2行にならず1行のまま（`user_id`が主キーのため）。`profile_version`が余分に加算されていないか確認（2回とも実際に処理された場合は+2される可能性があるため、UIの二重送信防止が効いているかがポイント）。
- **検証区分**：⚪実環境で初めて検証

### 7-6. 診断結果引き継ぎの再試行（`claim_status`のPROCESSING復旧）

これは、既存のPhase 4後半で実装した「claim済みだが`diagnosis_results`が存在しない状態を作らない」設計の実環境検証です。診断UI自体は未実装のため、`/api/diagnosis/guest`をAPIツールから直接叩いて疑似的に再現します。

「PROCESSINGのまま止まる」状態は、実際のネットワーク断のタイミングを狙って再現しようとすると再現性が低いため、**SQLで直接その状態を作る方法を主手順とします**。

- **前提条件**：ST-1でログイン済み。
- **操作手順**：
  1. （未ログイン相当のブラウザ／シークレットウィンドウで）`POST /api/diagnosis/guest` に `{"mode":"stylist","answers":[...]}`（30問分のダミー回答配列）を送信し、`br_claim_token` Cookieを取得する
  2. SQL Editorで、作成された行のIDを控える：`select id, claim_token, claim_status from pending_diagnoses order by created_at desc limit 1;` → `claim_status='PENDING'`であることを確認し、`id`の値をメモする（以降「対象ID」と呼ぶ）
  3. そのCookieを持つブラウザでST-1にログインする → 正常系では`claim_status`が`PROCESSING`を経て`COMPLETED`になり、`diagnosis_results`に1行作成される（このこと自体を先に確認する）
  4. **中断状態を人為的に作る**：新たに手順1〜2を繰り返してもう1つ`pending_diagnoses`行を作り（対象ID2とする）、以下のSQLを実行して`COMPLETED`手前の状態を再現する：
     ```sql
     -- テストデータ専用: 対象IDは手順4で自分がこのテストのために作成した行のみ。
     -- 実運用データでは実行しない: 本番環境のpending_diagnosesに対して絶対に実行しないこと。
     -- 復旧手順: この行はテスト目的の使い捨てデータであり「元に戻す」必要は無い。
     --           テスト終了後に不要であれば、次のDELETE文（同じく対象ID限定）で削除してよい。
     update pending_diagnoses
     set claim_status = 'PROCESSING', claimed_by = '{ST-1のuser_id}', claimed_at = now()
     where id = '{対象ID2}' and claim_status = 'PENDING';
     ```
  5. 対象ID2に対応する`br_claim_token`のCookieを持つブラウザ（手順4の元になったシークレットウィンドウ）で、再度ST-1としてログインする（一度ログアウトしてから再ログイン、またはページを再読み込みして`claimPendingDiagnosisIfPresent`が再度呼ばれる操作を行う）
- **画面上の期待結果**：手順5で処理が再試行され、最終的に`diagnosis_results`が1件だけ作成され`claim_status='COMPLETED'`になる。
- **DB上の期待結果**：`diagnosis_results`に対象ID2由来の行が重複なく1件だけ存在すること（`source_pending_id`のUNIQUE制約）。
- **失敗時に確認する箇所**：`lib/diagnosis-handoff/claim.ts`のCookie保持ロジック（途中失敗時はCookieを消さない設計になっているか）。
- **補助手順（任意・再現性重視でなくてもよい場合）**：手順4の代わりに、`complete_pending_diagnosis_claim`が呼ばれる直前でDevTools Offlineに切り替えてネットワークを切断し、実際のタイムアウトで`PROCESSING`のまま止まる状態を再現する方法でも検証可能。ただしタイミング調整が難しく再現性は低いため、まずは上記SQLベースの手順を実施すること。
- **検証区分**：⚪実環境で初めて検証（🟢状態遷移ロジック自体は21アサーションのシミュレーションでPASS済みだが、実Postgres・実Cookie・実ネットワーク断を用いた検証はこれが初めて）

---

## 8. 結果記録欄

各テスト項目について、以下の書式で記録してください。3〜7章の全項目分、この表を複製して埋めていくことを想定しています。

### 判定区分の定義

| 判定 | 定義 |
|---|---|
| **PASS** | 期待どおりの結果が得られた |
| **FAIL** | 不具合あり（画面上またはDB上の期待結果と異なる） |
| **BLOCKED** | 環境要因等（1章のチェック未達・前提条件を満たすテストが未実施・外部サービス障害等）で実施できなかった。**再試験が必要** |
| **N/A** | Phase 5の対象外、または現時点では実施不要（例: このサイクルでは対象アカウントを用意していない項目、将来フェーズで実装予定の機能に依存する項目） |

BLOCKEDとN/Aは混同しないでください。「本当は実施すべきだが今回はできなかった」はBLOCKED、「今回のPhase 5の範囲では実施する必要が無い」はN/Aです。判断に迷う場合はBLOCKED側に倒してください（N/Aと誤判定して見落とすことを防ぐため）。

| 項目 | 記入内容 |
|---|---|
| テストID | 例: 3-4 |
| 項目名 | 例: プロフィール保存（オンボーディング完了） |
| 検証区分 | 🟢シミュレーション済み / 🔵コード精査のみ / ⚪実環境で初めて検証 |
| 結果 | PASS / FAIL / BLOCKED / N/A |
| BLOCKED・N/Aの理由 | BLOCKEDまたはN/Aの場合、その理由を具体的に記載（例: 「Supabase側のメール送信が遅延し10分待っても届かずBLOCKED」「Local環境のみで実施予定のためProduction環境ではN/A」） |
| 実施日時 | |
| 実施者 | |
| 実測結果 | 実際に画面に表示された内容・エラーメッセージ等を具体的に記載 |
| スクリーンショット | 添付ファイル名またはリンク |
| DB確認結果 | 実行した`SELECT`文と結果を貼り付け（本文冒頭「DB確認用SQLの原則」を参照。書き込みを伴うSQLを実行した場合は、その文と3点の注記の遵守を明記） |
| 再現手順（FAIL時のみ） | 何度も再現するか、再現に必要な操作を具体的に |
| 関連ログ（FAIL時のみ） | ブラウザConsole／Next.jsサーバーログ／Supabase Logs の該当箇所 |

### 8.1 サマリー表（全項目終了後に集計）

| 章 | 総項目数 | PASS | FAIL | BLOCKED | N/A |
|---|---|---|---|---|---|
| 1. 環境チェック | 21 | | | | |
| 3. 美容師フロー | 8 | | | | |
| 4. サロンフロー | 8 | | | | |
| 5. セキュリティ・権限 | 8 | | | | |
| 7. 異常系・再試行 | 6 | | | | |
| **合計** | **51** | | | | |

集計時のチェック式：各行について「PASS＋FAIL＋BLOCKED＋N/A ＝ 総項目数」となっていることを確認してください（漏れなく判定されているかの検算）。

### 8.2 完了判定基準

- **BLOCKEDは未完了扱いとします。** 該当項目について、原因を解消したうえで再試験を実施し、PASSまたはFAILの判定が確定するまで、その項目はPhase 5完了の判定対象として残り続けます（放置してN/A扱いにすることはできません）。
- **N/Aは対象外として扱います。** 8.1の集計・完了判定のいずれにおいても分母から除外し、Phase 5の完了可否には影響しません。
- 1章（環境チェック）は**PASS＋N/A＝総項目数（BLOCKED・FAILが無いこと）が必須**
- 3・4章（美容師/サロンフロー）は**PASS＋N/A＝総項目数が必須**（このフェーズでN/Aとなる項目は基本的に無い想定だが、環境上どうしても実施できない場合はBLOCKEDとして扱い、除外しない）
- 5章（セキュリティ・権限）は**PASS＋N/A＝総項目数が必須**（1つでもFAILがある場合、権限設計に実装ミスがある可能性が高く、Phase 5は完了と判定しない）
- 7章（異常系・再試行）でFAILがあった場合は内容により判断（軽微なUI表示の問題か、データ整合性に関わる問題かを区別する）。BLOCKEDが残っている場合は7章も再試験が必要。

**この判定基準に基づき、実施結果一式（8章の記録＋テスト実施情報）をご共有いただければ、Phase 5完了の可否を確認します。**
