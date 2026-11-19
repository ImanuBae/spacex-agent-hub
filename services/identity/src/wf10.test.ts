import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DelegationInput } from "@spacex/contracts";
import { allowedServiceDelegation } from "./machine.js";
import { otpHash } from "./learner.js";

describe("WF10 authorization", () => {
  it("binds delivery to the notification producer, workflow version and exact entity reference", () => {
    const id = randomUUID();
    const input = DelegationInput.parse({ eventId: randomUUID(), workflowId: "WF-10", workflowVersion: 1, branchId: randomUUID(),
      inputRef: id, operations: ["notification.deliver"], entity: { type: "notification", id, version: 1 } });
    expect(allowedServiceDelegation("notification", input)).toBe(true);
    expect(allowedServiceDelegation("enrollment", input)).toBe(false);
    expect(allowedServiceDelegation("notification", { ...input, workflowVersion: 2 })).toBe(false);
    expect(allowedServiceDelegation("notification", { ...input, inputRef: randomUUID() })).toBe(false);
    expect(allowedServiceDelegation("notification", { ...input, operations: ["notification.deliver", "payment.refund"] })).toBe(false);
  });

  it("uses a keyed verifier unique to each OTP challenge, even when the code matches", () => {
    const challenge = randomUUID(), key = randomUUID(), code = "015682";
    const digest = otpHash(key, challenge, code);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(otpHash(key, challenge, code)).toBe(digest);
    expect(otpHash(key, randomUUID(), code)).not.toBe(digest);
    expect(otpHash(randomUUID(), challenge, code)).not.toBe(digest);
    expect(otpHash(key, challenge, "015683")).not.toBe(digest);
  });
});
