import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { accountRecoverySchema } from "@/lib/validation/account-recovery";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit/memory-rate-limiter";
import { sanitizeText } from "@/lib/security/sanitize-text";
import { maskEmail } from "@/lib/security/mask-email";
import { verifyBotProtection } from "@/lib/security/bot-protection";

// リクエストボディの上限（想定される全項目の合計より十分大きいが、
// 悪意ある巨大ペイロードは弾くための上限）。
const MAX_BODY_BYTES = 20_000;

// レート制限の設定値。IP単位・メールアドレス単位の両方で制限する。
// ★注意: lib/rate-limit/memory-rate-limiter.ts の説明のとおり、これは
// 単一Node.jsプロセス内でのみ有効なインメモリ実装（MVP）。サーバーレスの
// 複数インスタンス構成で運用する場合は共有ストアへの置き換えが必要。
const IP_LIMIT = 5;
const IP_WINDOW_MS = 60 * 60 * 1000; // 1時間に5回まで
const EMAIL_LIMIT = 3;
const EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000; // 同一メールアドレスへは24時間に3回まで

/**
 * 「登録メールアドレスが分からない方」向けの問い合わせを保存するAPI。
 *
 * ★重要: このAPIは既存アカウント（auth.users・profiles等）との照合・検索を
 * 一切行わない。入力内容をそのまま account_recovery_requests へ保存するだけで、
 * マッチするアカウントがあるかどうかをクライアントへ返すこともしない
 * （成功レスポンスは常に同じ内容）。
 *
 * account_recovery_requests はRLSポリシーが無く、送信者自身を含め誰もクライアント
 * からは読み出せない（service role経由の書き込みのみ）。本人確認・メールアドレス
 * 変更・データ移行は、管理者がこのテーブルを直接確認したうえで手動対応する運用とする。
 *
 * 実装している防御:
 *   ・IP単位のレート制限（1時間5回）
 *   ・同一連絡先メールアドレス単位のレート制限（24時間3回、正規化して比較）
 *   ・リクエストボディサイズの上限
 *   ・zodによる各項目の文字数上限
 *   ・HTMLタグ・制御文字のサニタイズ（保存前に適用）
 *   ・メールアドレス全文はログへ出さない（maskEmail経由のみ）
 *   ・送信成功時のレスポンスは常に同一内容
 *   ・bot対策（Turnstile等）を後付けできる拡張ポイント（verifyBotProtection）
 */
export async function POST(request: Request) {
  // --- 0. ボディサイズの上限チェック（パース前） ---
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  // --- 1. IP単位のレート制限 ---
  const ip = getClientIp(request);
  const ipLimit = checkRateLimit(`ip:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: ipLimit.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } },
    );
  }

  // --- 2. ボディのパース ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // --- 3. bot対策（未設定の間はno-opで常に通る。後付け可能な拡張ポイント） ---
  const turnstileToken =
    typeof body === "object" && body !== null && "turnstileToken" in body
      ? String((body as Record<string, unknown>).turnstileToken ?? "")
      : null;
  const botOk = await verifyBotProtection(turnstileToken || null);
  if (!botOk) {
    return NextResponse.json({ error: "bot_check_failed" }, { status: 400 });
  }

  // --- 4. サニタイズ（HTMLタグ・制御文字の除去）してからバリデーション ---
  // サニタイズを先に行うことで、文字数上限チェックがサニタイズ後の実際の
  // 保存内容に対して行われるようにする。
  const raw = body as Record<string, unknown>;
  const sanitized = {
    displayName: typeof raw.displayName === "string" ? sanitizeText(raw.displayName) : raw.displayName,
    accountType: raw.accountType,
    salonName: typeof raw.salonName === "string" ? sanitizeText(raw.salonName) : raw.salonName,
    prefecture: typeof raw.prefecture === "string" ? sanitizeText(raw.prefecture) : raw.prefecture,
    instagramHandle:
      typeof raw.instagramHandle === "string" ? sanitizeText(raw.instagramHandle) : raw.instagramHandle,
    approximatePeriod:
      typeof raw.approximatePeriod === "string" ? sanitizeText(raw.approximatePeriod) : raw.approximatePeriod,
    contactEmail: typeof raw.contactEmail === "string" ? sanitizeText(raw.contactEmail) : raw.contactEmail,
    notes: typeof raw.notes === "string" ? sanitizeText(raw.notes) : raw.notes,
  };

  const parsed = accountRecoverySchema.safeParse(sanitized);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const v = parsed.data;
  const normalizedEmail = v.contactEmail.toLowerCase();

  // --- 5. 同一連絡先メールアドレス単位のレート制限 ---
  const emailLimit = checkRateLimit(`email:${normalizedEmail}`, EMAIL_LIMIT, EMAIL_WINDOW_MS);
  if (!emailLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: emailLimit.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(emailLimit.retryAfterSeconds) } },
    );
  }

  // --- 6. 保存 ---
  const supabase = createServiceClient();

  const { error } = await supabase.from("account_recovery_requests").insert({
    display_name: v.displayName,
    account_type: v.accountType,
    salon_name: v.salonName,
    prefecture: v.prefecture,
    instagram_handle: v.instagramHandle || null,
    approximate_period: v.approximatePeriod,
    contact_email: v.contactEmail,
    notes: v.notes || null,
  });

  if (error) {
    // メールアドレス全文はログへ出さない（maskEmail経由のみ）。
    // インフラ的な保存失敗のみここでエラーを返す。アカウントの存在有無とは無関係。
    console.error("account-recovery: insert failed", { contactEmail: maskEmail(v.contactEmail) });
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  // 送信成功時のレスポンスは、入力内容に関わらず常にこの内容のみ。
  return NextResponse.json({ success: true });
}
