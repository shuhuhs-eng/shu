# アプリ差分の要約（新卒向け共通30問 ＋ 8タイプ丸め・同点の一致修正）

push・本番適用なし。コミットなし（作業ツリーのまま、差分は `app_diff.patch` と新規ファイル一式で提出）。

## 変更ファイル（変更 15・新規 15）
**経験者版の質問・配点・採点・golden は無変更**（`lib/diagnosis/questions.ts`・`scoring.ts`・`scripts/diagnosis-golden.json` は触っていない）。

| 区分 | ファイル | 内容 |
|---|---|---|
| 丸め・同点 | `lib/diagnosis/core-types.ts`（変更） | 整数（1/100単位）の厳密計算で小数第1位へ四捨五入、同点は定義順。DB(0078)と一致。プレビューが変わるのは丸め境界（x.x5）だけ（`docs/core-type-tiebreak-db/impact_experienced.md`） |
| 新卒の質問・説明 | `lib/diagnosis/newgrad-questions.ts`（自動生成）・`newgrad-content.ts`・`scripts/gen-newgrad-questions.mjs` | 設計JSONから生成。質問・配点・説明文は無変更 |
| セット・版 | `lib/diagnosis/newgrad.ts`・`versioned.ts`・`quiz-switch.ts`・`index.ts` | 1問目からセットを決定、版→質問バンクの対応、保存済みの版での検証・計算、送信の検証、1問目切替の判定、新卒入口スイッチ（既定無効） |
| 送信 | `app/api/diagnosis/guest/route.ts`・`lib/diagnosis-handoff/submit-logged-in.ts` | 版・質問IDの申告を受け、サーバーが公式の版を決めて照合。旧い画面（申告なし）は経験者の形のときだけ受け付ける |
| 引き継ぎ | `lib/diagnosis-handoff/claim.ts`・`claim-errors.ts` | 保存された版で検証・計算。Cookieを消すのは、期限切れ等がRPCメッセージで明確なとき・既知の版で破損のときだけ。PGRST202・42883・42501・一般的なP0001・HTTP 4xx・版不明・一時障害では保つ（`isUnrecoverableStartError`） |
| 画面 | `components/diagnosis/diagnosis-quiz.tsx` | 共通30問・1問目の5択・セット切替の確認とリセット（戻る／直す／再送の識別子も作り直し）・申告の送信 |
| 結果 | `app/diagnosis/result/page.tsx`・`app/stylist/mypage/page.tsx`・`components/mypage/newgrad-result.tsx` | 新卒向け表示。経験・年収・市場価値・才能グラフ・経験者向け説明を出さない。立場の不一致案内（自動変更しない） |
| AI | `lib/ai/generate-diagnosis-narrative.ts` | 新卒専用の指示（数値を渡さない・禁止事項・版 `newgrad-1.0.0`） |
| 入口 | `app/stylist/diagnosis/page.tsx`・`app/stylist/diagnosis/student/page.tsx` | 15問の案内バナーを削除。旧15問の入口は共通30問へリダイレクト。旧15問の新規保存はサーバー側で停止（`lib/student-diagnosis/actions.ts`・`closed.ts`）、保存済み結果の表示は残す。診断ページは `isNewgradEntryEnabled()` を画面に渡す |
| 設定 | `.env.example` | `NEWGRAD_ENTRY_ENABLED`（既定無効。`true`/`1`/`on` のときだけ有効） |
| テスト | `tests/core-type-parity.test.ts`・`newgrad-diagnosis.test.ts`・`newgrad-handoff.test.ts`・`tests/fixtures/core-type-db-parity.csv`（新規） | 下記 |

## 既存テストの扱い（期待値を合わせるための変更はしていない）
既存413件のうち、次の3か所だけを変更した。いずれも**入口を共通30問に統一するという今回の方針変更**（または疑似DBの再現度）に伴うもので、診断の質問・配点・採点・判定の期待値は変えていない。
1. `tests/student-career-phase.test.ts`: 「診断ページに、立場が新卒のときだけ15問の入口を出す」の確認 → 「15問の入口・案内を出さない」へ（旧方針の確認だった）。
2. `tests/student-diagnosis-entry-by-phase.test.ts`: 同じ旧方針の確認1行を、新方針に。
3. `tests/diagnosis-guest-save.test.ts`: 疑似DBが `pending_diagnoses.diagnosis_version`（実DBはNOT NULL）を保存していなかったため、保存するようにした（疑似DBの再現度の修正）。これを直す前は、版を読む新しい引き継ぎが版不明と判定し、4件が失敗していた。
この3か所以外の既存テストは無修正で合格。

