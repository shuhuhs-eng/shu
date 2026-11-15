# 0070 レビュー資料（草案・未適用）

本番適用・commit・pushはレビュー後。0058・0059は別件のまま。0065は適用済み（再適用しない）。

## 1. ファイル（実行順）
| 順 | ファイル | 内容 |
|---|---|---|
| 1 | `0070_preapply_check.sql` | 適用前チェック（SELECT1文・結果表1つ）。**対象件数はここで確認** |
| 2 | `0070_stylist_profile_public.draft.sql` | 本体（1トランザクション） |
| 3 | `0070_postapply_check.sql` | 適用後チェック（結果表1つ） |
| - | `0070_rollback.draft.sql` | 巻き戻し（運用開始前の完全な取り消し）。**安全装置あり**（下記） |
| - | `0070_suspend_keep_data.sql` / `0070_public_extended_resume.sql` | 運用開始後の停止（データを残す）／追加表示の再開 |
| - | `0070_salary_offer_resume.sql` / `0070_salary_offer_pause.sql` | 給与提示の再開（承認後・確認行を有効にしないと動かない）／再停止 |
| - | `0070_verify.sql` / `0070_verify.sh` / `0070_lifecycle_check.sh` / `0070_fixture.sql` | ローカル検証用（本番では実行しない） |

