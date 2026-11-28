import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { salonSelfSignupClosed } from "../lib/auth/salon-signup";

test("閉鎖はSALON_ACCOUNT_ISSUE_ENABLED=1のときだけ（既定は開いたまま）", () => {
  assert.equal(salonSelfSignupClosed({}), false);
  assert.equal(salonSelfSignupClosed({ SALON_ACCOUNT_ISSUE_ENABLED: "true" }), false);
  assert.equal(salonSelfSignupClosed({ SALON_ACCOUNT_ISSUE_ENABLED: "1" }), true);
});
test("サーバー側の登録処理でも閉鎖を確認し、招待のパスワード設定導線は残る", () => {
  const a = readFileSync("lib/auth/actions.ts", "utf8");
  assert.match(a, /signUpSalonAction[\s\S]{0,400}salonSelfSignupClosed\(\)[\s\S]{0,200}performSignUp\("salon"/);
  const i = readFileSync("lib/admin/salon-issue-actions.ts", "utf8");
  assert.match(i, /resetPasswordForEmail|resendSetPassword/);
  const m = readFileSync("lib/supabase/middleware.ts", "utf8");
  assert.match(m, /"\/update-password"|update-password/);
});
