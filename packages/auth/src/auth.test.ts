import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { checkBranch, signAccessToken, verifyAccessToken, type AuthConfig } from "./index.js";
const config: AuthConfig = { secret: "test-only-secret-at-least-thirty-two-bytes", issuer: "test", audience: "test-api", identityUrl: "http://localhost" };
it("rejects tampering, wrong issuer/audience/secret and expired tokens", async () => {
  const user = { id: randomUUID(), role: "admissions" as const, branchIds: [randomUUID()] };
  const token = await signAccessToken(user, randomUUID(), config);
  const claims = await verifyAccessToken(token, config);
  expect(claims.sub).toBe(user.id);
  for (const options of [{ issuer: "other" }, { audience: "other" }, { secret: "other-secret-at-least-thirty-two-bytes" }]) {
    await expect(verifyAccessToken(token, { ...config, ...options })).rejects.toMatchObject({ status: 401 });
  }
  await expect(verifyAccessToken(token + "x", config)).rejects.toMatchObject({ status: 401 });
  await expect(verifyAccessToken(await signAccessToken(user, randomUUID(), config, -1), config)).rejects.toMatchObject({ status: 401 });
  expect(() => checkBranch(claims, randomUUID())).toThrow("Branch access denied");
  expect(() => checkBranch({ ...claims, branchIds: [] }, user.branchIds[0])).toThrow();
});
