import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createServiceClient } from "@/lib/supabase/service";
import { readinessForAdmin } from "./subscription-readiness";
import { renderSubscriptionInvoicePdf } from "./subscription-pdf";
import { subscriptionObjectKey } from "./subscription-path";
import { ensureInvoiceBucket, invoicePdfAgeMs, removeInvoicePdf, sha256Hex, uploadInvoicePdf } from "./storage";
import {
  preparedSubscriptionInvoiceSchema, subscriptionPrepareResultSchema, subscriptionRegisteredSchema,
  type PreparedSubscriptionInvoice,
} from "./subscription-types";

/**
 * 月額の適格請求書PDFの発行（自動＝webhook／手動再試行＝運営者）。
 *
 * ★支払の記録(record_subscription_invoice_payment)とは完全に別の段階。ここが失敗しても支払記録は残る。
 *   結果は例外ではなく戻り値で返し、呼び出し側（webhook）は握りつぶして200を返せる。
 * ★順序：prepare（状態確認＋固定snapshot）→ snapshotだけからPDF生成 → SHA-256 → privateへupload
 *   → register（DBがsnapshotを再計算しdigest一致のときだけ記録）→ registerに失敗したらuploadを削除。
 * ★Storageのキーは subscriptionObjectKey() で 'subscription-invoices/...' に変換（成功報酬の 'invoices/...' と分離）。
 */
const ORPHAN_AGE_MS = 10 * 60 * 1000;

export type SubscriptionIssueResult =
  | { status: "issued" }
  | { status: "already_issued" }
  | { status: "not_ready"; missing: string[] }
  | { status: "failed"; reason: string };

type Prepared =
  | { kind: "already_issued" }
  | { kind: "not_ready"; missing: string[] }
  | { kind: "ready"; prepared: PreparedSubscriptionInvoice };

type Adapter = {
  prepare: () => Promise<Prepared>;
  register: (digest: string, sha: string) => Promise<boolean>;
};

async function run(adapter: Adapter): Promise<SubscriptionIssueResult> {
  let p: Prepared;
  try {
    p = await adapter.prepare();
  } catch (e) {
    return { status: "failed", reason: `prepare: ${e instanceof Error ? e.message : "unknown"}` };
  }
  if (p.kind === "already_issued") return { status: "already_issued" };
  if (p.kind === "not_ready") return { status: "not_ready", missing: p.missing };

  let bytes: Uint8Array;
  try {
    bytes = await renderSubscriptionInvoicePdf(p.prepared);
  } catch (e) {
    return { status: "failed", reason: `render: ${e instanceof Error ? e.message : "unknown"}` };
  }
  const sha = sha256Hex(bytes);
  let key: string;
  try {
    key = subscriptionObjectKey(p.prepared.storage_path);
  } catch {
    return { status: "failed", reason: "invalid storage path" };
  }

  try {
    if (!(await ensureInvoiceBucket())) return { status: "failed", reason: "bucket unavailable" };
    let upload = await uploadInvoicePdf(key, bytes);
    if (!upload.ok && upload.conflict) {
      // DBに発行記録が無いのに同名ファイルがある＝以前の失敗の残り。十分古いときだけ消してやり直す。
      const age = await invoicePdfAgeMs(key);
      if (age !== null && age > ORPHAN_AGE_MS) {
        await removeInvoicePdf(key);
        upload = await uploadInvoicePdf(key, bytes);
      } else {
        return { status: "failed", reason: "issuing in progress elsewhere" };
      }
    }
    if (!upload.ok) return { status: "failed", reason: "upload failed" };
  } catch (e) {
    return { status: "failed", reason: `storage: ${e instanceof Error ? e.message : "unknown"}` };
  }

  let registered = false;
  try {
    registered = await adapter.register(p.prepared.snapshot_digest, sha);
  } catch {
    registered = false;
  }
  if (registered) return { status: "issued" };

  // 通信エラー等で「実は記録されていた」場合にファイルを消さないよう、記録の有無を確かめてから後始末する。
  try {
    const again = await adapter.prepare();
    if (again.kind === "already_issued") return { status: "issued" };
  } catch {
    // 確認できないときはファイルを残す（孤立ファイルは次回の再試行で古ければ置き換わる）。
    return { status: "failed", reason: "register failed (state unknown)" };
  }
  await removeInvoicePdf(key);
  return { status: "failed", reason: "register failed" };
}

function parsePrepared(raw: unknown): Prepared {
  const parsed = subscriptionPrepareResultSchema.safeParse(raw);
  if (!parsed.success) throw new Error("unexpected snapshot shape");
  if (parsed.data.result === "already_issued") return { kind: "already_issued" };
  if (parsed.data.result === "not_ready") return { kind: "not_ready", missing: parsed.data.missing };
  const prepared = preparedSubscriptionInvoiceSchema.parse(parsed.data);
  return { kind: "ready", prepared };
}

/** webhookからの自動発行（service_role）。 */
export async function issueSubscriptionInvoiceAsSystem(paymentId: string): Promise<SubscriptionIssueResult> {
  const admin = createServiceClient();
  return run({
    async prepare() {
      const { data, error } = await admin.rpc("service_prepare_subscription_invoice", { p_payment_id: paymentId });
      if (error) throw new Error(error.message);
      return parsePrepared(data);
    },
    async register(digest, sha) {
      const { data, error } = await admin.rpc("service_register_subscription_invoice", {
        p_payment_id: paymentId, p_snapshot_digest: digest, p_file_sha256: sha,
      });
      return !error && subscriptionRegisteredSchema.safeParse(data).success;
    },
  });
}

/** 運営者による手動発行・再試行（ログイン中の運営者のクライアントで認可される）。 */
export async function issueSubscriptionInvoiceAsAdmin(
  supabase: SupabaseClient<Database>, paymentId: string,
): Promise<SubscriptionIssueResult> {
  return run({
    async prepare() {
      const { data: rd, error: rdErr } = await supabase.rpc("get_subscription_invoice_issue_readiness", { p_payment_id: paymentId });
      if (rdErr) throw new Error(rdErr.message);
      const r = readinessForAdmin(rd);
      if (r.alreadyIssued) return { kind: "already_issued" };
      if (r.missing.length > 0) return { kind: "not_ready", missing: r.missing };
      const { data, error } = await supabase.rpc("prepare_subscription_invoice_document", { p_payment_id: paymentId });
      if (error) throw new Error(error.message);
      const prepared = preparedSubscriptionInvoiceSchema.safeParse(data);
      if (!prepared.success) throw new Error("unexpected snapshot shape");
      return { kind: "ready", prepared: prepared.data };
    },
    async register(digest, sha) {
      const { data, error } = await supabase.rpc("register_subscription_invoice_document", {
        p_payment_id: paymentId, p_snapshot_digest: digest, p_file_sha256: sha,
      });
      return !error && subscriptionRegisteredSchema.safeParse(data).success;
    },
  });
}
