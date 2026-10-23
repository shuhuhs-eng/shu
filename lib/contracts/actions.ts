"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { CONTRACT_STATUSES } from "./types";
import type { AdminContractDetail, AdminContractListItem, CompanyContractSettings, ContractActionResult } from "./types";

/** 運営者向けの契約一覧。権限が無い／失敗した場合は null（0件と誤表示しない）。 */
export async function getAdminOrganizationContracts(): Promise<AdminContractListItem[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_organization_contracts");
  if (error) {
    console.error("[getAdminOrganizationContracts] RPC failed", { message: error.message, code: error.code });
    return null;
  }
  return data ?? [];
}

/** 運営者向けの1社の契約と履歴。失敗した場合は null。 */
export async function getAdminOrganizationContract(organizationId: string): Promise<AdminContractDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_admin_organization_contract", { p_organization_id: organizationId });
  if (error) {
    console.error("[getAdminOrganizationContract] RPC failed", { message: error.message, code: error.code });
    return null;
  }
  return data ?? null;
}

/** 会社側の契約表示（company_owner / company_admin のみ）。失敗した場合は null。 */
export async function getCompanyContractSettings(): Promise<CompanyContractSettings[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_company_contract_settings", { p_organization_id: null });
  if (error) {
    console.error("[getCompanyContractSettings] RPC failed", { message: error.message, code: error.code });
    return null;
  }
  return data ?? [];
}

const inputSchema = z.object({
  organizationId: z.string().uuid(),
  /** 空文字 = 未設定（契約がまだ無い会社でのみ有効）。 */
  contractStatus: z.union([z.enum(CONTRACT_STATUSES), z.literal("")]),
  successFeeAmount: z.string().max(12),
  monthlyFee: z.string().max(12),
  startedAt: z.string().max(10),
  endedAt: z.string().max(10),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  note: z.string().max(1000),
  reason: z.string().max(1000),
});
export type UpdateContractInput = z.infer<typeof inputSchema>;

function parseOptionalYen(raw: string): number | null | "invalid" {
  const v = raw.trim().replace(/[,，]/g, "");
  if (v === "") return null;
  if (!/^\d{1,9}$/.test(v)) return "invalid";
  return Number(v);
}

function parseOptionalDate(raw: string): string | null | "invalid" {
  const v = raw.trim();
  if (v === "") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : "invalid";
}

function friendlyError(message: string): string {
  if (message.includes("admin access required")) return "この操作は運営者のみ可能です。";
  if (message.includes("organization not found")) return "会社が見つかりません。";
  if (message.includes("contract_ended_at must not be before")) return "契約終了日は契約開始日より後の日付にしてください。";
  if (message.includes("contract_status is required")) return "契約状態を選んでください。";
  if (message.includes("out of range") || message.includes("must be a number")) return "金額は0以上の整数（円）で入力してください。";
  if (message.includes("not a valid date") || message.includes("date string")) return "日付の形式が正しくありません。";
  if (message.includes("too long")) return "文字数が長すぎます。";
  return "保存できませんでした。時間をおいて再度お試しください。";
}

/**
 * 契約条件・年度開始月の更新（運営者のみ。権限の本体はRPC）。
 * ★現在値をサーバー側で取り直し、変わった項目だけをRPCへ渡す（クライアントの値を信用しない）。
 * ★一時停止・解約にするときは、理由を必須にする（DBは必須にしていないが、運用上の監査性のため）。
 */
export async function updateOrganizationContractAction(input: UpdateContractInput): Promise<ContractActionResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "入力内容を確認してください。" };
  const v = parsed.data;

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase.rpc("get_admin_organization_contract", { p_organization_id: v.organizationId });
  if (readError || !current) return { success: false, error: friendlyError(readError?.message ?? "") };

  const amount = parseOptionalYen(v.successFeeAmount);
  const monthly = parseOptionalYen(v.monthlyFee);
  const started = parseOptionalDate(v.startedAt);
  const ended = parseOptionalDate(v.endedAt);
  if (amount === "invalid" || monthly === "invalid") return { success: false, error: "金額は0以上の整数（円）で入力してください。" };
  if (started === "invalid" || ended === "invalid") return { success: false, error: "日付の形式が正しくありません。" };
  if (started !== null && ended !== null && ended < started) return { success: false, error: "契約終了日は契約開始日より後の日付にしてください。" };
  const note = v.note.trim() === "" ? null : v.note.trim();
  const reason = v.reason.trim() === "" ? null : v.reason.trim();

  const cur = current.contract;
  const changes: Record<string, string | number | null> = {};
  const diff = (key: string, next: string | number | null, prev: string | number | null) => {
    if (next !== prev) changes[key] = next;
  };

  if (cur === null) {
    const anyContractValue = amount !== null || monthly !== null || started !== null || ended !== null || note !== null;
    if (v.contractStatus === "" && anyContractValue) return { success: false, error: "契約状態を選んでください。" };
    if (v.contractStatus !== "") {
      changes["contract_status"] = v.contractStatus;
      if (amount !== null) changes["success_fee_amount"] = amount;
      if (monthly !== null) changes["monthly_fee"] = monthly;
      if (started !== null) changes["contract_started_at"] = started;
      if (ended !== null) changes["contract_ended_at"] = ended;
      if (note !== null) changes["note"] = note;
    }
  } else {
    if (v.contractStatus === "") return { success: false, error: "契約状態を選んでください。" };
    diff("contract_status", v.contractStatus, cur.contract_status);
    diff("success_fee_amount", amount, cur.success_fee_amount);
    diff("monthly_fee", monthly, cur.monthly_fee);
    diff("contract_started_at", started, cur.contract_started_at);
    diff("contract_ended_at", ended, cur.contract_ended_at);
    diff("note", note, cur.note);
  }
  diff("fiscal_year_start_month", v.fiscalYearStartMonth, current.fiscal_year_start_month);

  if (Object.keys(changes).length === 0) return { success: true, changed: false };

  const nextStatus = changes["contract_status"];
  if ((nextStatus === "suspended" || nextStatus === "cancelled") && reason === null) {
    return { success: false, error: "一時停止・解約にするときは、変更理由を入力してください。" };
  }

  const { data, error } = await supabase.rpc("admin_update_organization_contract", {
    p_organization_id: v.organizationId,
    p_changes: changes,
    p_reason: reason,
  });
  if (error || !data) {
    console.error("[updateOrganizationContractAction] RPC failed", { message: error?.message, code: error?.code });
    return { success: false, error: friendlyError(error?.message ?? "") };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/contracts");
  revalidatePath(`/admin/companies/${v.organizationId}`);
  revalidatePath(`/admin/companies/${v.organizationId}/contract`);
  revalidatePath("/salon/company/contract");
  revalidatePath("/salon/company/analytics");
  return { success: true, changed: data.changed };
}
