/** 認証系 Server Action の戻り値。フォームの再表示（エラー・成功メッセージ）に使う。 */
export type AuthActionState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  success?: string;
};

export const initialAuthActionState: AuthActionState = {};
