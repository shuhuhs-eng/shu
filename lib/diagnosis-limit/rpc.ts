/** 0058の新関数は型定義（自動生成）にまだ無いため、rpc呼び出しだけを緩い型で行う。 */
export type LooseRpc = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; details?: string; code?: string } | null }>;
};
export function looseRpc(client: unknown): LooseRpc {
  return client as LooseRpc;
}
