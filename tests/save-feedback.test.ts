import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SaveFeedback } from "@/components/profile/save-feedback";

const html = (props: { success?: string; error?: string }) => renderToStaticMarkup(createElement(SaveFeedback, props));

test("保存結果: 何も無いときは文言が出ない（読み上げ用の領域だけ残る）", () => {
  const h = html({});
  assert.ok(h.includes('role="status"') && h.includes('aria-live="polite"') && h.includes('role="alert"'));
  assert.ok(!h.includes("保存しました") && !h.includes("<svg"));
});

test("保存結果: 成功はチェックマーク付きで、polite の読み上げ領域に入る", () => {
  const h = html({ success: "保存しました" });
  const status = h.slice(h.indexOf('role="status"'), h.indexOf('role="alert"'));
  assert.ok(status.includes("保存しました") && status.includes('<svg aria-hidden="true"'));
});

test("保存結果: 失敗は alert の領域に入り、成功の文言は出ない", () => {
  const h = html({ error: "保存に失敗しました" });
  const alertPart = h.slice(h.indexOf('role="alert"'));
  assert.ok(alertPart.includes("保存に失敗しました"));
  assert.ok(!h.includes("保存しました") && !h.includes("<svg"));
});

test("プロフィール編集フォーム: 保存ボタン直下に結果を出し、保存処理（Server Action・RPC）は変えない", () => {
  const src = readFileSync("components/profile/profile-form.tsx", "utf8");
  assert.ok(src.indexOf("<SaveFeedback") > src.indexOf('type="submit"'), "結果の表示はボタンの後ろ（直下）");
  assert.ok(src.includes('"保存中…"') && src.includes("disabled={isPending}"));
  assert.ok(src.includes("saveProfileAction") && !src.includes("FormSuccessBanner"));
  const actions = readFileSync("lib/profile/actions.ts", "utf8");
  assert.ok(actions.includes('rpc("save_stylist_profile_v2"') && actions.includes('rpc("save_stylist_profile"'));
});
