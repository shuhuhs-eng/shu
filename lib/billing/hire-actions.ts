"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { hireBillingEnabled } from "@/lib/billing/hire-flags";
import { hireErrorMessage, isRealDate } from "@/lib/billing/hire-agreement";
import { cardGateErrorMessage, salonCardBlockMessage } from "@/lib/billing/salon-card-gate";

/**
 * 採用契約の操作。DB草案0109（提案・未適用）が前提で、サーバー側フラグ HIRE_BILLING_ENABLED=1 のときだけ動く。
 * 権限は各RPCがDBで再確認する（運営／責任者のみ／店舗の採用管理権限者）。★ここは請求を実行しない（自動請求は無効のまま）。
 */
type Result = { success: true; data?: unknown } | { success: false; error: string };
const uuid = z.string().uuid();
const role = z.enum(["stylist", "assistant"]);
const date = z.string().refine(isRealDate, "date");
async function call(fn: string, args: Record<string, unknown>, paths: string[], salonSide = false): Promise<Result> {
  if (!hireBillingEnabled()) return { success: false, error: "この機能はまだ有効になっていません。" };
  const supabase = (await createClient()) as unknown as Pick<SupabaseClient, "rpc">;
  if (salonSide) { const cardBlock = await salonCardBlockMessage(supabase); if (cardBlock) return { success: false, error: cardBlock }; }   // サロン担当者の操作だけ事前に確認する（運営・責任者は対象外。DBのトリガーも同じ判定で拒否する）
  const { data, error } = await supabase.rpc(fn, args);
  if (error) { console.error(`[${fn}]`, { code: error.code }); return { success: false, error: cardGateErrorMessage(error.message) ?? hireErrorMessage(error.message) }; }
  for (const p of paths) revalidatePath(p);
  return { success: true, data };
}
const ADMIN = ["/admin/hire-agreements"];
/**
 * 採用料の登録区分ルール（hire_fee_role_source）を決定済みにする。責任者のみ（DBが再確認）。
 * ★固定の1操作だけ。項目名・値を画面から受け取らない。自動請求・カード必須化は変更しない（DBが前後で値の変化を検知すると全体を戻す）。履歴はDBが記録する。
 * DB 0112 が未適用ならこの関数が無く、失敗する（履歴が残らない変更は行わない）。
 */
export async function decideHireRoleRule(input: { understood: boolean }): Promise<Result> {
  if (!z.object({ understood: z.literal(true) }).safeParse(input).success) return { success: false, error: "内容を確認したことにチェックしてください。" };
  const r = await call("admin_billing_hire_role_rule_decide", {}, ADMIN);
  if (!r.success && r.error.includes("処理を完了できませんでした")) return { success: false, error: "決定を記録できませんでした。変更履歴の機能（DB 0112）が未適用か、責任者の権限がありません。何も変更されていません。" };
  return r;
}
const bad: Result = { success: false, error: "入力を確認してください。" };

