import type { Database } from "@/types/database";

/**
 * 採用進捗（0037）まわりの型定義。RPCの戻り値型（types/database.ts）を正として導出する。
 */
type Functions = Database["public"]["Functions"];

/** 店舗側: 採用進捗の1行（get_store_hiring_processes）。社内メモ・理由を含む店舗専用データ。 */
export type StoreHiringProcess = Functions["get_store_hiring_processes"]["Returns"][number];

/** 店舗側: 採用進捗の履歴の1行（get_hiring_process_events）。 */
export type HiringProcessEvent = Functions["get_hiring_process_events"]["Returns"][number];

/** 美容師側: 自分の採用進捗の1行（get_my_hiring_processes）。社内情報は含まれない。 */
export type MyHiringProcess = Functions["get_my_hiring_processes"]["Returns"][number];

export type MyHiringProcessEvent = MyHiringProcess["events"][number];

export type HiringStatus =
  | "contacting"
  | "interview_scheduled"
  | "interview_completed"
  | "selection"
  | "offered"
  | "hired"
  | "declined"
  | "rejected";

export type InterviewType = "online" | "in_person" | "phone";

export type ActionResult = { success: true } | { success: false; error: string };

export type HiringReasonCode =
  | "skill_mismatch"
  | "culture_mismatch"
  | "conditions_mismatch"
  | "timing"
  | "other_offer"
  | "position_filled"
  | "other";
