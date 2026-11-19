import { expect, it } from "vitest";
import { adjustmentSeatPermissions } from "./adjustments.js";

it("allows new seat commit only after the durable fence and old seat release only after entitlement apply", () => {
  expect(adjustmentSeatPermissions("PREPARED", "TRANSFER", true)).toEqual({ holdAuthorized: true, commitAuthorized: false, releaseTargetAuthorized: false, releaseSourceAuthorized: false });
  expect(adjustmentSeatPermissions("COMMITTING", "TRANSFER", true)).toEqual({ holdAuthorized: false, commitAuthorized: true, releaseTargetAuthorized: false, releaseSourceAuthorized: false });
  expect(adjustmentSeatPermissions("COMMITTING", "TRANSFER", false).commitAuthorized).toBe(false);
  expect(adjustmentSeatPermissions("TARGET_COMMITTED", "TRANSFER", true).releaseSourceAuthorized).toBe(false);
  expect(adjustmentSeatPermissions("APPLIED", "TRANSFER", false).releaseSourceAuthorized).toBe(true);
  expect(adjustmentSeatPermissions("FAILED", "TRANSFER", false)).toEqual({ holdAuthorized: false, commitAuthorized: false, releaseTargetAuthorized: true, releaseSourceAuthorized: false });
});