## テスト結果（ローカル）
- `npm test`: 全446件合格（既存413 ＋ 新規32）。`tsc --noEmit` エラーなし。`eslint .` エラー0（警告11、既存を含む）。`next build` 成功（最新のフラグ・停止変更後に再実行）。
- 経験者版の golden（`scripts/diagnosis-golden.json`、3000件）: 全項目100%一致。※ `npm run verify:diagnosis` は、変更前（HEAD 56f9814）の時点から、この環境の tsx が `lib/diagnosis/index` の `export *` を解決できず起動に失敗する（今回の変更とは無関係。HEAD の worktree でも再現）。同じ比較を、直接のモジュールを読む一時ランナーで実行して確認した。スクリプト自体は変更していない。
- 追加した自動テスト（専用）:
  - `core-type-parity.test.ts`（6件）: DB（0078適用後）の固定結果5,311行とアプリの一致、厳密な整数計算の参照実装との一致（格子15,625＋乱数20,000）、同点（1位・2位・全0・全50）、僅差（差0.1が300件）、丸め境界、SQLの係数とアプリの重みの一致。
  - `newgrad-diagnosis.test.ts`（14件）: 設計JSONとの一致、1問目・3問目の除外、設計の到達例（8タイプ）の再現、説明文、共通入口、経験者版が既存と完全一致（乱数3,000件）、新卒の市場価値null、版による分類（不明／破損）、送信の検証、1問目切替の判定、失敗分類、旧15問の新規保存停止、入口スイッチ（既定無効）、Cookie破棄の分類、AI指示。
  - `newgrad-handoff.test.ts`: ゲスト保存→新規登録での取り込みを疑似Supabaseで。版名の保存、混在送信の拒否、一時障害（PGRST202・42883・42501・一般的なP0001・4xx、commit／complete失敗）でCookieを保ち、障害解消後に同じ回答が重複なく取り込まれること、明確な理由のときだけ削除、期限不変、入口無効中も保留回答の取り込みが続くこと。

## 実ブラウザ確認（PC 1280幅・iPhone 13、`browser_verification/`）
疑似Supabase（`mock_supabase.mjs`）＋ `next dev` ＋ Playwright（`browser_check.cjs`）。52項目すべて合格（`browser_results.json`、画面は `screenshots/`）。
- 新卒↔経験者の切替を確定すると2問目以降が消える／取り消すと回答が残る
- 確認画面の「直す」「戻る」から変更しても、回答が混ざらない（1問だけ変わる。別セットへ切り替えたときは2問目からやり直し）
- 保存失敗後の再送で回答が残り、同じ保存IDで1件だけ保存（二重保存なし）。回答を直した後は新しい保存IDで1件
- 新卒の結果（ゲスト・ログイン）に、経験年数・年収・市場価値・才能グラフが出ない。保存値は版 `stylist_newgrad_30_v1`、市場価値・年収はnull
- この確認で、新卒の結果画面に経験者向けの「才能を活かせる」が残っていたのを見つけて修正した（`app/diagnosis/result/page.tsx`）。
- 未確認: 実Supabase・実メール。マイページの新卒表示は、疑似ログインでの結果画面までを確認（マイページ自体は自動テスト・型検査・ビルドのみ）。入口無効時の画面は自動テストのみ。

## 判断をお願いしたい点
1. 結果画面の「僅差・第二候補」の表示は未実装・保留（設計の2.0は確定仕様ではない）。
2. 運用順: 0078 適用前チェック → 適用 → 適用後チェック → 新卒入口を無効にしたアプリ配備。0075 は保留。

## 追加確認（入口無効・マイページ、`browser_verification/disabled_results.json`、16項目合格）
入口無効（フラグ未設定）で、PC・iPhone 13とも: 1問目は4択・新卒の選択肢なし・新卒のAPI送信は拒否。マイページは**正常表示が必須**（エラー画面でないこと、新卒の見出し「あなたのタイプ」とタイプ名が出ること）に加え、経験年数・年収・市場価値・才能グラフ・「才能は経験とともに変わります」が出ない。疑似Supabaseでの確認で、実Supabaseは未確認。
