import assert from "node:assert/strict";
import test from "node:test";
import { safeInternalError } from "../src/web/internalError.js";

test("generic internal errors never expose exception messages, paths, secrets, or stacks", () => {
  const secret = "SECRET_ACCESS_KEY_123";
  const error = new Error(`provider failed with ${secret} at /srv/sellerhub/data/credentials.json`);
  error.stack = `Error: ${error.message}\n    at secretFunction (/srv/sellerhub/src/secret.ts:10:2)`;

  const safe = safeInternalError(error, "incident-test-001");
  assert.deepEqual(safe.body, {
    error: "internal_error",
    message: "요청 처리 중 내부 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    incidentId: "incident-test-001"
  });
  assert.deepEqual(safe.log, {
    incidentId: "incident-test-001",
    errorType: "Error"
  });

  const serialized = JSON.stringify(safe);
  assert.doesNotMatch(serialized, /SECRET_ACCESS_KEY_123|credentials\.json|secretFunction|provider failed/);
});

test("non-Error throws are reduced to type-only diagnostics", () => {
  const safe = safeInternalError({ apiKey: "DO_NOT_LOG" }, "incident-test-002");
  assert.equal(safe.log.errorType, "object");
  assert.doesNotMatch(JSON.stringify(safe), /DO_NOT_LOG/);
});
