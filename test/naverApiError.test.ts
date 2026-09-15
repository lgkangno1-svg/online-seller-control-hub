import { describe, expect, it } from "vitest";
import { naverApiErrorMessage, naverTraceId } from "../src/markets/naverApiError.js";

describe("Naver Commerce API diagnostics", () => {
  it("prefers the official gateway trace header", () => {
    const response = new Response(JSON.stringify({ traceId: "body-trace" }), {
      status: 400,
      headers: { "GNCP-GW-Trace-ID": "header-trace" }
    });
    expect(naverTraceId(response, { traceId: "body-trace" })).toBe("header-trace");
  });

  it("falls back to the gateway error body traceId", () => {
    const response = new Response(null, { status: 500 });
    expect(naverTraceId(response, { traceId: "body-trace" })).toBe("body-trace");
  });

  it("includes trace ID in operator-facing errors without exposing credentials", () => {
    const response = new Response(null, {
      status: 400,
      headers: { "GNCP-GW-Trace-ID": "trace-123" }
    });
    expect(naverApiErrorMessage("네이버 상품 수정", response, { message: "잘못된 요청" }))
      .toBe("네이버 상품 수정 HTTP 400: 잘못된 요청 (Trace ID: trace-123)");
  });
});
