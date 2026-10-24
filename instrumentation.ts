/**
 * サーバー起動時に1回だけ環境変数の不足を検知してログに出す（変数名のみ・値は出さない）。
 * 起動は止めない（一部機能の不足で全体停止させない）。デプロイ後のログ確認を release-checklist に記載。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { collectEnvProblems } = await import("@/lib/env/validate");
  const problems = collectEnvProblems(process.env, process.env.NODE_ENV === "production");
  for (const p of problems) {
    if (p.level === "error") console.error(`[env] ${p.message}`);
    else console.warn(`[env] ${p.message}`);
  }
}
