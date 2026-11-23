/**
 * カード単位の既読化を、サーバー側の上限（1回200件。lib/notifications/actions.ts の MAX_NOTIFICATION_ENTITIES）以下に
 * 分割して順に呼ぶ。対象は切り捨てない（全件を必ずどれかの回に含める）。
 *  - 全回が成功したときだけ ok:true（未読バッジを消してよい）。
 *  - いずれかの回が失敗（success:false）または例外（通信断など）なら、そこで止めて ok:false と「未処理の残り」を返す
 *    （成功扱いにしない。再試行は残りだけを送ればよい。既読化は冪等＝同じ組を再送しても結果は同じ）。
 *  - 渡された組だけを送る（他のカードの未読には触れない。対象の拡大・追加はしない）。
 */
export const ENTITY_CHUNK_SIZE = 200;

export type NotificationEntity = { type: string; id: string };
export type ReadCall = (entities: NotificationEntity[]) => Promise<{ success: true; count: number } | { success: false; error: string }>;
export type ReadAllResult =
  | { ok: true; calls: number; marked: number }
  | { ok: false; calls: number; marked: number; remaining: NotificationEntity[]; reason: "failed" | "exception" };

/** 同一の組の重複だけを除き、順序を保って size 件ずつに分ける（切り捨てなし）。 */
export function chunkEntities(entities: NotificationEntity[], size: number = ENTITY_CHUNK_SIZE): NotificationEntity[][] {
  const seen = new Set<string>(); const uniq: NotificationEntity[] = [];
  for (const e of entities) { const k = `${e.type}\u0000${e.id}`; if (!seen.has(k)) { seen.add(k); uniq.push(e); } }
  const out: NotificationEntity[][] = [];
  for (let i = 0; i < uniq.length; i += size) out.push(uniq.slice(i, i + size));
  return out;
}

export async function markEntitiesReadInChunks(entities: NotificationEntity[], call: ReadCall): Promise<ReadAllResult> {
  const chunks = chunkEntities(entities);
  let calls = 0, marked = 0;
  for (let i = 0; i < chunks.length; i++) {
    calls++;
    try {
      const r = await call(chunks[i]);
      if (!r.success) return { ok: false, calls, marked, remaining: chunks.slice(i).flat(), reason: "failed" };
      marked += r.count;
    } catch {
      return { ok: false, calls, marked, remaining: chunks.slice(i).flat(), reason: "exception" };
    }
  }
  return { ok: true, calls, marked };
}

/** 画面の判断（バッジを消すか・再試行を表示するか・次に送る分）を結果から決める。全件成功のときだけ消す。 */
export function badgeOutcome(r: ReadAllResult): { clear: boolean; showRetry: boolean; remaining: NotificationEntity[] | null } {
  return r.ok ? { clear: true, showRetry: false, remaining: null } : { clear: false, showRetry: true, remaining: r.remaining };
}
