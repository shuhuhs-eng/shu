/**
 * 「採用したい得意技術」は法人・店舗のプロフィール画面から入力欄を外した（保存データ・検索・相性判定は維持）。
 * 保存用RPCは p_target_specialties を必須で受け取り、そのまま上書きするため、画面から送られた値（古い画面の値や空配列）は使わず、
 * 保存の直前にDBの現在値を読み直して渡す。行がまだ無い（新規）ときだけ空配列。読み取りに失敗したときは保存しない（空で上書きしない）。
 */
export type SpecialtiesRead = { data: { target_specialties: string[] | null } | null; error: unknown };

export async function resolveStoredSpecialties(
  read: () => PromiseLike<SpecialtiesRead>,
): Promise<{ ok: true; value: string[] } | { ok: false }> {
  try {
    const { data, error } = await read();
    if (error) return { ok: false };
    return { ok: true, value: Array.isArray(data?.target_specialties) ? [...data.target_specialties] : [] };
  } catch {
    return { ok: false };
  }
}
