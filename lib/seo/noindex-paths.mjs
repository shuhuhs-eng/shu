/**
 * 検索結果に出さない（noindex）パスの一覧。next.config.mjs（X-Robots-Tag ヘッダー）・テストから共通で使う。
 *
 * ・ここに載せたページは robots.txt では巡回禁止にしない（noindex を検索エンジンに読み取らせるため）。
 *   robots.txt は情報保護の手段ではない。ログイン必須ページの認証は、これまでどおり proxy.ts・各ページ・DBが行う。
 * ・前方一致（そのパス自体と、その配下すべて）。
 * ・公開してよいページ（/, /stylist/diagnosis, /privacy, /terms）は含めない。
 */
export const NOINDEX_PATH_PREFIXES = [
  // 運営管理
  "/admin",
  // ログイン後のページ・本人のデータ
  "/mypage",
  "/messages",
  "/onboarding",
  "/profile",
  "/salon", // サロン側は /salon/login を含め、すべて検索対象外
  "/salon-culture",
  "/stylist/mypage",
  "/stylist/profile",
  "/stylist/preference",
  "/stylist/match-profile",
  "/stylist/salons",
  "/stylist/scouts",
  "/stylist/offers",
  "/stylist/applications",
  "/stylist/age-requests",
  "/stylist/login",
  "/stylist/diagnosis/student", // 新卒の診断結果（本人のみ）を含む
  // 個人の診断結果・診断の入口のうち公開しないもの
  "/diagnosis/result",
  "/diagnosis/salon",
  // 登録・認証・同意・アカウント復旧
  "/login",
  "/signup",
  "/reset-password",
  "/update-password",
  "/account-recovery",
  "/legal",
  "/auth",
  // API（HTMLページではない）
  "/api",
];

/**
 * 検索対象にする公開ページ（sitemap.xml に載せ、canonical を自分自身にする）。
 * 実在し、未ログインで表示できるページだけ。
 */
export const PUBLIC_INDEXABLE_PATHS = ["/", "/stylist/diagnosis", "/privacy", "/terms"];

/** パスが noindex 対象（前方一致）か。 */
export function isNoindexPath(pathname) {
  return NOINDEX_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
