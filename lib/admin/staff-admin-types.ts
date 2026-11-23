import type { Mailer } from "@/lib/admin/staff-invite";
/** 招待メール＋パスワード再設定メールの送り手。 */
export type StaffMailerLike = Mailer & { sendPasswordReset(to: string, link: string, displayName: string): Promise<void> };
