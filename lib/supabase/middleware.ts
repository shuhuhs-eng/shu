import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { hasCompletedRole } from "@/lib/auth/user-roles";

/** ログイン必須のルート（本人のみ表示すべきページ）。前方一致で判定する。 */
const AUTH_REQUIRED_PREFIXES = [
  "/onboarding",
  "/update-password",
  // 旧URL（リダイレクトシム）。役割別新URLへ移行後も、直接アクセスされた
  // 場合の保護として残す。
  "/profile/edit",
  "/mypage",
  "/salon-culture",
  // 役割別ルーティング分離後の新URL。
  "/stylist/mypage",
  "/stylist/profile",
  "/stylist/preference",
  "/stylist/salons",
  "/salon/mypage",
  "/salon/profile",
  "/salon/culture",
];

/** 未ログインのときだけ表示するルート。ログイン済みならトップへ戻す。 */
const GUEST_ONLY_PATHS = [
  "/login",
  "/signup",
  "/signup/salon",
  "/reset-password",
  // 役割別ログイン入口の分離。
  "/stylist/login",
  "/salon/login",
];

/**
 * ★「1 auth user = 1 role」方針でのrole別ルート制御。
 * stylist roleを完了済みのユーザーはsalon専用ルートへ、salon roleを完了済みの
 * ユーザーはstylist専用ルートへアクセスできない（該当ロールのマイページへ
 * 安全にredirectする）。
 *
 * /stylist/diagnosis・/diagnosis/salon をここに含めているが、この制御は
 * `if (user)` の中でのみ適用する（下記参照）ため、未ログインユーザー向けの
 * 診断プレビュー導線（現在正常）には一切影響しない。
 * /stylist/mypage 等は既存のAUTH_REQUIRED_PREFIXES判定で未ログイン時は
 * 既にログインへリダイレクトされているため、ここに到達する時点で
 * 必ずログイン済みである。
 */
const STYLIST_ONLY_PREFIXES = ["/stylist/mypage", "/stylist/profile", "/stylist/diagnosis", "/stylist/preference", "/stylist/salons"];
const SALON_ONLY_PREFIXES = ["/salon/mypage", "/salon/profile", "/salon/culture", "/diagnosis/salon"];

/**
 * リクエストごとに Supabase セッションを更新し、あわせて以下のルート保護を行う。
 *   1. AUTH_REQUIRED_PREFIXES へ未ログインでアクセス → /login?next=<元のパス> へ
 *   2. STYLIST_ONLY_PREFIXES/SALON_ONLY_PREFIXES へ、逆roleを完了済みの
 *      ログイン中ユーザーがアクセス → 自分のroleのマイページへ
 *      （「1 auth user = 1 role」方針。role未確定・未ログインは対象外）
 *   3. GUEST_ONLY_PATHS へログイン済みでアクセス     → / へ
 *   4. /onboarding または /onboarding/salon へ、そのroleのオンボーディングを
 *      既に完了済みのユーザー、または「逆roleを既に持っている」ユーザーが
 *      アクセス → 該当roleのマイページへ（やり直し・二重role取得の防止）。
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() でトークンを検証・リフレッシュ（getSession ではなく getUser を使う）
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const requiresAuth = AUTH_REQUIRED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (requiresAuth && !user) {
    console.log("[MW] requiresAuth redirect to /login", { pathname, hasUser: !!user });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // ★role別ルート制御（1 auth user = 1 role方針）。未ログインユーザーは
  // この制御の対象外（/stylist/diagnosis・/diagnosis/salonの未ログイン
  // 診断プレビュー導線を壊さないため）。
  if (user) {
    const isStylistOnlyPath = STYLIST_ONLY_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );
    const isSalonOnlyPath = SALON_ONLY_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );

    if (isStylistOnlyPath) {
      const hasSalon = await hasCompletedRole(supabase, user.id, "salon");
      if (hasSalon) {
        console.log("[MW] salon-role user blocked from stylist-only path", { pathname, userId: user.id });
        const url = request.nextUrl.clone();
        url.pathname = "/salon/mypage";
        url.search = "";
        return NextResponse.redirect(url);
      }
    }

    if (isSalonOnlyPath) {
      const hasStylist = await hasCompletedRole(supabase, user.id, "stylist");
      if (hasStylist) {
        console.log("[MW] stylist-role user blocked from salon-only path", { pathname, userId: user.id });
        const url = request.nextUrl.clone();
        url.pathname = "/stylist/mypage";
        url.search = "";
        return NextResponse.redirect(url);
      }
    }
  }

  if (GUEST_ONLY_PATHS.includes(pathname) && user) {
    console.log("[MW] guest-only redirect to /", { pathname, userId: user.id });
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // ★role別onboarding制御。以前は同じroleを完了済みの場合のみ弾いていたが、
  // 「1 auth user = 1 role」方針への転換に伴い、逆roleを既に持っている
  // 場合も弾く（二重role取得の防止）。どちらの場合も該当roleの
  // マイページへ直接redirectする（以前は"/"だった）。
  if (pathname === "/onboarding" && user) {
    if (await hasCompletedRole(supabase, user.id, "stylist")) {
      const url = request.nextUrl.clone();
      url.pathname = "/stylist/mypage";
      url.search = "";
      return NextResponse.redirect(url);
    }
    if (await hasCompletedRole(supabase, user.id, "salon")) {
      console.log("[MW] salon-role user blocked from /onboarding (stylist)", { userId: user.id });
      const url = request.nextUrl.clone();
      url.pathname = "/salon/mypage";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  if (pathname === "/onboarding/salon" && user) {
    if (await hasCompletedRole(supabase, user.id, "salon")) {
      const url = request.nextUrl.clone();
      url.pathname = "/salon/mypage";
      url.search = "";
      return NextResponse.redirect(url);
    }
    if (await hasCompletedRole(supabase, user.id, "stylist")) {
      console.log("[MW] stylist-role user blocked from /onboarding/salon", { userId: user.id });
      const url = request.nextUrl.clone();
      url.pathname = "/stylist/mypage";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}
