import assert from "node:assert/strict";
import test from "node:test";
import { AuthAbuseGuard, AuthRateLimitError } from "../src/web/authAbuseGuard.js";

test("auth guard rate-limits repeated failures per identifier and recovers after window", () => {
  let now = 1_000;
  const guard = new AuthAbuseGuard({
    loginPerIdentifierLimit: 3,
    loginPerIdentifierWindowMs: 1_000,
    globalLoginFailureLimit: 100,
    globalLoginFailureWindowMs: 10_000,
    now: () => now
  });

  for (let i = 0; i < 3; i += 1) {
    guard.assertLoginAllowed("AdminUser");
    guard.recordLoginFailure("adminuser");
  }
  assert.throws(() => guard.assertLoginAllowed("ADMINUSER"), /로그인 시도가 너무 많습니다/);

  now += 1_001;
  assert.doesNotThrow(() => guard.assertLoginAllowed("adminuser"));
});

test("successful login clears the identifier failure bucket", () => {
  const guard = new AuthAbuseGuard({ loginPerIdentifierLimit: 2, now: () => 10_000 });
  guard.recordLoginFailure("seller@example.com");
  guard.recordLoginFailure("seller@example.com");
  assert.throws(() => guard.assertLoginAllowed("seller@example.com"));

  guard.recordLoginSuccess("SELLER@example.com");
  assert.doesNotThrow(() => guard.assertLoginAllowed("seller@example.com"));
});

test("global login failure limit fails closed under distributed guessing", () => {
  const guard = new AuthAbuseGuard({
    loginPerIdentifierLimit: 100,
    loginPerSourceLimit: 100,
    globalLoginFailureLimit: 3,
    globalLoginFailureWindowMs: 60_000,
    now: () => 50_000
  });
  guard.recordLoginFailure("a@example.com", "cf:203.0.113.1");
  guard.recordLoginFailure("b@example.com", "cf:203.0.113.2");
  guard.recordLoginFailure("c@example.com", "cf:203.0.113.3");
  assert.throws(() => guard.assertLoginAllowed("new@example.com", "cf:203.0.113.4"), /일시적으로 제한/);
});

test("login guard limits one request source across many identifiers", () => {
  let now = 20_000;
  const guard = new AuthAbuseGuard({
    loginPerIdentifierLimit: 100,
    loginPerSourceLimit: 3,
    loginPerSourceWindowMs: 2_000,
    globalLoginFailureLimit: 100,
    now: () => now
  });

  guard.recordLoginFailure("one@example.com", "cf:198.51.100.7");
  guard.recordLoginFailure("two@example.com", "cf:198.51.100.7");
  guard.recordLoginFailure("three@example.com", "cf:198.51.100.7");

  assert.throws(
    () => guard.assertLoginAllowed("four@example.com", "cf:198.51.100.7"),
    (error: unknown) => error instanceof AuthRateLimitError && error.retryAfterSeconds === 2
  );
  assert.doesNotThrow(() => guard.assertLoginAllowed("four@example.com", "cf:198.51.100.8"));

  now += 2_001;
  assert.doesNotThrow(() => guard.assertLoginAllowed("four@example.com", "cf:198.51.100.7"));
});

test("signup guard caps requests and releases after its window", () => {
  let now = 0;
  const guard = new AuthAbuseGuard({ globalSignupLimit: 2, globalSignupWindowMs: 1_000, signupPerSourceLimit: 100, now: () => now });
  guard.assertAndRecordSignupAllowed("cf:203.0.113.10");
  guard.assertAndRecordSignupAllowed("cf:203.0.113.11");
  assert.throws(() => guard.assertAndRecordSignupAllowed("cf:203.0.113.12"), /가입 신청이 일시적으로 제한/);

  now = 1_001;
  assert.doesNotThrow(() => guard.assertAndRecordSignupAllowed("cf:203.0.113.12"));
});

test("signup guard limits one request source without blocking another", () => {
  const guard = new AuthAbuseGuard({
    signupPerSourceLimit: 2,
    signupPerSourceWindowMs: 60_000,
    globalSignupLimit: 100,
    now: () => 10_000
  });
  guard.assertAndRecordSignupAllowed("cf:192.0.2.40");
  guard.assertAndRecordSignupAllowed("cf:192.0.2.40");
  assert.throws(() => guard.assertAndRecordSignupAllowed("cf:192.0.2.40"), /현재 접속 위치에서 가입 신청이 너무 많습니다/);
  assert.doesNotThrow(() => guard.assertAndRecordSignupAllowed("cf:192.0.2.41"));
});

test("tracked identifier buckets stay bounded", () => {
  let now = 0;
  const guard = new AuthAbuseGuard({ maxTrackedIdentifiers: 2, loginPerIdentifierLimit: 1, loginPerSourceLimit: 100, now: () => now });
  guard.recordLoginFailure("first", "source-a");
  now += 1;
  guard.recordLoginFailure("second", "source-b");
  now += 1;
  guard.recordLoginFailure("third", "source-c");

  assert.doesNotThrow(() => guard.assertLoginAllowed("first", "source-d"));
  assert.throws(() => guard.assertLoginAllowed("second", "source-d"));
  assert.throws(() => guard.assertLoginAllowed("third", "source-d"));
});
