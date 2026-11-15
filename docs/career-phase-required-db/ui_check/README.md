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
確認項目: 未選択では次へ進めない／新卒で卒業年月なしは進めない／3択それぞれで保存できる／失敗時に入力が残る／再送で送信値が入力と一致。PC幅・スマホ幅。
