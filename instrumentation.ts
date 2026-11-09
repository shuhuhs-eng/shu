/**
 * サーバー起動時に1回だけ環境変数を検査する（変数名のみ・値は出さない）。
 *
 *   ・本番（NODE_ENV=production）: 必須の環境変数の不足・不正（localhost URL、Test/Live混在、
 *     Bot対策bypassの設定など）が1つでもあれば、起動を失敗させる（fail-fast）。
 *     不完全な設定のまま公開されることを防ぐ。
 *   ・開発: 警告をログに出すだけで起動は止めない。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const isProduction = process.env.NODE_ENV === "production";
  const { collectEnvProblems, formatEnvFailure } = await import("@/lib/env/validate");
  const problems = collectEnvProblems(process.env, isProduction);
  for (const p of problems) {
    if (p.level === "error") console.error(`[env] ${p.message}`);
    else console.warn(`[env] ${p.message}`);
  }
  // `next build` はビルド専用の環境（本番の秘密情報を持たないCI等）で動くため、起動時検査の対象外にする。
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
  const errors = problems.filter((p) => p.level === "error");
  if (isProduction && !isBuildPhase && errors.length > 0) {
    throw new Error(formatEnvFailure(errors));
  }
}
