/**
 * パスワード条件の常時表示ヒント。エラー時だけでなく常に表示する
 * （美容師新規登録・サロン新規登録・パスワード更新の各画面で共用）。
 * 実際の検証ルールは lib/validation/auth.ts の passwordRule と対応させること。
 */
export function PasswordRequirementsHint() {
  return (
    <p className="mt-1 text-[12px] text-sub">
      8文字以上で、英字と数字をそれぞれ1文字以上使用してください
    </p>
  );
}
