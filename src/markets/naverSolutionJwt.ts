import { createPublicKey, verify as verifySignature } from "node:crypto";
import { z } from "zod";

const MAX_JWT_BYTES = 16 * 1024;
const CLOCK_SKEW_SECONDS = 30;

const headerSchema = z.object({
  alg: z.string().min(1).max(20),
  typ: z.string().optional()
}).passthrough();

const payloadSchema = z.object({
  iss: z.literal("merc"),
  sub: z.literal("SELLER_INFO"),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  solutionId: z.string().trim().min(1).max(200),
  accountUid: z.string().trim().min(1).max(500),
  roleGroupType: z.string().trim().min(1).max(50)
}).passthrough();

export type NaverSolutionSellerIdentity = {
  accountUid: string;
  issuedAt: number;
  expiresAt: number;
};

export class NaverSolutionJwtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NaverSolutionJwtError";
  }
}

/**
 * Verifies Naver Commerce Solution "바로 사용" seller JWTs.
 *
 * Security invariants:
 * - only RS256 is accepted (no algorithm negotiation / none / HS confusion)
 * - issuer, subject and solutionId must exactly match Naver's documented values
 * - tokens must be currently valid and short-lived
 * - signature is verified against the operator-configured solution public key
 * - Naver sub-manager accounts are rejected before any seller mapping is stored
 * - the raw JWT is never returned or logged
 */
export function verifyNaverSolutionSellerJwt(options: {
  token: string;
  solutionId: string;
  publicKeyPem: string;
  nowSeconds?: number;
}): NaverSolutionSellerIdentity {
  const token = options.token.trim();
  if (!token || Buffer.byteLength(token, "utf8") > MAX_JWT_BYTES) {
    throw new NaverSolutionJwtError("네이버 연결 토큰의 크기가 올바르지 않습니다.");
  }

  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new NaverSolutionJwtError("네이버 연결 토큰 형식이 올바르지 않습니다.");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const header = parseSegment(encodedHeader, headerSchema, "헤더");
  // Parse before signature only to enforce a fixed algorithm. Do not trust any
  // other payload claim until the cryptographic signature succeeds.
  if (header.alg !== "RS256") {
    throw new NaverSolutionJwtError("허용되지 않은 네이버 연결 토큰 서명 알고리즘입니다.");
  }

  const signature = decodeBase64Url(encodedSignature, "서명");
  const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii");
  let publicKey;
  try {
    publicKey = createPublicKey(options.publicKeyPem);
  } catch {
    throw new NaverSolutionJwtError("네이버 커머스솔루션 공개키 설정이 올바르지 않습니다.");
  }

  let validSignature = false;
  try {
    validSignature = verifySignature("RSA-SHA256", signingInput, publicKey, signature);
  } catch {
    validSignature = false;
  }
  if (!validSignature) {
    throw new NaverSolutionJwtError("네이버 연결 토큰 서명 검증에 실패했습니다.");
  }

  const payload = parseSegment(encodedPayload, payloadSchema, "내용");
  const configuredSolutionId = options.solutionId.trim();
  if (!configuredSolutionId || payload.solutionId !== configuredSolutionId) {
    throw new NaverSolutionJwtError("이 SellerHub용 네이버 커머스솔루션 토큰이 아닙니다.");
  }
  if (payload.roleGroupType === "ACCOUNT_SUB") {
    throw new NaverSolutionJwtError("네이버 부매니저 계정은 커머스솔루션을 연결할 수 없습니다. 주매니저 이상의 권한으로 다시 시도해 주세요.");
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new NaverSolutionJwtError("서버 시간 설정이 올바르지 않습니다.");
  }
  if (payload.iat > now + CLOCK_SKEW_SECONDS) {
    throw new NaverSolutionJwtError("아직 유효하지 않은 네이버 연결 토큰입니다.");
  }
  if (payload.exp <= now - CLOCK_SKEW_SECONDS) {
    throw new NaverSolutionJwtError("만료된 네이버 연결 토큰입니다.");
  }
  if (payload.exp <= payload.iat) {
    throw new NaverSolutionJwtError("네이버 연결 토큰의 유효시간이 올바르지 않습니다.");
  }

  return {
    accountUid: payload.accountUid,
    issuedAt: payload.iat,
    expiresAt: payload.exp
  };
}

function parseSegment<T>(encoded: string, schema: z.ZodType<T>, label: string): T {
  const decoded = decodeBase64Url(encoded, label);
  try {
    return schema.parse(JSON.parse(decoded.toString("utf8")));
  } catch {
    throw new NaverSolutionJwtError(`네이버 연결 토큰 ${label} 형식이 올바르지 않습니다.`);
  }
}

function decodeBase64Url(encoded: string, label: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new NaverSolutionJwtError(`네이버 연결 토큰 ${label} 인코딩이 올바르지 않습니다.`);
  }
  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.length === 0) throw new Error("empty");
    return decoded;
  } catch {
    throw new NaverSolutionJwtError(`네이버 연결 토큰 ${label} 인코딩이 올바르지 않습니다.`);
  }
}
