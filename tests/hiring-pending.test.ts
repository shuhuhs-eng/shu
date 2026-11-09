import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countPendingPositiveScouts } from "../lib/hiring/pending";

test("採用進捗に未追加の前向き返信だけを、美容師単位で数える", () => {
  const scouts = [
    { stylist_user_id: "a", response_status: "interested" },
    { stylist_user_id: "a", response_status: "question" }, // 同じ美容師は1人
    { stylist_user_id: "b", response_status: "interested" }, // 追加済み
    { stylist_user_id: "c", response_status: "considering" },
    { stylist_user_id: "d", response_status: "declined" },
    { stylist_user_id: "e", response_status: "no_response" },
    { stylist_user_id: "f", response_status: "question" },
  ];
  assert.equal(countPendingPositiveScouts(scouts, [{ stylist_user_id: "b" }]), 2);
  assert.equal(countPendingPositiveScouts([], []), 0);
});

test("静的検査: 候補者化は既存RPC経由のみ（Scout/通知の実装が採用進捗を自動作成・直接更新しない）", () => {
  const sql = readFileSync("supabase/migrations/0051_scout_notifications.sql", "utf8").replace(/--.*$/gm, "");
  assert.ok(!/insert\s+into\s+public\.store_hiring_processes|update\s+public\.store_hiring_processes/i.test(sql));
  assert.ok(!/add_hiring_candidate/.test(sql), "自動で候補者化しない（店舗側の明示操作のみ）");
  const actions = readFileSync("lib/hiring/actions.ts", "utf8");
  assert.match(actions, /rpc\("add_hiring_candidate"/);
  assert.ok(!/from\("store_hiring_processes"\)\s*\.(insert|update)/.test(actions));
});

test("静的検査: 通知はscouts起点（related_entity_type='scout'）で、notificationsにstore_idを足さず、既存RPCを再定義しない", () => {
  const sql = readFileSync("supabase/migrations/0051_scout_notifications.sql", "utf8").replace(/--.*$/gm, "");
  assert.match(sql, /'scout'/);
  assert.ok(!/alter\s+table\s+public\.notifications/i.test(sql));
  assert.ok(!/function\s+public\.(send_scout|send_scout_v2|respond_scout)\b/i.test(sql));
  assert.match(sql, /revoke all on function public\.create_scout_notification/);
});
