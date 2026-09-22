/**
 * bot対策（Cloudflare Turnstile等）を後から追加するための拡張ポイント。
 *
 * 現時点ではフロントエンドにTurnstileウィジェットを組み込んでいないため、
 * `TURNSTILE_SECRET_KEY` が環境変数に設定されていない間は常に true を返す
 * （＝bot対策なしで通す。既存の動作を変えない）。
 *
 * 実装を追加する場合の手順:
 *   1. フロントエンド（app/account-recovery/page.tsx）にTurnstileウィジェットを設置し、
 *      発行されたトークンを送信データに `turnstileToken` として含める
 *      （現状のフォームはこのフィールドを送っていないため、追加実装が必要）。
 *   2. .env.local に TURNSTILE_SECRET_KEY を設定する。
 *   3. 下記のTODO部分で、Cloudflareの siteverify エンドポイントへ
 *      トークンを検証するリクエストを送る実装に置き換える。
 */
export async function verifyBotProtection(token: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  // 未設定の間はbot対策を無効化（既存の動作を変えないための既定値）。
  if (!secret) {
    return true;
  }

  if (!token) {
    return false;
  }

  // TODO: Turnstile実装時にここを置き換える。
  // const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/x-www-form-urlencoded" },
  //   body: new URLSearchParams({ secret, response: token }),
  // });
  // const data = await res.json();
  // return data.success === true;

  return true;
}
