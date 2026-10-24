import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * 請求書PDFのStorage操作（server専用）。
 * ★bucketは必ずprivate。公開URL・署名URLは作らない。保存先パスは会社ユーザーへ渡さない。
 * ★service roleクライアントは、権限確認（RPC）を通った後のこのモジュールの中だけで使う。
 */
export const INVOICE_BUCKET = "invoice-documents";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** privateのbucketが無ければ作る。公開設定になっていたら非公開へ戻す。失敗したらfalse。 */
export async function ensureInvoiceBucket(): Promise<boolean> {
  const admin = createServiceClient();
  const { data: bucket } = await admin.storage.getBucket(INVOICE_BUCKET);
  if (!bucket) {
    const { error } = await admin.storage.createBucket(INVOICE_BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) {
      console.error("[ensureInvoiceBucket] create failed", { message: error.message });
      return false;
    }
    return true;
  }
  if (bucket.public) {
    const { error } = await admin.storage.updateBucket(INVOICE_BUCKET, { public: false });
    if (error) {
      console.error("[ensureInvoiceBucket] could not make bucket private", { message: error.message });
      return false;
    }
  }
  return true;
}

export type UploadResult = { ok: true } | { ok: false; conflict: boolean };

/** 上書きなしでアップロードする。同じパスに既にファイルがある場合は conflict。 */
export async function uploadInvoicePdf(path: string, bytes: Uint8Array): Promise<UploadResult> {
  const admin = createServiceClient();
  const { error } = await admin.storage.from(INVOICE_BUCKET).upload(path, bytes, {
    contentType: "application/pdf",
    upsert: false,
    cacheControl: "0",
  });
  if (!error) return { ok: true };
  const conflict = /already exists|duplicate/i.test(error.message);
  console.error("[uploadInvoicePdf] failed", { message: error.message, conflict });
  return { ok: false, conflict };
}

export async function removeInvoicePdf(path: string): Promise<void> {
  const admin = createServiceClient();
  const { error } = await admin.storage.from(INVOICE_BUCKET).remove([path]);
  if (error) console.error("[removeInvoicePdf] failed", { message: error.message });
}

/** 既存ファイルが作られてからの経過ミリ秒。見つからなければ null。 */
export async function invoicePdfAgeMs(path: string): Promise<number | null> {
  const admin = createServiceClient();
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data } = await admin.storage.from(INVOICE_BUCKET).list(dir, { search: name, limit: 5 });
  const hit = data?.find((f) => f.name === name);
  const created = hit?.created_at ? Date.parse(hit.created_at) : NaN;
  return Number.isNaN(created) ? null : Date.now() - created;
}

export async function downloadInvoicePdf(path: string): Promise<Uint8Array | null> {
  const admin = createServiceClient();
  const { data, error } = await admin.storage.from(INVOICE_BUCKET).download(path);
  if (error || !data) {
    console.error("[downloadInvoicePdf] failed", { message: error?.message });
    return null;
  }
  return new Uint8Array(await data.arrayBuffer());
}
