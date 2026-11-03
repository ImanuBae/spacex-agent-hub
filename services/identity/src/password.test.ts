import { expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";
it("salts passwords and rejects an incorrect password", async () => {
  const a = await hashPassword("test-password-strong");
  expect(a).not.toContain("test-password-strong");
  expect(await hashPassword("test-password-strong")).not.toBe(a);
  expect(await verifyPassword("test-password-strong", a)).toBe(true);
  expect(await verifyPassword("wrong", a)).toBe(false);
});