export async function openHireAgreement(input: { hiringProcessId: string }): Promise<Result> {
  const p = z.object({ hiringProcessId: uuid }).safeParse(input); if (!p.success) return bad;
  return call("admin_hire_agreement_open", { p_hiring_process_id: p.data.hiringProcessId }, ADMIN);
}
const rev = z.number().int().min(1);
const money = z.number().int().min(0);
export async function recordStylistIntent(input: { agreementId: string; expectedRevision: number; startDate: string; feeRole: string; roleConfirmedWithStylist: boolean }): Promise<Result> {
  // 本人への登録区分の確認は、画面のチェックだけに頼らず、サーバー側でも確認済みの申告（true）が無ければ記録しない。
  const p = z.object({ agreementId: uuid, expectedRevision: rev, startDate: date, feeRole: role, roleConfirmedWithStylist: z.literal(true) }).safeParse(input);
  if (!p.success) return { success: false, error: "入社予定日（実在する日付）と、本人に確認した登録区分を入力し、本人に確認したことをチェックしてください。" };
  return call("admin_hire_record_stylist_intent", { p_agreement_id: p.data.agreementId, p_expected_revision: p.data.expectedRevision, p_start_date: p.data.startDate, p_fee_role: p.data.feeRole }, ADMIN);
}
/** 代理操作（責任者のみ・サロン未操作7日後）。画面が見た版・入社予定日・役職・金額を送り、DBが現在の値と照合する。 */
export async function proxyConfirmHire(input: { agreementId: string; reason: string; expectedRevision: number; startDate: string; feeRole: string; totalAmount: number }): Promise<Result> {
  const p = z.object({ agreementId: uuid, reason: z.string().trim().min(1).max(500), expectedRevision: rev, startDate: date, feeRole: role, totalAmount: money }).safeParse(input);
  if (!p.success) return { success: false, error: "代理操作の理由と、確認する条件（入社予定日・登録区分・金額）を確認してください。" };
  return call("admin_hire_proxy_confirm", { p_agreement_id: p.data.agreementId, p_reason: p.data.reason, p_expected_revision: p.data.expectedRevision, p_start_date: p.data.startDate, p_fee_role: p.data.feeRole, p_total_amount: p.data.totalAmount }, ADMIN);
}
export async function changeHirePlan(input: { agreementId: string; expectedRevision: number; startDate: string; feeRole: string; roleConfirmedWithStylist: boolean }): Promise<Result> {
  const p = z.object({ agreementId: uuid, expectedRevision: rev, startDate: date, feeRole: role, roleConfirmedWithStylist: z.literal(true) }).safeParse(input);
  if (!p.success) return { success: false, error: "入社予定日（実在する日付）と、本人に確認した登録区分を入力し、本人に確認し直したことをチェックしてください。" };
  return call("admin_hire_change_plan", { p_agreement_id: p.data.agreementId, p_expected_revision: p.data.expectedRevision, p_start_date: p.data.startDate, p_fee_role: p.data.feeRole }, ADMIN);
}
export async function closeHireAgreement(input: { agreementId: string; expectedRevision: number; kind: string; reason: string }): Promise<Result> {
  const p = z.object({ agreementId: uuid, expectedRevision: rev, kind: z.enum(["declined", "cancelled"]), reason: z.string().trim().min(1).max(500) }).safeParse(input);
  if (!p.success) return { success: false, error: "種別と理由を入力してください。" };
  return call("admin_hire_close", { p_agreement_id: p.data.agreementId, p_expected_revision: p.data.expectedRevision, p_kind: p.data.kind, p_reason: p.data.reason }, ADMIN);
}
/** 新旧方式の切替（D10）: 辞退・取消済みで請求予定が無い／取消済みの契約について、旧成功報酬の経路を再び使えるようにする（責任者のみ）。請求の取消とは別の操作。 */
export async function switchHireToLegacyRoute(input: { agreementId: string; expectedRevision: number; reason: string }): Promise<Result> {
  const p = z.object({ agreementId: uuid, expectedRevision: rev, reason: z.string().trim().min(1).max(500) }).safeParse(input);
  if (!p.success) return { success: false, error: "理由を入力してください。" };
  return call("admin_hire_legacy_route_release", { p_agreement_id: p.data.agreementId, p_expected_revision: p.data.expectedRevision, p_reason: p.data.reason }, ADMIN);
}
/** サロンの内定操作・条件変更後の再確認（店舗の採用管理権限者。DBが権限・版・条件・金額を確認する）。画面が見た内容をそのまま送る。 */
export async function salonConfirmOffer(input: { agreementId: string; expectedRevision: number; startDate: string; feeRole: string; totalAmount: number }): Promise<Result> {
  const p = z.object({ agreementId: uuid, expectedRevision: rev, startDate: date, feeRole: role, totalAmount: money }).safeParse(input); if (!p.success) return bad;
  return call("company_hire_confirm_offer", { p_agreement_id: p.data.agreementId, p_expected_revision: p.data.expectedRevision, p_start_date: p.data.startDate, p_fee_role: p.data.feeRole, p_total_amount: p.data.totalAmount }, ["/salon", ...ADMIN], true);
}
