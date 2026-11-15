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

test("制限エラーは利用者向けの文言と解除日時になり、DBが取り消したと確定できる失敗は回数を数えていないと伝え、通信切れは結果不明として分ける", async () => {
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
  if (!r2.ok) {
    // 通信切れなど結果不明は、保存されたか分からないので「数えていません」とは言わない
    assert.equal(r2.error.code, "uncertain");
    assert.equal(r2.error.definite, false);
    assert.doesNotMatch(r2.error.message, /数えていません/);
    assert.match(r2.error.message, /二重には数えません/);
  }
});

test("デッドロック（40P01）・直列化失敗（40001）で保存に失敗したときは、成功と表示せず、旧保存へも戻らず、同じ送信IDで再試行できる", async () => {
  for (const [code, message] of [["40P01", "deadlock detected"], ["40001", "could not serialize access"]] as const) {
    const { c, calls } = client(() => ({ data: null, error: { code, message, details: "Process 1 waits for ..." } }));
    const r = await commitDiagnosisResult(c, args);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.code, "busy");
      assert.match(r.error.message, /保存できませんでした/);
      assert.match(r.error.message, /数えていません/);
      assert.match(r.error.message, /同じ内容で、もう一度/);
      assert.ok(!/保存しました|保存できました|完了/.test(r.error.message));
    }
    assert.equal(calls.insert, 0, "旧保存（直接INSERT）へ戻らない");
  }
  // 再試行: 同じ送信ID・同じ内容で呼べて、成功すれば通常の成功として返る（二重保存の防止はDBが行う）
  let n = 0;
  const { c } = client(() => (++n === 1
    ? { data: null, error: { code: "40P01", message: "deadlock detected" } }
    : { data: { result_id: "r1", action: "unchanged", replay: false, locked_until: null }, error: null }));
  const first = await commitDiagnosisResult(c, args);
  const second = await commitDiagnosisResult(c, args);
  assert.equal(first.ok, false);
  assert.equal(second.ok, true);
});
