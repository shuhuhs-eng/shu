/**
 * 採用契約（0109・提案・未適用）の画面側の規則・表示。★操作の可否の最終判断はDB（RPCが権限・状態・待機期間を再確認する）。
 * 流れ: ①本人の入社意思確認（運営＝エージェントが必ず行う。代理不可）→②サロンの内定操作（または、①の7日後に責任者が理由付きで代理）→③請求予定（入社予定日の翌日）。
 * ★自動請求はここでは行わない。請求予定は「予定」の記録で、DBの設定 auto_charge_enabled（既定 false）と未決定事項が揃うまで請求は実行されない。
 */
export type AgreementStatus = "awaiting_intent" | "awaiting_salon" | "confirmed" | "declined" | "cancelled" | "not_opened";
export type FeeRole = "stylist" | "assistant";
export type ScheduleStatus = "scheduled" | "charging" | "charged" | "charge_unknown" | "retry_wait" | "invoice_switch" | "cancelled";

export const AGREEMENT_STATUS_LABELS: Record<AgreementStatus, string> = {
  not_opened: "契約未作成", awaiting_intent: "本人の入社意思確認待ち", awaiting_salon: "サロンの内定操作待ち", confirmed: "採用確定", declined: "辞退", cancelled: "取消",
};
export const FEE_ROLE_LABELS: Record<FeeRole, string> = { stylist: "スタイリスト", assistant: "アシスタント" };
/** 2026-11-27決定: 採用料の区分は「運営が本人に確認した登録区分」。入社先での担当業務では決めない。 */
export const FEE_ROLE_FIELD_LABEL = "本人に確認した登録区分（採用料）";
export const FEE_ROLE_GUIDE = "本人に確認した登録区分です。入社先で担当する業務（例: スタイリスト登録の人がアシスタント業務を担当）では決めません。スタイリスト登録は税抜550,000円、アシスタント登録は税抜450,000円です。";
export const FEE_ROLE_UNCONFIRMED_GUIDE = "登録区分が空欄・不明・食い違うときは、本人に確認が取れるまで入力せず、記録しないでください（記録するまでサロンは内定を確定できません）。";
export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = {
  scheduled: "請求予定（未請求）", charging: "請求中", charged: "請求済み", charge_unknown: "結果不明（要確認）", retry_wait: "請求失敗・再試行待ち", invoice_switch: "請求書払いへの切替案内", cancelled: "取消",
};

export type AgreementRow = {
  agreement_id: string | null; hiring_process_id: string; status: AgreementStatus; fee_role: FeeRole | null; start_date: string | null;
  stylist_intent_confirmed_at: string | null; salon_confirmed_at: string | null; salon_confirmed_via: "salon" | "proxy" | null;
  needs_refund_review: boolean; needs_reconfirm: boolean; revision: number | null; updated_at: string; stylist_user_id: string; store_name: string; organization_name: string;
  schedule_status: ScheduleStatus | null; charge_on: string | null; total_amount: number | null; proxy_available: boolean;
};
export type AgreementDetail = {
  agreement: {
    id: string; hiring_process_id: string; status: AgreementStatus; fee_role: FeeRole | null; start_date: string | null; stylist_user_id: string;
    stylist_intent_confirmed_at: string | null; salon_confirmed_at: string | null; salon_confirmed_via: "salon" | "proxy" | null; proxy_reason: string | null;
    needs_refund_review: boolean; legacy_route_released_at?: string | null; close_reason: string | null; closed_at: string | null;
    revision: number; needs_reconfirm: boolean; terms_changed_at: string | null; reconfirmed_via: "salon" | "proxy" | null;
    confirmed_start_date: string | null; confirmed_fee_role: FeeRole | null; confirmed_fee_excl_tax: number | null; confirmed_tax: number | null; confirmed_total: number | null;
  };
  schedule: { id: string; status: ScheduleStatus; fee_role: FeeRole; fee_amount: number; tax_amount: number; total_amount: number; charge_on: string; next_attempt_on?: string | null; invoice_switch_guided_at?: string | null } | null;
  store_name: string; organization_name: string; proxy_wait_days: number; proxy_available_at: string | null; proxy_available: boolean; server_now: string;
  /** いまの設定での金額（確認済みの金額と食い違えば画面に出す）。未確定なら null。 */
  current_terms: { fee_excl_tax: number; tax: number; total: number } | null;
  process_status: string | null; fee_conflict: "legacy_fee" | "invoice_line" | null;
};
export type IntegrityItem = { kind: "fee_overlap" | "process_closed" | "status_not_synced" | "legacy_placeholder" | "card_missing" | "invoice_switch" | "notification_issue" | "attempt_stuck"; severity: "error" | "warn" | "info"; agreement_id: string; hiring_process_id: string; detail: string | null };
export const INTEGRITY_LABELS: Record<IntegrityItem["kind"], string> = {
  fee_overlap: "金額のある旧成功報酬／新方式の請求明細と、この契約が重なっています（二重請求のおそれ・請求予定は作られず、自動請求は開始されません）",
  process_closed: "採用が辞退・不採用なのに、契約が有効なままです（自動請求は開始されません。契約を辞退・取消にしてください）",
  status_not_synced: "契約は確認済みですが、採用の状況は採用確定になっていません（選考中・内定通知済みのときだけ自動で連動します。それ以外の状況は運営・サロンが確認してください）",
  card_missing: "請求日が近いのに、会社のカードが未登録・期限切れ・削除されています（カード登録はサロンの利用に必須。登録されるまで請求は保留されます）",
  invoice_switch: "自動請求が3回とも失敗しました。請求書払いへの切替を案内してください（自動では請求しません）",
  notification_issue: "Stripeの決済通知が、請求の内容（金額・通貨・顧客・モード・請求予定・決済ID）と一致しませんでした。支払済みにはしていません。Stripe管理画面で確認し、確認内容を残してください",
  attempt_stuck: "請求の試行が長く進行中・結果不明のまま残っています。自動の復旧（Stripe照合）で確定しない場合は、Stripe管理画面で入金を確認して記録してください（結果不明のまま新しい試行は作られません）",
  legacy_placeholder: "金額のない旧成功報酬の自動作成行が併存しています（請求ではありません。旧方式の確認操作をしないでください）",
};
export type BillingSetting = { key: string; value: string | null; status: "decided" | "undecided"; note: string | null; updated_at: string };
export type SalonAgreementView = {
  agreement_id: string; status: AgreementStatus; fee_role: FeeRole | null; start_date: string | null; stylist_intent_confirmed_at: string | null; salon_confirmed_at: string | null;
  fee_excl_tax: number | null; tax: number | null; charge_on: string | null;
  /** DBの版。確定・変更はこの版を送り、古い画面からの操作はDBが拒否する。 */
  revision: number; needs_reconfirm: boolean; total_amount: number | null;
  confirmed: { start_date: string; fee_role: FeeRole; total_amount: number; charge_on: string } | null;
};

