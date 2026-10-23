import type { Database } from "@/types/database";

type Functions = Database["public"]["Functions"];

export type AdminSuccessFee = Functions["get_admin_success_fees"]["Returns"][number];
export type CompanySuccessFee = Functions["get_company_success_fees"]["Returns"][number];

export type SuccessFeeStatus =
  | "pending_confirmation"
  | "confirmed"
  | "invoiced"
  | "paid"
  | "waived"
  | "cancelled";

export type SuccessFeeAction = "confirm" | "invoice" | "paid" | "waive" | "cancel";

export type BillingActionResult = { success: true } | { success: false; error: string };
