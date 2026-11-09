/**
 * メール認証・パスワード再設定・Stripe戻りURLなどの基点となるサイトURL。
 *
 *   ・開発（NODE_ENV !== "production"）: 未設定なら http://localhost:3000 にフォールバックしてよい。
 *   ・本番（NODE_ENV === "production"）: NEXT_PUBLIC_SITE_URL が
 *       未設定 / localhost・127.0.0.1・0.0.0.0・[::1] / 不正なURL / https以外
 *     のいずれかなら例外を投げる（fail-fast）。壊れたリンクを利用者へ送らない。
 *   ・末尾のスラッシュは取り除く。
 */
type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

export class SiteUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteUrlError";
  }
}

/** 本番向けURLとして妥当か。妥当でなければ理由を返す。 */
export function siteUrlProblem(value: string | undefined): string | null {
  const v = value?.trim();
  if (!v) return "NEXT_PUBLIC_SITE_URL が未設定";
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return "NEXT_PUBLIC_SITE_URL がURLとして不正";
  }
  if (LOCAL_HOSTS.has(u.hostname) || u.hostname.endsWith(".localhost")) return "NEXT_PUBLIC_SITE_URL が localhost を指している";
  if (u.protocol !== "https:") return "NEXT_PUBLIC_SITE_URL が https:// ではない";
  if (u.username || u.password) return "NEXT_PUBLIC_SITE_URL に認証情報が含まれている";
  return null;
}

export function resolveSiteUrl(env: Env = process.env): string {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env.NODE_ENV === "production") {
    const problem = siteUrlProblem(raw);
    if (problem) throw new SiteUrlError(problem);
    return new URL(raw!).origin + new URL(raw!).pathname.replace(/\/+$/, "");
  }
  return (raw || "http://localhost:3000").replace(/\/+$/, "");
}

export function getSiteUrl(): string {
  return resolveSiteUrl(process.env);
}
