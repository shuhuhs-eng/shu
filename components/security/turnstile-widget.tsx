"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Cloudflare Turnstile ウィジェット（Bot対策）。
 *
 * フォーム内に置くと、確認が完了したときだけ hidden input（name="cf-turnstile-response"）に
 * トークンが入る。トークンは1回しか使えないため、送信のたびに `resetKey` を変えて再発行する
 * （useActionState の state などを渡す）。
 *
 * ・サイトキー（NEXT_PUBLIC_TURNSTILE_SITE_KEY）は公開してよい値。秘密鍵はサーバー専用で、ここには出ない。
 * ・サイトキー未設定（開発）のときは何も表示しない。サーバー側は本番ではトークン無しを必ず拒否するので、
 *   ここが表示されないことで検証が緩むことはない。
 * ・<fieldset disabled> の中に置かないこと（disabledな入力はフォーム送信に含まれない）。
 */
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    let el = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
    if (!el) {
      el = document.createElement("script");
      el.src = SCRIPT_SRC;
      el.async = true;
      el.defer = true;
      el.dataset.turnstile = "1";
      document.head.appendChild(el);
    }
    el.addEventListener("load", () => resolve());
    el.addEventListener("error", () => reject(new Error("turnstile script failed")));
  });
}

export function TurnstileWidget({ resetKey }: { resetKey?: unknown }) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState("");

  useEffect(() => {
    if (!SITE_KEY || !container.current) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile || widgetId.current) return;
        widgetId.current = window.turnstile.render(container.current, {
          sitekey: SITE_KEY,
          callback: (t: string) => setToken(t),
          "expired-callback": () => setToken(""),
          "error-callback": () => setToken(""),
        });
      })
      .catch(() => setToken(""));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, []);

  // 送信のたびに（トークンは使い切りなので）再発行する。
  useEffect(() => {
    if (resetKey === undefined || !widgetId.current || !window.turnstile) return;
    window.turnstile.reset(widgetId.current);
    setToken("");
  }, [resetKey]);

  if (!SITE_KEY) return null;
  return (
    <div>
      <div ref={container} />
      <input type="hidden" name="cf-turnstile-response" value={token} />
    </div>
  );
}
