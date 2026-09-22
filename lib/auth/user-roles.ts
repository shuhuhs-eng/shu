import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, UserRole } from "@/types/database";

/**
 * 複数role対応の判定は、この関数群を唯一の経路とする。
 * `profile.role === "salon"` のような単一値判定を新しいコードに増やさないため、
 * middleware・HOME(/)・/stylist/mypage・/salon/mypage・legacy /mypage 振り分けは
 * すべてここを経由する。
 *
 * user_roles の行の存在＝そのroleのオンボーディング完了（詳細は
 * supabase/migrations/0006_user_roles.sql のコメント参照）。
 */
export type UserRoleSet = Set<Exclude<UserRole, "admin">>;

/** 指定ユーザーが完了済みのrole一覧を取得する。 */
export async function getUserRoles(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<UserRoleSet> {
  const { data } = await supabase.from("user_roles").select("*").eq("user_id", userId);
  const roles = new Set<Exclude<UserRole, "admin">>();
  for (const row of data ?? []) {
    if (row.role === "stylist" || row.role === "salon") {
      roles.add(row.role);
    }
  }
  return roles;
}

/** 指定ユーザーが特定の1roleを完了済みかどうかだけを調べる（middlewareでの軽量チェック用）。 */
export async function hasCompletedRole(
  supabase: SupabaseClient<Database>,
  userId: string,
  role: "stylist" | "salon",
): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("*")
    .eq("user_id", userId)
    .eq("role", role)
    .maybeSingle();
  return !!data;
}

/**
 * 指定ユーザーの唯一のrole（stylist または salon）を返す。無ければnull。
 *
 * ★「1 auth user = 1 role」方針（0008_user_roles_single_role.sqlでDB側にも
 * unique(user_id)制約を追加済み）に基づく、単一role前提の判定ヘルパー。
 * これ以降の新しいrole別ルート制御・onboarding制御・TOP表示は、原則として
 * この関数（またはgetUserRoles/hasCompletedRoleのuser_roles参照）を正として
 * 使い、profiles.role には依存させない。
 *
 * 既存のgetUserRoles()/hasCompletedRole()（複数role時代からの関数）は
 * 後方互換のため変更していない。DBの新しいunique制約により、実際には
 * user_rolesの行は常に高々1件になるため、getUserRoles()が返すSetの要素数も
 * 自然に0または1になる。
 */
export async function getUserRole(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<"stylist" | "salon" | null> {
  const { data } = await supabase
    .from("user_roles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data?.role === "stylist" || data?.role === "salon") {
    return data.role;
  }
  return null;
}
