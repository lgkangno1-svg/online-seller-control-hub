export type AuthOperation = "login" | "signup" | "signup_admin";

const SAFE_MESSAGES: Record<AuthOperation, ReadonlySet<string>> = {
  login: new Set([
    "가입 승인 대기 중입니다. 운영자 승인 후 로그인할 수 있습니다.",
    "가입 신청이 승인되지 않았습니다. 운영자에게 문의해 주세요.",
    "아이디/이메일 또는 비밀번호가 올바르지 않습니다."
  ]),
  signup: new Set([
    "현재 신규 가입 신청을 받지 않고 있습니다.",
    "이미 가입 또는 가입 신청된 이메일입니다.",
    "이미 사용 중인 아이디입니다.",
    "비밀번호는 10~128자로 설정해 주세요.",
    "비밀번호에는 영문과 숫자를 모두 포함해 주세요."
  ]),
  signup_admin: new Set([
    "가입 신청을 찾을 수 없습니다.",
    "이미 처리된 가입 신청입니다."
  ])
};

const FALLBACK_MESSAGES: Record<AuthOperation, string> = {
  login: "아이디/이메일 또는 비밀번호가 올바르지 않습니다.",
  signup: "가입 신청을 처리할 수 없습니다. 입력 정보를 확인해 주세요.",
  signup_admin: "가입 신청 상태를 변경할 수 없습니다."
};

/**
 * Authentication endpoints are public or security-sensitive surfaces. Only
 * explicitly reviewed domain messages may cross that boundary; filesystem,
 * parser and persistence exceptions are replaced with stable generic text.
 */
export function safeAuthError(operation: AuthOperation, error: unknown): Error {
  const candidate = error instanceof Error ? error.message : "";
  const message = SAFE_MESSAGES[operation].has(candidate)
    ? candidate
    : FALLBACK_MESSAGES[operation];
  return new Error(message);
}
