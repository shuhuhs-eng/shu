# 新規登録ウィザードの通し操作確認（ローカル・保存先はモック）
リポジトリ直下で `npx next build` 後、次を実行（CSSは .next の成果物を使う）:
```
D=$(mktemp -d); cp docs/career-phase-required-db/ui_check/{stubs.tsx,entry.tsx,build.mjs,run.cjs} $D/
cp /dev/null $D/app.css; cat .next/static/chunks/*.css > $D/app.css
echo '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>' > $D/index.html
cp $D/build.mjs ./.wizbuild.mjs && node .wizbuild.mjs $D; rm .wizbuild.mjs
node $D/run.cjs $D
```
※ entry.tsx は `/home/claude/shu` の絶対パスを使っています。別の場所で実行する場合は置き換えてください。
確認項目（0076/0077の仕様）: 未選択では次へ進めない／新卒は年（西暦選択）と月（3月・10月）が必須で、日・自由入力・区分・就業開始・免許の欄がない／ブランクありはブランク期間（数値＋ヶ月/年・任意・0や不正値は不可）／3択それぞれで保存できる（旧項目は送られない）／失敗時に入力が残る／再送で送信値が入力と一致。PC幅・スマホ幅。保存先はモック（実Supabaseではない）。

## プロフィール編集の確認（run_profile.cjs）
`node build.mjs $D entry_profile profile` で `profile.js` を作り、`index.html` と同じ内容の `profile.html`（script を profile.js に）を置いて `node run_profile.cjs $D`。
保存ボタンが1つ／旧フォームの文言なし／未選択ではエラー／3択それぞれの保存と再読み込み後の復元／失敗時に入力が残る／立場カードは表示のみ、をPC幅・スマホ幅で確認。
※ このディレクトリは tsconfig と eslint の対象外（Vercel のビルドを壊さないため。entry*.tsx は作業環境の絶対パスを使う）。

## 診断結果の「プロフィールへの反映」ボタンの確認（run_apply.cjs）
`node build.mjs $D entry_apply apply` で `apply.js` を作り、`apply.html`（script を apply.js に）を置いて `node run_apply.cjs $D`。保存先はモック（実Supabaseではない）。
押せる／自動では保存されない／1回・3項目だけ送る／反映後は現在の設定が変わり再度は押せない／失敗は成功と出さず設定も変えない／診断が3つ未満は補わず押せない、をPC幅・スマホ幅で確認。
