/**
 * 「前向きな返信があるのに、まだ採用進捗に追加していない美容師」の件数（店舗ダッシュボードの案内用）。
 * 追加の可否の本体はDB（add_hiring_candidate）。ここは表示の目印だけ。
 * 同じ美容師から複数のScout返信があっても1人として数える。
 */
export type PendingScout = { stylist_user_id: string; response_status: string };

export function countPendingPositiveScouts(
  scouts: ReadonlyArray<PendingScout>,
  processes: ReadonlyArray<{ stylist_user_id: string }>,
): number {
  const inProgress = new Set(processes.map((p) => p.stylist_user_id));
  const pending = new Set<string>();
  for (const s of scouts) {
    if ((s.response_status === "interested" || s.response_status === "question") && !inProgress.has(s.stylist_user_id)) {
      pending.add(s.stylist_user_id);
    }
  }
  return pending.size;
}
