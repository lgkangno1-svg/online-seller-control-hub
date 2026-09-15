export function naverTraceId(response: Response, body: unknown): string | null {
  const headerTrace = response.headers.get("GNCP-GW-Trace-ID")?.trim();
  if (headerTrace) return headerTrace;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const value = (body as Record<string, unknown>).traceId;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function naverApiErrorMessage(label: string, response: Response, body: unknown): string {
  const root = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const detail = typeof root.message === "string" && root.message.trim()
    ? root.message.trim()
    : typeof root.code === "string" && root.code.trim() ? root.code.trim() : "request failed";
  const traceId = naverTraceId(response, body);
  return `${label} HTTP ${response.status}: ${detail}${traceId ? ` (Trace ID: ${traceId})` : ""}`;
}