### 巻き戻し・停止・再開の使い分け
- **巻き戻し**: 次のどちらかに当てはまるときは、**何も変更せずに中止**（例外でトランザクション全体が取り消し）。①生年月日が1件でも登録されている ②移行したスカウト設定が、移行後に変更されている（`updated_at` が移行時刻より新しい、または false に戻っている。メール設定などの変更でも中止＝安全側）。中止されたら停止手順を使う。
- **給与提示の停止は、巻き戻しでも外さない**（不用意に再開しない）。外すのは `0070_salary_offer_resume.sql` だけで、承認のうえ冒頭の確認行のコメントを外さないと実行できない。アプリ側の停止（環境変数）も別途解除が必要。
- **停止（データを残す）**: 公開プロフィールの追加表示フラグ（`feature_pauses.stylist_public_extended`）を「停止」にするだけ。一覧関数は従来の項目だけを返し、画像も読めなくなる。生年月日の列と値・生年月日保存関数・スカウト設定と退避表・給与提示の停止は残す。再開は `0070_public_extended_resume.sql`（本人が変更済みのスカウト設定は再移行しない）。
- **本人プレビューとの一致**: プレビューは「生年月日の列があるか」ではなく、DBの判定関数 `get_stylist_public_extended_enabled()`（＝上のフラグ）で追加表示の有無を決める。停止中は、サロンにもプレビューにも従来の項目だけが出る。関数が存在しない（0070未適用）ときだけ従来表示へ切り替え、権限・通信エラーはエラー表示。
- **SQLエディタで実行できる形**: 巻き戻し・停止・再開・本体・チェックのすべてで、psql専用の `\` コマンド（`\set ON_ERROR_STOP on` など）を使っていない。ローカル検証もファイル全文を1つのクエリとして送る方法（SQLエディタと同じ）で実施。巻き戻しの中止条件は例外で止まり、残りは実行されず全体が取り消される。

## 2. 変更内容と対象
| # | 変更 | 影響 |
|---|---|---|
| 1 | `stylist_private.birth_date date`（NULL可）追加。`set_stylist_birth_date(date)` 新設（本人のみ・15〜100歳・未来日不可・NULLで未登録へ）。`stylist_age_years(date)` 新設（内部用・クライアントから実行不可） | 既存会員は全員NULL＝未登録（年代から推測しない） |
| 2 | `get_public_stylists_for_scout()` を再作成（引数・戻り値型・絞り込み・並び順は従来どおり）。返却に `avatar_path / employment_type / instagram_handle / value_priorities / age` を追加 | 氏名・性別・年代・生年月日・希望年収・SNS生データは返さない |
| 3 | storageポリシー `avatars_select_public_stylist_for_salon` ＋ 補助関数 `salon_can_view_stylist_avatar(text)` | サロンが読めるのは「visibility=PUBLICの美容師の、現在のプロフィール画像1枚（profiles.avatar_path一致）」だけ。差し替え前の古い画像・非公開の人の画像は読めない。既存のavatarポリシーは無変更 |
| 4 | スカウト統一: 美容師ロールを持ち `scout_enabled=false` のアカウントを `true` に。対象 user_id は退避表 `scout_optout_migration_0070` に記録 | 変更列は scout_enabled のみ。notify_email・visibility・scout_prefs は不変。サロンのみのアカウントは対象外 |
| 0 | 機能フラグ表 `feature_pauses`（`stylist_public_extended`＝追加表示、`salary_offer_presentation`＝給与提示）と判定関数 `stylist_public_extended_enabled()`（内部）・`get_stylist_public_extended_enabled()`（本人のプレビュー用）を新設。一覧関数・画像ポリシー補助関数がこのフラグを参照 | 停止＝フラグ1行の更新。行が無い場合は無効（安全側） |
| 5 | 給与提示のDB停止: `feature_pauses` 表＋`salary_offers` の BEFORE INSERT トリガー | 下記 |

### 給与提示の停止範囲
- 止める: `salary_offers` への**新規INSERT全般**（`create_salary_offer_v2`、旧 `create_salary_offer`、将来追加される関数、service_role直接INSERTを含む）。エラー: `salary offer presentation is currently paused`。
- 止めない: 既存行の保持・閲覧、`respond_salary_offer`（美容師の承諾・辞退などの更新）、通知。
- フラグ行が無い場合も停止（安全側）。再開: `update public.feature_pauses set paused=false where feature='salary_offer_presentation';`（運営がSQLで実行。アプリ・利用者からは読み書き不可）。
- 対象関数: `public.create_salary_offer_v2(uuid,uuid,integer,integer,integer,text,text)`（authenticated実行可）、`public.create_salary_offer(...)`（0053で実行権は剥奪済み）。両関数の本文は変更しない。

### 触らないもの
`save_stylist_profile`（定義md5が適用前後で一致）、診断・マッチング計算、visibilityの値（LIMITED はそのまま）、`send_scout`/`send_scout_v2`、`respond_salary_offer`、既存の提示行。

## 3. 権限（既定権限に依存せず、明示）
すべての新設・再作成関数で「public・anon・authenticated・service_role から全て外す → 必要な関数だけ authenticated に付与」を明示（Supabase の既定権限で anon・authenticated・service_role に実行権が付く環境でも効く）。
| 関数 | authenticated | anon / service_role / PUBLIC |
|---|---|---|
| `set_stylist_birth_date`（本人の行のみ） | 実行可 | 不可 |
| `get_public_stylists_for_scout`（サロンロールのみ関数内で判定） | 実行可 | 不可 |
| `salon_can_view_stylist_avatar`（storageポリシーから呼ぶ） | 実行可 | 不可 |
| `get_stylist_public_extended_enabled`（本人のプレビュー用） | 実行可 | 不可 |
| `stylist_public_extended_enabled` / `stylist_age_years` / `block_salary_offer_insert_when_paused`（内部） | 不可 | 不可 |
| 表 `feature_pauses` / `scout_optout_migration_0070` | 不可 | 不可（RLS有効・GRANTなし） |
| `stylist_private`（birth_date含む） | SELECTのみ（RLSで本人の行のみ） | - |
**検証**: ローカルDBに Supabase 相当の既定権限（anon・authenticated・service_role へ関数の実行権を既定付与）を設定したうえで、aclexplode による実効権限の一覧が上の表と完全一致することを検証（検証F3・適用後チェック16）。service_role の revoke を1か所外した改変版を適用して、チェックが FAIL になることも確認。

## 4. 移行対象件数（本番は**適用前チェックで確認**）
本番のデータをClaudeは見られません。ローカルの仮データでは対象2件（美容師s4・美容師兼サロンs5）、対象外1件（サロンのみ）でした。本番の件数は `0070_preapply_check.sql` の行4〜7、9で確認してください:
- 行4: scout_enabled=false の美容師ロール（＝変更される件数）／行5: うち美容師＋サロン両ロール
- 行6・7: 全体と、美容師ロールなし（変更されない件数）
- 行9: LIMITED の件数（変更しない。保存時にアプリがPRIVATEにする）

## 5. ローカル検証結果（修正版）
PostgreSQL 16、0061適用済みスキーマの複製に仮データ（会社・店舗・実績プロフィール・Interest を含む）を投入して実施。
- 適用前チェック15行／本体適用／検証 **63項目 PASS・0 FAIL**／適用後チェック（PASS 12・INFO 6・FAIL 0・総合判定 PASS）／手順確認 **40項目 PASS・0 FAIL**。
- 適用後チェックは level（PASS / FAIL / INFO）と最終行の総合判定に整理。**適用前と人が比較する値（退避表の件数・visibility内訳・給与提示の件数・save_stylist_profile の定義md5 など）は INFO** とし、成功扱いにしない。未適用のDBで実行するとエラーではなく総合判定 FAIL になることも確認。
- **給与提示（新旧RPC）**: 前提（会社所有者・店舗アクセス・Interest済み・検証済みの実績プロフィール）を満たした呼び出しが、停止フラグを解除すると**成功する**こと（G1: `create_salary_offer_v2`、G2: 旧 `create_salary_offer`）を先に示したうえで、停止中は**停止メッセージ（`salary offer presentation is currently paused`）と完全一致**で拒否されること（G3・G4）、拒否分は保存されないこと（G5）を確認。店舗未登録など別のエラーは拒否に数えない（G6は対照）。
- 手順確認: 巻き戻しが、生年月日あり／移行後のスカウト設定変更あり（メール設定の変更でも）で**何も変えずに中止**／何も使われていなければ巻き戻せて**給与提示の停止は残る**／停止手順でデータ（生年月日・退避表・本人が変えた設定）を残す／本体の再実行で追加項目が戻り本人変更を上書きしない／給与提示の再開は確認行なしでは拒否される・有効化で再開・再停止できる。
- 検証の主な内容（DB）: 既存会員の生年月日が全員NULL／本人のみ閲覧・直接UPDATE不可／範囲外・未来日の拒否／満年齢の境界／一覧に氏名・性別・年代・生年月日・年収・SNS生データが含まれない／非公開にすると一覧・画像・年齢が出ない／サロン以外・anonは一覧不可／古い画像と非公開者の画像は読めない／既存の受信拒否の移行対象が美容師のみ・notify_emailとvisibility不変／`save_stylist_profile` 定義が不変／権限（anon・service_role含む）。
### 検証の限界（正直に）
- ローカルのstorageはスタブです。本物のSupabase Storage経由の署名URL発行（`createSignedUrls`）が通ることは**未確認**（ポリシーとSQLの判定のみ確認）。
- 公開／非公開が保存・再読み込み後も維持されること、画面からの保存→サロン側表示の一致は、**実Supabaseでの確認事項として残っています（未確認）**。

## 6. アプリ側（DB未適用でも壊れない作り）
- **未対応と判定するのは「生年月日の列が存在しない」エラー（PostgreSQL 42703 / PostgREST PGRST204）だけ**。権限・通信・その他のエラーは未対応扱いにせず、入力欄は出さず保存でも生年月日を変更せず、画面にエラーを表示（プレビューはエラー画面）。
- 生年月日の入力欄・プレビューの追加項目は、DBが生年月日に対応しているとき（列を読めるとき）だけ表示。未適用のDBでは従来どおり。
- サロン側カードは、RPCの返却に `employment_type` キーがあるときだけ追加項目を表示。
- プロフィール保存は `save_stylist_profile` を従来どおり呼び（希望年収・SNS・スカウト設定は保存済みの値を引き継ぐ）、生年月日だけ別RPCで保存。


## 追記（最新）
- 巻き戻しは、中止判定の前に対象表をロックする（同時保存から保護。待ち上限15秒）。0071適用済みなら0070単独の巻き戻しは拒否。適用順は 0070→0071 固定。
- 公開判定 `stylist_salon_publishable` とフラグ `minor_salon_public`（既定=保留）を追加済み。停止・再開SQLはこのフラグに触れない。
- 検証一式の実行方法・前提: `docs/verify-0070-0071/README_VERIFY.md`


## 追記（最新・年齢の確定方針）
- **以前の記載のうち、生年月日が任意入力・未登録の既存会員は従来どおり表示・年齢は「未登録」とする部分は撤回**。現在の仕様は `0070_age_policy.md`（必須登録／表示方法を本人が選択／店舗単位の実年齢開示依頼／公開判定は正確な満年齢で別判定／既存会員は登録まで保留）。
- `get_public_stylists_for_scout` は `(p_store_id uuid default null)` に変更（旧・引数なしは削除して置き換え。返却に年齢情報 `age_display_mode / age_decade / age（許可時のみキーが存在）/ age_request_status` を追加。生年月日は返さない）。
- 新設: `age_disclosure_requests`、`request_stylist_age_disclosure`、`respond_age_disclosure_request`、`get_my_age_disclosure_requests`、`get_store_stylist_age_infos`、`set_stylist_age_display_mode`、トリガー3種（生年月日NULL戻し禁止・プロフィール保存の必須・scoutsの送信先）、通知種別2つ。
- 巻き戻しは、生年月日・表示方法・開示依頼・開示依頼の通知のいずれかがあれば中止（何も削除しない）。

## 追補（2026-11-15 レビュー反映）（レビュー指摘2点の修正・本番未適用）
1. **一括保存**: アプリの保存は `save_stylist_profile_v2`（0070草案 1c-2）の**1回のRPC＝1つのDBトランザクション**。生年月日・表示方法・プロフィール（公開設定を含む）は、途中で失敗するとすべて取り消される。内部で既存の `set_stylist_birth_date` / `set_stylist_age_display_mode` / `save_stylist_profile` を呼ぶ（本人判定 auth.uid() はそのまま）。以前の「生年月日→表示方法→プロフィール」の3回呼び出しは廃止（例: 年代・公開→実年齢・非公開の保存が途中で失敗しても、実年齢表示だけが公開のまま残ることはない）。
2. **表示方法の未選択をDBでも拒否**: v2 は生年月日・表示方法（exact/decade）のどちらかが空・不正なら保存しない。さらにプロフィール行（stylist_profiles）のトリガーが「生年月日の未登録」に加えて「表示方法の未選択」も拒否するため、旧 `save_stylist_profile` を直接呼んでも未選択のまま保存できない。**DB対応の判定はサーバー側**（アプリがDBの `stylist_private.age_display_mode` 列を読んで判断。列が無い=0070未適用なら従来の保存関数。読み取りエラーなら保存しない）。フォームの項目欠落（未選択のラジオは送信されない）では判断しない。
3. 影響: 0070適用後、表示方法が未選択の既存会員は、プロフィール更新（0071の career_phase 更新を含む）時に表示方法の選択が必要になる（従来から生年月日が必要。公開されない扱いも変更なし）。
