import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  NaverSolutionJwtError,
  verifyNaverSolutionSellerJwt
} from "../src/markets/naverSolutionJwt.js";

const now = 1_800_000_000;
const solutionId = "sellerhub-solution";
const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();

function token(overrides: Record<string, unknown> = {}, headerOverrides: Record<string, unknown> = {}) {
  const header = { alg: "RS256", typ: "JWT", ...headerOverrides };
  const payload = {
    iss: "merc",
    sub: "SELLER_INFO",
    iat: now - 5,
    exp: now + 60,
    solutionId,
    accountUid: "seller-account-uid",
    roleGroupType: "ACCOUNT",
    ...overrides
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput, "ascii"), keyPair.privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

function verify(value: string, overrides: Partial<{ solutionId: string; publicKeyPem: string; nowSeconds: number }> = {}) {
  return verifyNaverSolutionSellerJwt({
    token: value,
    solutionId: overrides.solutionId ?? solutionId,
    publicKeyPem: overrides.publicKeyPem ?? publicKeyPem,
    nowSeconds: overrides.nowSeconds ?? now
  });
}

test("accepts a valid Naver Commerce Solution seller JWT and returns only safe mapping fields", () => {
  assert.deepEqual(verify(token()), {
    accountUid: "seller-account-uid",
    issuedAt: now - 5,
    expiresAt: now + 60
  });
});

test("rejects a forged signature", () => {
  const [header, payload] = token().split(".");
  const forged = `${header}.${payload}.${Buffer.from("forged").toString("base64url")}`;
  assert.throws(() => verify(forged), NaverSolutionJwtError);
});

test("rejects a token signed by a different RSA key", () => {
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const otherPublic = other.publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.throws(() => verify(token(), { publicKeyPem: otherPublic }), /서명 검증/);
});

test("rejects algorithm substitution before trusting claims", () => {
  assert.throws(() => verify(token({}, { alg: "HS256" })), /서명 알고리즘/);
});

test("rejects wrong issuer or subject", () => {
  assert.throws(() => verify(token({ iss: "other" })), /내용 형식/);
  assert.throws(() => verify(token({ sub: "OTHER" })), /내용 형식/);
});

test("rejects another solution's token", () => {
  assert.throws(() => verify(token({ solutionId: "other-solution" })), /SellerHub용/);
});

test("rejects Naver sub-manager accounts", () => {
  assert.throws(() => verify(token({ roleGroupType: "ACCOUNT_SUB" })), /부매니저/);
});

test("rejects expired and not-yet-valid tokens", () => {
  assert.throws(() => verify(token({ iat: now - 120, exp: now - 31 })), /만료/);
  assert.throws(() => verify(token({ iat: now + 31, exp: now + 120 })), /아직 유효하지/);
});

test("rejects missing seller account identity, role and malformed tokens", () => {
  assert.throws(() => verify(token({ accountUid: "" })), /내용 형식/);
  assert.throws(() => verify(token({ roleGroupType: "" })), /내용 형식/);
  assert.throws(() => verify("not-a-jwt"), /형식/);
  assert.throws(() => verify(`${"x".repeat(17_000)}.a.b`), /크기/);
});