export const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
export function isOpenAgreement(s: AgreementStatus): boolean { return s === "awaiting_intent" || s === "awaiting_salon" || s === "confirmed"; }

/** 画面の操作可否（目安）。責任者以外は代理・変更・辞退/取消不可。意思確認の記録は運営（スタッフを含む）。 */
export function agreementActions(status: AgreementStatus, isResponsible: boolean, proxyAvailable: boolean, scheduleStatus: ScheduleStatus | null = null, legacyReleased = false) {
  return {
    recordIntent: status === "awaiting_intent",
    proxyConfirm: isResponsible && (status === "awaiting_salon" || status === "confirmed") && proxyAvailable,   // 確認済みでも、条件変更後の再確認の代理（proxyAvailable はDBが判定）
    changePlan: isResponsible && (status === "awaiting_salon" || status === "confirmed"),
    close: isResponsible && isOpenAgreement(status),
    // D4: 請求前の辞退・取消では請求予定が自動で取り消される。旧成功報酬の経路へ戻すのは別の明示操作（責任者のみ）で、請求予定が無い／取消済みの契約だけ。
    switchToLegacy: isResponsible && !isOpenAgreement(status) && !legacyReleased && (scheduleStatus === null || scheduleStatus === "cancelled"),
  };
}

/** 設定のうち、画面で必ず明示する未決定項目。 */
export const UNDECIDED_NOTES: Record<string, string> = {
  hire_fee_role_source: "採用料の区分は、運営が本人に確認した登録区分を入力します（2026-11-27決定・自動判定はしません）。設定の記録がまだ更新されていないため「未決定」と表示されています。この設定が決定済みになるまで、自動請求は有効にできません。",
};

export function hireErrorMessage(m: string | undefined | null): string {
  const s = m ?? "";
  const map: [string, string][] = [
    ["waiting period has not elapsed", "本人の入社意思確認から7日が経っていないため、代理操作はできません。"],
    ["proxy reason required", "代理操作の理由を入力してください。"],
    ["responsible only", "この操作は責任者のみ行えます。"],
    ["admin access required", "運営の権限がありません。"],
    ["insufficient permission", "この操作の権限がありません。"],
    ["start date required", "入社予定日を入力してください。"],
    ["fee role required", "本人に確認した登録区分（スタイリスト／アシスタント）を選んでください。"],
    ["start date and fee role required", "入社予定日と、本人に確認した登録区分を入力してください。"],
    ["intent already recorded", "本人の入社意思確認は記録済みです。画面を読み込み直してください。"],
    ["salon confirmation is not available", "サロンの内定操作はできない状態です。画面を読み込み直してください。"],
    ["proxy confirmation is not available", "代理操作はできない状態です。画面を読み込み直してください。"],
    ["agreement is closed", "この契約は辞退・取消済みです。"],
    ["close reason required", "理由を入力してください。"],
    ["switch reason required", "切替の理由を入力してください。"],
    ["fee schedule is not cancelled", "請求が始まった契約は、返金の確認が済むまで旧方式へ切り替えられません。"],
    ["card is not registered", "会社のカードが未登録・期限切れ・削除されているため、請求は保留されています。"],
    ["agreement not found", "契約が見つかりません。"],
    ["hiring process not found", "採用の情報が見つかりません。"],
    ["stale agreement revision", "画面の内容が古くなっています（他の方が先に変更・確定しました）。読み込み直して最新の内容を確認してから、もう一度操作してください。"],
    ["confirmed terms do not match", "画面の入社予定日・登録区分が現在の内容と違います。読み込み直して最新の内容を確認してください。"],
    ["confirmed amount does not match", "採用料の金額が変わりました。読み込み直して最新の金額を確認してから、もう一度操作してください。"],
    ["fee settings are not decided", "採用料の設定が未確定のため、確定できません。"],
    ["intent is not recorded yet", "本人の入社意思確認が記録されていません。"],
    ["another fee already exists", "この採用には、すでに別の方式の採用料（旧成功報酬・請求明細）があります。二重請求を防ぐため操作できません。運営へご連絡ください。"],
    ["hiring process is closed", "この採用は辞退・不採用として記録されています。"],
    ["reconfirmation required", "条件が変更されたため、再確認が済むまで請求へ進めません。"],
  ];
  for (const [k, v] of map) if (s.includes(k)) return v;
  return "処理を完了できませんでした。時間をおいて再度お試しください。";
}

export function isRealDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
