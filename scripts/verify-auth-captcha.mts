/**
 * 本番公開前の確認: Supabase Auth の CAPTCHA（Dashboard > Authentication > Attack Protection）が有効か。
 *
 * 方法: CAPTCHAトークン無しで /auth/v1/recover（パスワード再設定）を呼ぶ。存在しないメールアドレスなので、
 * CAPTCHAが無効でもメールは送られず、ユーザーも作られない（副作用なし）。
 *   ・400 + captcha 関連のエラー → CAPTCHA有効（期待どおり）
 *   ・200                          → CAPTCHA無効（本番公開NG。Dashboardで有効化する）
 *
 * 使い方: NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定して `npm run verify:auth-captcha`
 * 秘密鍵・メールアドレスは出力しない。
 */
import { classifyCaptchaProbe } from "../lib/security/captcha-probe";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。");
    process.exit(2);
  }
  const res = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/recover`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon },
    body: JSON.stringify({ email: "captcha-probe-nonexistent@example.com" }),
  });
  const text = await res.text();
  const result = classifyCaptchaProbe(res.status, text);
  if (result === "enabled") {
    console.log("OK: Supabase Auth CAPTCHA は有効です（トークン無しのリクエストは拒否されました）。");
    return;
  }
  if (result === "disabled") {
    console.error("NG: Supabase Auth CAPTCHA が無効です。Dashboard > Authentication > Attack Protection で Turnstile を有効にしてください。");
    process.exit(1);
  }
  console.error(`判定不能: HTTP ${res.status}。Dashboardの設定を目視で確認してください。`);
  process.exit(3);
}

// 直接実行されたときだけ動く（テストからimportしても副作用なし）。
if (process.argv[1] && /verify-auth-captcha/.test(process.argv[1])) {
  main();
}
