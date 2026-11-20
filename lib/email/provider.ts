import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * メール送信の窓口。本番で使うのは「外部サービスにHTTPで1通ずつ送る」部分だけで、他は検証用。
 *   EMAIL_PROVIDER 未設定 / disabled … 送らない（何も起きない。既定）
 *   EMAIL_PROVIDER=capture          … ファイルに書き出すだけ（実配信なし。テスト・画面確認用。本番環境では動作拒否）
 *   EMAIL_PROVIDER=resend           … Resend の HTTP API（RESEND_API_KEY が必要。★実サービスでの動作は未確認）
 * 結果は4種類に分類する。「届いたか分からない」場合を失敗と区別して、自動では再送しない（二重送信を避ける）。
 */
export type MailInput = { to: string; subject: string; text: string; idempotencyKey: string };
export type SendOutcome =
  | { kind: "sent"; messageId: string | null }
  | { kind: "retry"; error: string }     // 受理されていないと確実に分かる一時的な失敗（再試行してよい）
  | { kind: "rejected"; error: string }  // 恒久的に受け付けられない（宛先不正・設定不備など）。再試行しない
  | { kind: "unknown"; error: string };  // 受理されたか不明（通信途中の切断・5xx等）。自動では再送せず運営が確認する

export type MailProvider = { name: string; send(mail: MailInput): Promise<SendOutcome> };

/** HTTPステータスを結果へ分類する（外部サービスが 2xx 以外を返した場合）。 */
export function classifyHttpStatus(status: number): SendOutcome["kind"] {
  if (status >= 200 && status < 300) return "sent";
  if (status === 429) return "retry"; // 受理前に制限された
  if (status >= 400 && status < 500) return "rejected";
  return "unknown"; // 5xx: 内部で受理された可能性が否定できない
}

class DisabledProvider implements MailProvider {
  name = "disabled";
  async send(): Promise<SendOutcome> {
    return { kind: "retry", error: "provider_disabled" };
  }
}

/** 検証用: 実配信せずファイルに書き出す。宛先の形で失敗を再現できる（fail-retry@ / fail-reject@ / fail-unknown@）。 */
export class CaptureProvider implements MailProvider {
  name = "capture";
  constructor(private dir: string) {}
  async send(mail: MailInput): Promise<SendOutcome> {
    const local = mail.to.split("@")[0] ?? "";
    if (local.startsWith("fail-retry")) return { kind: "retry", error: "simulated_retry" };
    if (local.startsWith("fail-reject")) return { kind: "rejected", error: "simulated_reject" };
    if (local.startsWith("fail-unknown")) return { kind: "unknown", error: "simulated_unknown" };
    await mkdir(this.dir, { recursive: true });
    const id = mail.idempotencyKey;
    await writeFile(path.join(this.dir, `${id}.json`), JSON.stringify({ ...mail, capturedAt: new Date().toISOString() }, null, 2), "utf8");
    return { kind: "sent", messageId: `capture-${id}` };
  }
}

class ResendProvider implements MailProvider {
  name = "resend";
  constructor(private apiKey: string, private from: string, private fetchImpl: typeof fetch = fetch) {}
  async send(mail: MailInput): Promise<SendOutcome> {
    let res: Response;
    try {
      res = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": mail.idempotencyKey },
        body: JSON.stringify({ from: this.from, to: [mail.to], subject: mail.subject, text: mail.text }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      return { kind: "unknown", error: "network_or_timeout" }; // 送信後に切れた可能性があるため不明扱い
    }
    const kind = classifyHttpStatus(res.status);
    if (kind === "sent") {
      let id: string | null = null;
      try { id = ((await res.json()) as { id?: string }).id ?? null; } catch { /* 本文が読めなくても送信は成功扱い */ }
      return { kind: "sent", messageId: id };
    }
    return { kind, error: `http_${res.status}` };
  }
}

export function createMailProvider(env: Record<string, string | undefined> = process.env): MailProvider {
  const mode = (env.EMAIL_PROVIDER ?? "disabled").trim().toLowerCase();
  if (mode === "capture") {
    if (env.VERCEL_ENV === "production") throw new Error("capture provider is not allowed in production");
    return new CaptureProvider(env.EMAIL_CAPTURE_DIR?.trim() || ".email-capture");
  }
  if (mode === "resend") {
    const key = env.RESEND_API_KEY?.trim(), from = env.EMAIL_FROM?.trim();
    if (!key || !from) throw new Error("resend provider requires RESEND_API_KEY and EMAIL_FROM");
    return new ResendProvider(key, from);
  }
  return new DisabledProvider();
}
export { ResendProvider };
