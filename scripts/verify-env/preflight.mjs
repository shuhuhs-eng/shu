#!/usr/bin/env node
// 検証前の確認（読み取りのみ。DB・Stripe・メールに書き込まない）。
// 使い方: set -a; . ./.env.verification.local; set +a; node scripts/verify-env/preflight.mjs
const EXPECTED_REF = "yegjxkstxhwrknshlaip";
const out = []; let ng = 0;
const ok = (n, c, note = "") => { out.push(`${c ? "OK " : "NG "} ${n}${note ? " — " + note : ""}`); if (!c) ng++; };
const e = process.env;
const url = e.NEXT_PUBLIC_SUPABASE_URL ?? "";
ok("Supabase の接続先が検証プロジェクト", url === `https://${EXPECTED_REF}.supabase.co`, url ? new URL(url).host : "未設定");
ok("anon キーが設定されている", !!e.NEXT_PUBLIC_SUPABASE_ANON_KEY);
ok("service_role キーが設定されている", !!e.SUPABASE_SERVICE_ROLE_KEY && e.SUPABASE_SERVICE_ROLE_KEY !== e.NEXT_PUBLIC_SUPABASE_ANON_KEY);
ok("Stripe はテストモードのキー（sk_test_ / rk_test_）", /^(sk|rk)_test_/.test(e.STRIPE_SECRET_KEY ?? ""), (e.STRIPE_SECRET_KEY ?? "").startsWith("sk_live") || (e.STRIPE_SECRET_KEY ?? "").startsWith("rk_live") ? "本番キーは使えません" : "");
ok("Stripe Webhook シークレット", /^whsec_.{8,}/.test(e.STRIPE_WEBHOOK_SECRET ?? ""));
ok("サイトURLが設定され、本番ドメインではない", /^https?:\/\/(localhost(:\d+)?|127\.0\.0\.1(:\d+)?|[^/]*\.vercel\.app|[^/]*\.ngrok[^/]*|[^/]*\.trycloudflare\.com)$/.test(e.NEXT_PUBLIC_SITE_URL ?? ""), e.NEXT_PUBLIC_SITE_URL ?? "未設定");
ok("CRON_SECRET", (e.CRON_SECRET ?? "").length >= 16);
for (const f of ["SCOUT_LEDGER_ENABLED", "SALON_ACCOUNT_ISSUE_ENABLED", "MANUAL_BILLING_ENABLED"]) ok(`${f}=1`, e[f] === "1");
ok("Turnstile のキー（テスト用）", !!e.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !!e.TURNSTILE_SECRET_KEY);
async function get(u, headers = {}) { try { const r = await fetch(u, { headers, signal: AbortSignal.timeout(8000) }); return r; } catch { return null; } }
if (url === `https://${EXPECTED_REF}.supabase.co`) {
  const h = await get(`${url}/auth/v1/health`, { apikey: e.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" });
  ok("Supabase Auth に到達できる", !!h && h.status === 200, h ? `HTTP ${h.status}` : "到達できません（ネットワーク）");
  // 読み取りのみ: RPCの存在確認（匿名では実行できない＝401/403/404 のいずれか。到達性の確認だけ）
  const r = await get(`${url}/rest/v1/`, { apikey: e.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" });
  ok("Supabase REST に到達できる", !!r && r.status < 500, r ? `HTTP ${r.status}` : "到達できません");
}
console.log(out.join("\n")); console.log(ng === 0 ? "\n準備OK（書き込みは一切していません）" : `\nNG が ${ng} 件あります。直してから検証を始めてください。`);
process.exit(ng === 0 ? 0 : 1);
