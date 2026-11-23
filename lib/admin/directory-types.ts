/** 運営の一覧・詳細の型（型のみ。権限・DB呼び出しを持たない）。 */
export type Person = { user_id: string; role: string; name: string | null; email: string; since?: string };
export type OrgRow = {
  id: string; name: string; status: string; created_at: string; store_count: number;
  /** 絞り込み条件（所在地・公開状態・利用状態）を【1店舗で】すべて満たした店舗の数。絞り込みが無いときは 0。 */
  matched_store_count: number;
  stores: { id: string; name: string; prefecture: string | null; city: string | null; visibility: string | null; usage_status: string; matches_filter: boolean; matches_query: boolean }[];
  members: Person[];
};
export type OrgDetail = {
  organization: { id: string; name: string; status: string; created_at: string };
  stores: { id: string; name: string; status: string; usage_status: string; visibility: string | null; prefecture: string | null; city: string | null; address_source: "profile" | "store" | null; members: Person[] }[];
  members: Person[];
  hiring_process_count: number;
};
export type RegistrationState = "completed" | "in_progress" | "no_profile";
export const REGISTRATION_STATES: RegistrationState[] = ["completed", "in_progress", "no_profile"];
export type SalonRegistrant = { user_id: string; email: string; name: string | null; email_confirmed: boolean; onboarding_step: number; created_at: string; has_salon_profile: boolean };
export type StylistRow = {
  registration_state: RegistrationState; onboarding_step: number;
  user_id: string; public_name: string | null; full_name: string | null; email: string; visibility: string;
  residence_prefecture: string | null; desired_work_location: string | null; experience_years: number | null;
  job_change_intent: string | null; created_at: string; diagnosis_type: string | null;
};
export type StylistDetail = StylistRow & {
  updated_at: string; current_position: string | null; specialties: string[]; employment_type: string | null; bio: string | null;
  diagnosis: { type_id: string; type_name: string; diagnosed_at: string } | null;
  preference_status: string | null; evidence: Record<string, number>;
  hiring_processes: { id: string; store_id: string; store_name: string; organization_name: string; status: string; source: string; updated_at: string }[];
};

