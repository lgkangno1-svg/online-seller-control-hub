import { randomUUID } from "node:crypto";

export type SafeInternalError = {
  body: {
    error: "internal_error";
    message: string;
    incidentId: string;
  };
  log: {
    incidentId: string;
    errorType: string;
  };
};

/**
 * Converts an unexpected exception into a public response and a deliberately
 * minimal log record. Raw error messages/stacks can contain provider payloads,
 * filesystem paths, credentials, or PII, so the generic HTTP boundary must not
 * echo them to clients or production logs.
 */
export function safeInternalError(error: unknown, incidentId: string = randomUUID()): SafeInternalError {
  const errorType = error instanceof Error
    ? error.name.trim() || "Error"
    : error === null
      ? "null"
      : typeof error;

  return {
    body: {
      error: "internal_error",
      message: "요청 처리 중 내부 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      incidentId
    },
    log: { incidentId, errorType }
  };
}
