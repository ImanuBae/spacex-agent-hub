import { afterEach, expect, it, vi } from "vitest";
import { getMockRole, isMockEnabled } from "./mock-session";

afterEach(() => vi.unstubAllEnvs());

it("requires an explicit development opt-in", () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCK", "false");
  expect(isMockEnabled()).toBe(false);
  expect(getMockRole()).toBe("student");
  vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCK", "true");
  expect(isMockEnabled()).toBe(true);
});

it("does not enable mock sessions in production", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCK", "true");
  expect(isMockEnabled()).toBe(false);
  expect(getMockRole()).toBe("student");
});
