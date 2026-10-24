"use client";

/** ルートレイアウト自体が失敗した場合の最終フォールバック（html/body を自前で持つ）。 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ja">
      <body style={{ fontFamily: "sans-serif", padding: "48px 20px", maxWidth: 480, margin: "0 auto" }}>
        <h1 style={{ fontSize: 20 }}>一時的に表示できません</h1>
        <p style={{ fontSize: 14, lineHeight: 1.7 }}>問題が発生しました。少し時間をおいて再度お試しください。</p>
        <button type="button" onClick={reset} style={{ padding: "12px 24px", borderRadius: 999, background: "#111", color: "#fff", border: 0 }}>
          もう一度試す
        </button>
      </body>
    </html>
  );
}
