import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { subscriptionAuthorizedDownloadSchema } from "@/lib/invoices/subscription-types";
import { subscriptionStorageKey } from "@/lib/invoices/subscription-path";
import { downloadInvoicePdf, sha256Hex } from "@/lib/invoices/storage";

/**
 * 月額（カード決済済み）の適格請求書PDFの取得。成功報酬の /api/invoices と同じ方式：
 *   ログイン確認 → 認可RPC（権限確認＋ダウンロード監査）→ Storage取得 → SHA-256照合 → bytes返却。
 * ★署名URL・公開URLは使わない。storage_path／Storageキーはクライアントへ出さない。
 * ★運営者、または対象会社の company_owner / company_admin のみ（DBの authorize_subscription_invoice_download）。
 */
export const dynamic = "force-dynamic";

function plain(status: number, message: string): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(request: Request, ctx: { params: Promise<{ documentId: string }> }): Promise<Response> {
  const { documentId } = await ctx.params;
  if (!z.string().uuid().safeParse(documentId).success) return plain(404, "請求書が見つかりません。");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return plain(401, "ログインが必要です。");

  const { data, error } = await supabase.rpc("authorize_subscription_invoice_download", { p_document_id: documentId });
  if (error) {
    console.error("[subscriptionInvoicePdf] authorize failed", { message: error.message, code: error.code });
    // 存在しない場合と権限が無い場合を区別しない。
    return plain(404, "請求書が見つかりません。");
  }
  const doc = subscriptionAuthorizedDownloadSchema.safeParse(data);
  if (!doc.success) return plain(500, "請求書を取得できませんでした。");

  let key: string;
  try {
    key = subscriptionStorageKey(doc.data.storage_path);
  } catch {
    return plain(500, "請求書を取得できませんでした。");
  }
  const bytes = await downloadInvoicePdf(key);
  if (!bytes) return plain(500, "請求書を取得できませんでした。時間をおいて再度お試しください。");

  // 発行時に記録したSHA-256と一致しないファイルは渡さない。
  if (sha256Hex(bytes) !== doc.data.file_sha256) {
    console.error("[subscriptionInvoicePdf] sha256 mismatch", { documentId });
    return plain(500, "請求書の整合性を確認できませんでした。運営へお問い合わせください。");
  }

  const download = new URL(request.url).searchParams.get("download") === "1";
  const filename = `invoice-${doc.data.invoice_number}.pdf`.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
