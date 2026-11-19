import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { apiError, checkOrigin, gatewayFetch, saveTokens } from "../../../../lib/server-session";

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  if (!checkOrigin(request)) return apiError(403, "FORBIDDEN", "Invalid origin");
  const { action } = await context.params;
  if (!["request", "verify"].includes(action)) return apiError(404, "NOT_FOUND", "Not found");
  let input: Record<string, unknown>;
  try { input = await request.json(); if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(); }
  catch { return apiError(400, "INVALID_JSON", "Dữ liệu không hợp lệ."); }
  try {
    const jar = await cookies();
    const challengeSessionId = action === "request" ? randomUUID() : jar.get("hub_otp_session")?.value;
    if (!challengeSessionId) return apiError(401, "OTP_SESSION_REQUIRED", "Yêu cầu mã mới trên trình duyệt này.");
    const payload = action === "request"
      ? { email: input.email, purpose: "STUDENT_LOGIN", challengeSessionId }
      : { challengeId: jar.get("hub_otp_challenge")?.value, challengeSessionId, purpose: "STUDENT_LOGIN", code: input.code };
    const response = await gatewayFetch(`/api/v1/auth/otp/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok) return NextResponse.json(body, { status: response.status, headers: { "cache-control": "no-store" } });
    if (action === "verify") {
      await saveTokens(body.data);
      for (const name of ["hub_otp_session", "hub_otp_challenge"]) jar.set(name, "", { path: "/api/student-session", maxAge: 0, httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
      return NextResponse.json({ data: body.data.user }, { headers: { "cache-control": "no-store" } });
    }
    const options = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/api/student-session", maxAge: 300 };
    jar.set("hub_otp_session", challengeSessionId, options);
    jar.set("hub_otp_challenge", body.data.challengeId, options);
    return NextResponse.json({ data: { expiresAt: body.data.expiresAt } }, { headers: { "cache-control": "no-store" } });
  } catch { return apiError(503, "IDENTITY_UNAVAILABLE", "Chưa xác minh được đăng nhập. Vui lòng thử lại."); }
}
