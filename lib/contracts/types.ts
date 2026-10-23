import type { Database } from "@/types/database";

type Fns = Database["public"]["Functions"];

export type AdminContractListItem = Fns["get_admin_organization_contracts"]["Returns"][number];
export type AdminContractDetail = Fns["get_admin_organization_contract"]["Returns"];
export type AdminContractEvent = AdminContractDetail["events"][number];
export type CompanyContractSettings = Fns["get_company_contract_settings"]["Returns"][number];

export const CONTRACT_STATUSES = ["trial", "active", "suspended", "cancelled"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export type ContractActionResult = { success: true; changed: boolean } | { success: false; error: string };
