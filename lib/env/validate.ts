/**
 * 環境変数の不足検知（値そのものは決して出力しない。変数名のみ）。
 *
 * 分類:
 *   required      … 常に必須（開発でも無いと動かない）
 *   productionOnly… 本番でのみ必須（開発では未設定でも動く）
 *   optional      … 未設定でも機能が縮退するだけ
 *
 * 開発環境（NODE_ENV !== "production"）では errors を返さず、警告のみにする。
 */
export type EnvSpec = { key: string; kind: "required" | "productionOnly"; note: string };

export const ENV_SPECS: EnvSpec[] = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", kind: "required", note: "Supabase プロジェクトURL" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", kind: "required", note: "Supabase anon キー" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", kind: "productionOnly", note: "未ログイン診断の保存・請求書PDF保管に必須" },
  { key: "NEXT_PUBLIC_SITE_URL", kind: "productionOnly", note: "メール認証/パスワード再設定のリダイレクト基点" },
  { key: "CRON_SECRET", kind: "productionOnly", note: "cron エンドポイントの認証" },
  { key: "ANTHROPIC_API_KEY", kind: "productionOnly", note: "AI解説生成（未設定だと生成がスキップされる）" },
  { key: "LEGAL_OPERATOR_NAME", kind: "productionOnly", note: "規約の運営者名（未設定だと /admin/legal から公開不可）" },
  { key: "LEGAL_OPERATOR_ADDRESS", kind: "productionOnly", note: "規約の運営者所在地" },
  { key: "LEGAL_CONTACT_EMAIL", kind: "productionOnly", note: "規約の問い合わせ先" },
  { key: "LEGAL_EFFECTIVE_DATE", kind: "productionOnly", note: "規約の施行日 YYYY-MM-DD" },
];

export type EnvProblem = { key: string; level: "error" | "warn"; message: string };

type Env = Record<string, string | undefined>;

export function collectEnvProblems(env: Env, isProduction: boolean): EnvProblem[] {
  const problems: EnvProblem[] = [];
  const missing = (k: string) => !env[k] || !env[k]!.trim();
  for (const s of ENV_SPECS) {
    if (!missing(s.key)) continue;
    if (s.kind === "required") {
      problems.push({ key: s.key, level: isProduction ? "error" : "warn", message: `${s.key} が未設定（${s.note}）` });
    } else if (isProduction) {
      problems.push({ key: s.key, level: "error", message: `${s.key} が未設定（${s.note}）` });
    }
  }
  const site = env.NEXT_PUBLIC_SITE_URL;
  if (isProduction && site && /localhost|127\.0\.0\.1/.test(site)) {
    problems.push({ key: "NEXT_PUBLIC_SITE_URL", level: "error", message: "NEXT_PUBLIC_SITE_URL が localhost を指している" });
  }
  if (isProduction && site && !/^https:\/\//.test(site)) {
    problems.push({ key: "NEXT_PUBLIC_SITE_URL", level: "warn", message: "NEXT_PUBLIC_SITE_URL が https:// ではない" });
  }
  const date = env.LEGAL_EFFECTIVE_DATE;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    problems.push({ key: "LEGAL_EFFECTIVE_DATE", level: "error", message: "LEGAL_EFFECTIVE_DATE は YYYY-MM-DD 形式" });
  }
  return problems;
}
