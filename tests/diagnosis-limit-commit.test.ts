import { test } from "node:test";
import assert from "node:assert/strict";
import { commitDiagnosisResult, type CommitClient } from "../lib/diagnosis-limit/commit";
import { computeDiagnosis } from "../lib/diagnosis";

const answers = Array.from({ length: 30 }, () => 0);
const computed = computeDiagnosis("stylist", answers);
const args = { userId: "u1", requestId: "00000000-0000-4000-8000-000000000001", allowChange: true, computed, answers };

function client(rpcImpl: () => unknown) {
  const calls = { rpc: 0, insert: 0 };
  const c: CommitClient = {
    rpc: (async () => {
      calls.rpc += 1;
      return rpcImpl();
    }) as never,
    from: () => ({
      insert: () => {
        calls.insert += 1;
        return { select: () => ({ single: async () => ({ data: { id: "legacy-id" }, error: null }) }) };
      },
    }),
  };
  return { c, calls };
}

test("旧保存へ戻るのは「commit_diagnosis_result が存在しない」ときだけ（回数制限・権限・通信失敗・その他では戻らない）", async () => {
  const noFallback: Array<[string, () => unknown]> = [
    ["回数制限", () => ({ data: null, error: { code: "P0001", message: "diagnosis_change_locked", details: "2027-02-13T09:10:00Z" } })],
    ["初回済み", () => ({ data: null, error: { code: "P0001", message: "diagnosis_already_saved" } })],
    ["内容違い", () => ({ data: null, error: { code: "P0001", message: "request id content mismatch" } })],
    ["ゲート未通過", () => ({ data: null, error: { code: "P0001", message: "diagnosis_use_confirm" } })],
    ["権限エラー", () => ({ data: null, error: { code: "42501", message: "permission denied for function commit_diagnosis_result" } })],
    ["別関数の欠落", () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.something_else(x)" } })],
    ["サーバーエラー", () => ({ data: null, error: { code: "XX000", message: "internal error" } })],
    ["タイムアウト（エラー値）", () => ({ data: null, error: { message: "timeout" } })],
    ["応答が空", () => ({ data: null, error: null })],
    ["通信失敗（例外）", () => { throw new Error("fetch failed"); }],
  ];
  for (const [label, impl] of noFallback) {
    const { c, calls } = client(impl);
    const r = await commitDiagnosisResult(c, args);
    assert.equal(r.ok, false, label);
    assert.equal(calls.insert, 0, `${label}: 旧保存（直接INSERT）へ戻らない`);
    assert.equal(calls.rpc, 1, label);
  }
  // 存在しないときだけ旧保存へ
  const { c, calls } = client(() => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.commit_diagnosis_result(p_user_id) in the schema cache" } }));
  const r = await commitDiagnosisResult(c, args);
  assert.equal(r.ok, true);
  assert.equal(calls.insert, 1);
  assert.equal(r.ok && r.legacy, true);
});

test("制限エラーは利用者向けの文言と解除日時になり、失敗時は回数を数えていないと伝える", async () => {
  const { c } = client(() => ({ data: null, error: { code: "P0001", message: "diagnosis_change_locked", details: "2027-02-13T09:10:00Z" } }));
  const r = await commitDiagnosisResult(c, args);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error.code, "locked");
    assert.equal(r.error.lockedUntil, "2027-02-13T09:10:00Z");
    assert.match(r.error.message, /数えていません/);
  }
  const t = client(() => { throw new Error("fetch failed"); });
  const r2 = await commitDiagnosisResult(t.c, args);
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.match(r2.error.message, /数えていません/);
});
