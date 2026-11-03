import { beforeEach, afterEach, expect, it, vi } from "vitest";
const jar = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => jar }));
import { authenticatedFetch, checkOrigin, saveTokens } from "./server-session";

beforeEach(() => { vi.clearAllMocks(); jar.get.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("requires exact configured origin for mutating requests", () => {
  vi.stubEnv("PORTAL_ORIGIN", "https://hub.example");
  expect(checkOrigin(new Request("https://hub.example/api/session/login", { headers: { origin: "https://other.example" } }))).toBe(false);
  expect(checkOrigin(new Request("https://hub.example/api/session/login"))).toBe(false);
  expect(checkOrigin(new Request("https://hub.example/api/session/login", { headers: { origin: "https://hub.example" } }))).toBe(true);
});
it("sets secure HttpOnly cookies in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  await saveTokens({ accessToken: "access", refreshToken: "refresh", expiresIn: 300, refreshExpiresIn: 28800, user: {} });
  expect(jar.set).toHaveBeenCalledWith("hub_access", "access", expect.objectContaining({ httpOnly: true, secure: true, sameSite: "strict", maxAge: 300 }));
});
it("does not forward anonymous requests or trust browser role claims", async () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  expect((await authenticatedFetch("/api/v1/courses")).status).toBe(401);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("preserves forbidden responses without attempting a refresh", async () => {
  jar.get.mockImplementation((name: string) => name === "hub_access" ? { value: "token" } : undefined);
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }));
  vi.stubGlobal("fetch", fetchMock);
  expect((await authenticatedFetch("/api/v1/courses")).status).toBe(403);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
