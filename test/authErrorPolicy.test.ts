import assert from "node:assert/strict";
import test from "node:test";
import { safeAuthError } from "../src/web/authErrorPolicy.js";

test("reviewed authentication domain messages remain actionable", () => {
  assert.equal(
    safeAuthError("login", new Error("가입 승인 대기 중입니다. 운영자 승인 후 로그인할 수 있습니다.")).message,
    "가입 승인 대기 중입니다. 운영자 승인 후 로그인할 수 있습니다."
  );
  assert.equal(
    safeAuthError("signup", new Error("이미 가입 또는 가입 신청된 이메일입니다.")).message,
    "이미 가입 또는 가입 신청된 이메일입니다."
  );
  assert.equal(
    safeAuthError("signup_admin", new Error("이미 처리된 가입 신청입니다.")).message,
    "이미 처리된 가입 신청입니다."
  );
});

test("unexpected persistence and provider details are never returned as auth messages", () => {
  const secretFailure = new Error("EACCES /srv/sellerhub/data/accounts.json token=DO-NOT-LEAK");
  for (const operation of ["login", "signup", "signup_admin"] as const) {
    const safe = safeAuthError(operation, secretFailure).message;
    assert.doesNotMatch(safe, /EACCES|accounts\.json|DO-NOT-LEAK/);
  }
});

test("non-Error thrown values are also replaced with stable messages", () => {
  assert.equal(
    safeAuthError("login", "raw secret failure").message,
    "아이디/이메일 또는 비밀번호가 올바르지 않습니다."
  );
});
