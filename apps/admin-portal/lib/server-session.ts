import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

export function apiError(status: number, code: string, message: string) {
  const correlationId = randomUUID();
  return NextResponse.json({ error: { code, message }, correlationId }, { status, headers: { "x-correlation-id": correlationId, "cache-control": "no-store" } });
}

const gateway = () => (process.env.GATEWAY_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
interface Tokens { accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number; user: unknown; }
const rotating = new Map<string, Promise<Tokens | null>>();
export async function gatewayFetch(path: string, init: RequestInit = {}) {
  return fetch(`${gateway()}${path}`, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000) });
}
export function checkOrigin(request: Request) {
  const expected = process.env.PORTAL_ORIGIN ?? new URL(request.url).origin;
  return request.headers.get("origin") === expected;
}
export async function saveTokens(data: Tokens) {
  const jar = await cookies();
  const options = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/" };
  jar.set("hub_access", data.accessToken, { ...options, maxAge: data.expiresIn });
  jar.set("hub_refresh", data.refreshToken, { ...options, maxAge: data.refreshExpiresIn });
}
export async function clearTokens() {
  const jar = await cookies();
  jar.delete("hub_access"); jar.delete("hub_refresh");
}
export async function refreshSession() {
  const token = (await cookies()).get("hub_refresh")?.value;
  if (!token) return null;
  let pending = rotating.get(token);
  if (!pending) {
    pending = (async () => {
      const response = await gatewayFetch("/api/v1/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: token }) });
      if (response.status === 401) return null;
      if (!response.ok) throw new Error("Identity unavailable");
      return (await response.json() as { data: Tokens }).data;
    })();
    rotating.set(token, pending);
    void pending.finally(() => { const timer = setTimeout(() => rotating.delete(token), 2000); timer.unref(); }).catch(() => {});
  }
  const data = await pending;
  if (data) await saveTokens(data);
  return data?.accessToken ?? null;
}
export async function authenticatedFetch(path: string, init: RequestInit = {}) {
  const jar = await cookies();
  let token = jar.get("hub_access")?.value;
  if (!token) token = await refreshSession() ?? undefined;
  if (!token) { await clearTokens(); return apiError(401, "UNAUTHORIZED", "Vui lòng đăng nhập."); }
  const send = (value: string) => gatewayFetch(path, { ...init, headers: { ...init.headers, authorization: `Bearer ${value}` } });
  let response = await send(token);
  if (response.status === 401) {
    const renewed = await refreshSession();
    if (renewed) response = await send(renewed);
  }
  if (response.status === 401) await clearTokens();
  return response;
}
