/** 処理時間の計測用（サーバー側）。個人情報は扱わない。ミリ秒の差分だけを返す。 */
export function nowMs(): number {
  return performance.now();
}
