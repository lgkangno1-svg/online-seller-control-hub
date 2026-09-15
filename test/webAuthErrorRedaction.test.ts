import assert from "node:assert/strict";
import test from "node:test";
import type { AccountStore } from "../src/persistence/accountStore.js";
import { WebAuth } from "../src/web/webAuth.js";

function failingAccounts(): AccountStore {
  const secretFailure = () => Promise.reject(new Error("EACCES /srv/private/accounts.json secret=DO-NOT-LEAK"));
  return {
    login: secretFailure,
    requestSignup: secretFailure,
    approveSignup: secretFailure,
    rejectSignup: secretFailure
  } as unknown as AccountStore;
}

async function rejectionMessage(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation();
    assert.fail("operation should reject");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

test("WebAuth does not expose account persistence failures through login", async () => {
  const auth = new WebAuth(failingAccounts(), undefined, true, null);
  const message = await rejectionMessage(() => auth.login("user@example.com", "password123", "peer:test"));
  assert.equal(message, "아이디/이메일 또는 비밀번호가 올바르지 않습니다.");
  assert.doesNotMatch(message, /EACCES|accounts\.json|DO-NOT-LEAK/);
});

test("WebAuth does not expose account persistence failures through signup or admin actions", async () => {
  const auth = new WebAuth(failingAccounts(), undefined, true, null);
  const signup = await rejectionMessage(() => auth.requestSignup({ email: "user@example.com", password: "password123" }, "peer:test"));
  const approve = await rejectionMessage(() => auth.approveSignup("usr_test"));
  const reject = await rejectionMessage(() => auth.rejectSignup("usr_test"));

  assert.equal(signup, "가입 신청을 처리할 수 없습니다. 입력 정보를 확인해 주세요.");
  assert.equal(approve, "가입 신청 상태를 변경할 수 없습니다.");
  assert.equal(reject, "가입 신청 상태를 변경할 수 없습니다.");
  assert.doesNotMatch(`${signup} ${approve} ${reject}`, /EACCES|accounts\.json|DO-NOT-LEAK/);
});
