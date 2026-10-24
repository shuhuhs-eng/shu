import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { authorizedDownloadSchema } from "@/lib/invoices/types";
import { downloadInvoicePdf, sha256Hex } from "@/lib/invoices/storage";

/**
 * 発行済み請求書PDFの取得。
 *
 * ★署名URL方式とbytes返却方式を比べ、bytes返却を採用：
 *   署名URLは有効期間中ならURLを知る人が誰でも取得でき、転送・ログ・履歴に残る。
 *   このRouteは毎回「ログイン→権限確認＋監査記録（RPC）→Storage取得→SHA-256照合」を通し、
 *   保存先パスもURLもクライアントへ出さない。
 * ★権限（運営者／対象会社のcompany_owner・company_admin）と監査はDBの
 *   authorize_invoice_document_download が行う。通らなければStorageには触れない。
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

  const { data, error } = await supabase.rpc("authorize_invoice_document_download", { p_document_id: documentId });
  if (error) {
    console.error("[invoicePdf] authorize failed", { message: error.message, code: error.code });
    // 存在しない場合と権限が無い場合を区別しない。
    return plain(404, "請求書が見つかりません。");
  }
  const doc = authorizedDownloadSchema.safeParse(data);
  if (!doc.success) return plain(500, "請求書を取得できませんでした。");

  const bytes = await downloadInvoicePdf(doc.data.storage_path);
  if (!bytes) return plain(500, "請求書を取得できませんでした。時間をおいて再度お試しください。");

  // 発行時に記録したSHA-256と一致しないファイルは渡さない。
  if (sha256Hex(bytes) !== doc.data.file_sha256) {
    console.error("[invoicePdf] sha256 mismatch", { documentId });
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
