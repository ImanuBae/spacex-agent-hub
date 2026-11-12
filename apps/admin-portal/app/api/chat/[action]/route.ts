import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { apiError, checkOrigin, gatewayFetch } from "../../../../lib/server-session";
async function proxy(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!(action === "history" && request.method === "GET") && !(["session", "messages", "revoke"].includes(action) && request.method === "POST")) return apiError(404, "NOT_FOUND", "Not found");
  if (request.method !== "GET" && !checkOrigin(request)) return apiError(403, "FORBIDDEN", "Invalid origin");
  const jar = await cookies(), token = jar.get("hub_guest")?.value;
  if (action !== "session" && !token) return apiError(401, "UNAUTHORIZED", "Phiên tư vấn đã hết hạn.");
  try {
    if (action === "session" && token) {
      const existing = await gatewayFetch("/api/v1/chat/history", { headers: { authorization: `Bearer ${token}` } });
      if (existing.ok) return NextResponse.json({ data: { resumed: true } }, { headers: { "cache-control": "no-store" } });
      if (existing.status !== 401) return apiError(503, "UNAVAILABLE", "Không thể nối lại phiên.");
    }
    const response = await gatewayFetch(`/api/v1/chat/${action}`, { method: request.method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: request.method === "POST" ? await request.text() : undefined });
    const body = await response.json();
    if (action === "session" && response.ok) {
      jar.set("hub_guest", body.data.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: body.data.expiresIn });
      delete body.data.token;
    }
    if (action === "revoke" && response.ok) jar.delete("hub_guest");
    return NextResponse.json(body, { status: response.status, headers: { "cache-control": "no-store" } });
  } catch { return apiError(503, "UNAVAILABLE", "Tư vấn đang tạm gián đoạn. Vui lòng thử lại."); }
}
export { proxy as GET, proxy as POST };
