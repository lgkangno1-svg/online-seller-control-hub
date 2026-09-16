import assert from "node:assert/strict";
import test from "node:test";
import { naverApiErrorMessage, naverTraceId } from "../src/markets/naverApiError.js";

test("Naver diagnostics prefer the official gateway trace header", () => {
  const response = new Response(JSON.stringify({ traceId: "body-trace" }), {
    status: 400,
    headers: { "GNCP-GW-Trace-ID": "header-trace" }
  });
  assert.equal(naverTraceId(response, { traceId: "body-trace" }), "header-trace");
});

test("Naver diagnostics fall back to the gateway error body traceId", () => {
  const response = new Response(null, { status: 500 });
  assert.equal(naverTraceId(response, { traceId: "body-trace" }), "body-trace");
});

test("Naver diagnostics include trace ID in operator-facing errors without credentials", () => {
  const response = new Response(null, {
    status: 400,
    headers: { "GNCP-GW-Trace-ID": "trace-123" }
  });
  assert.equal(
    naverApiErrorMessage("네이버 상품 수정", response, { message: "잘못된 요청" }),
    "네이버 상품 수정 HTTP 400: 잘못된 요청 (Trace ID: trace-123)"
  );
});
