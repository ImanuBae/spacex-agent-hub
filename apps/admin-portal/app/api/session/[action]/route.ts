import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { apiError, authenticatedFetch, checkOrigin, clearTokens, gatewayFetch, saveTokens } from "../../../../lib/server-session";

export async function GET(_request: Request, context: { params: Promise<{ action: string }> }) {
  if ((await context.params).action !== "me") return apiError(404, "NOT_FOUND", "Not found");
  try {
    const response = await authenticatedFetch("/api/v1/auth/me");
    return new NextResponse(await response.text(), { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-correlation-id": response.headers.get("x-correlation-id") ?? "" } });
  } catch { return apiError(503, "IDENTITY_UNAVAILABLE", "Không kết nối được dịch vụ đăng nhập."); }
}

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  if (!checkOrigin(request)) return apiError(403, "FORBIDDEN", "Invalid origin");
  const { action } = await context.params;
  try {
    if (action === "logout") {
      const refreshToken = (await cookies()).get("hub_refresh")?.value;
      if (refreshToken) {
        const response = await gatewayFetch("/api/v1/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken }) });
        if (!response.ok) throw new Error("Logout failed");
      }
      await clearTokens();
      return new NextResponse(null, { status: 204 });
    }
    if (action !== "login") return apiError(404, "NOT_FOUND", "Not found");
    let input: unknown;
    try { input = await request.json(); }
    catch { return apiError(400, "INVALID_JSON", "Dữ liệu đăng nhập không hợp lệ."); }
    const response = await gatewayFetch("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    const body = await response.json();
    if (!response.ok) return NextResponse.json(body, { status: response.status, headers: { "x-correlation-id": response.headers.get("x-correlation-id") ?? "", "cache-control": "no-store" } });
    await saveTokens(body.data);
    return NextResponse.json({ data: body.data.user }, { headers: { "cache-control": "no-store" } });
  } catch { return apiError(503, "IDENTITY_UNAVAILABLE", "Không kết nối được dịch vụ đăng nhập. Vui lòng thử lại."); }
}
