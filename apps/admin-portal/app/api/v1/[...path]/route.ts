import { NextResponse } from "next/server";
import { apiError, authenticatedFetch, checkOrigin } from "../../../../lib/server-session";

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (!["GET", "HEAD"].includes(request.method) && !checkOrigin(request)) return apiError(403, "FORBIDDEN", "Invalid origin");
  const { path } = await context.params;
  if (!["courses", "packages", "accounts", "branches", "departments", "employees", "teachers", "access-sync", "classes", "rooms", "holds", "hold-fixtures", "teacher-time", "operations", "crm", "assignees"].includes(path[0]) || path.some(p => !/^[a-zA-Z0-9-]+$/.test(p))) return apiError(404, "NOT_FOUND", "Not found");
  const headers: Record<string, string> = { "content-type": "application/json" };
  for (const name of ["idempotency-key", "x-correlation-id", "traceparent"]) { const value = request.headers.get(name); if (value) headers[name] = value; }
  try {
    const response = await authenticatedFetch(`/api/v1/${path.join("/")}${new URL(request.url).search}`, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.text() });
    const responseHeaders: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store" };
    const correlation = response.headers.get("x-correlation-id"); if (correlation) responseHeaders["x-correlation-id"] = correlation;
    const trace = response.headers.get("traceparent"); if (trace) responseHeaders.traceparent = trace;
    return new NextResponse(response.status === 204 ? null : await response.text(), { status: response.status, headers: responseHeaders });
  } catch { return apiError(503, "UPSTREAM_UNAVAILABLE", "Dịch vụ hiện không khả dụng."); }
}
export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE };
