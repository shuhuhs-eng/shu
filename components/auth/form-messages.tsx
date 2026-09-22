/** フォーム全体のエラーメッセージ（赤系バナー）。role="alert" でスクリーンリーダーにも通知する。 */
export function FormErrorBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-xl border border-[#C24545]/30 bg-[#C24545]/10 px-4 py-3 text-[13.5px] leading-relaxed text-[#8A2E2E]"
    >
      {message}
    </p>
  );
}

/** フォーム全体の成功メッセージ（緑系バナー）。 */
export function FormSuccessBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className="rounded-xl border border-[#2E8B7F]/30 bg-[#2E8B7F]/10 px-4 py-3 text-[13.5px] leading-relaxed text-[#1E5D53]"
    >
      {message}
    </p>
  );
}

/** 個別入力欄の下に出す軽量なフィールドエラー。 */
export function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return (
    <p className="mt-1 text-[12.5px] text-[#8A2E2E]" role="alert">
      {messages[0]}
    </p>
  );
}
