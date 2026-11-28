#!/usr/bin/env bash
# 検証用アプリの起動（検証環境の値だけを読み込む）。使い方: bash scripts/verify-env/start.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .env.verification.local ] || { echo ".env.verification.local がありません（env.verification.example をコピーして値を入れる）"; exit 1; }
set -a; . ./.env.verification.local; set +a
node scripts/verify-env/preflight.mjs
npm run build && exec npx next start -p "${PORT:-3000}"
