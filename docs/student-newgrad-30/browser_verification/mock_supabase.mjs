// ブラウザ確認用の疑似Supabase（HTTP）。保存先のモック。実Supabaseではない。
import http from "node:http";
import { randomUUID } from "node:crypto";
const PORT = 54399;
const USER = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "tester@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const state = { failCommit: 0, failPending: 0, commits: [], saves: new Map(), pendings: [], log: [], rpcs: {} };
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify(body)); };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x"); let body = ""; for await (const c of req) body += c;
  const b = body ? (() => { try { return JSON.parse(body); } catch { return body; } })() : null;
  if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }); return res.end(); }
  const p = url.pathname;
  if (p === "/__ctl") { Object.assign(state, b.set ?? {}); return json(res, 200, { ok: true }); }
  if (p === "/__state") return json(res, 200, { failCommit: state.failCommit, commits: state.commits, saves: [...state.saves.values()], pendings: state.pendings, unknown: state.log });
  if (p === "/auth/v1/user") return req.headers.authorization?.includes("fake-access") ? json(res, 200, USER) : json(res, 401, { message: "no session" });
  if (p.startsWith("/rest/v1/rpc/")) {
    const name = p.split("/").pop(); state.rpcs[name] = (state.rpcs[name] ?? 0) + 1;
    if (name === "check_rate_limit") return json(res, 200, [{ allowed: true, retry_after_seconds: 0 }]);
    if (name === "get_my_legal_acceptance_status") return json(res, 200, { accepted: true });
    if (name === "get_diagnosis_change_status") return json(res, 200, { state: "none" });
    if (name === "commit_diagnosis_result") {
      if (state.failCommit > 0) { state.failCommit--; state.commits.push({ requestId: b.p_request_id, ok: false }); return json(res, 500, { code: "XX000", message: "mock storage failure" }); }
      const prior = state.saves.get(b.p_request_id);
      state.commits.push({ requestId: b.p_request_id, ok: true, replay: !!prior });
      if (prior) return json(res, 200, { action: "initial", replay: true, result_id: prior.resultId, locked_until: null });
      const rec = { requestId: b.p_request_id, resultId: randomUUID(), version: b.p_diagnosis_version, answers: b.p_answers, market: b.p_market_value, salary: b.p_salary_band, scores: [b.p_craft, b.p_sense, b.p_hospitality, b.p_brand, b.p_drive, b.p_mentor] };
      state.saves.set(b.p_request_id, rec);
      return json(res, 200, { action: "initial", replay: false, result_id: rec.resultId, locked_until: null });
    }
    return json(res, 200, {});
  }
  if (p === "/rest/v1/pending_diagnoses" && req.method === "POST") {
    if (state.failPending > 0) { state.failPending--; return json(res, 500, { code: "XX000", message: "mock pending failure" }); }
    const row = { id: randomUUID(), claim_token: randomUUID(), mode: b.mode, answers: b.answers, diagnosis_version: b.diagnosis_version, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 864e5).toISOString(), claim_status: "PENDING", claimed_by: null };
    state.pendings.push(row); return json(res, 201, row);
  }
  if (p.startsWith("/rest/v1/")) { // 単一行要求（maybeSingle）は「0件」を返す
    if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) return json(res, 406, { code: "PGRST116", details: "The result contains 0 rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" });
    return json(res, 200, []);
  }
  state.log.push(req.method + " " + req.url); json(res, 404, { message: "mock: unknown" });
}).listen(PORT, "127.0.0.1", () => console.log("mock supabase on", PORT));
