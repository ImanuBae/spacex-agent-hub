import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DomainOperation, JobOperation, MachineAudience, MachineScope } from "./machine.js";
import { N8n06Trigger } from "./adjustments.js";

describe("N8N06 additive authority contracts", () => {
  it("accepts the new fenced operations without removing registration operations", () => {
    for (const operation of ["classes.change", "classes.adjust", "enrollment.adjust", "payment.refund", "notification.deliver", "enrollment.execute", "payment.execute", "classes.enroll"]) {
      expect(DomainOperation.safeParse(operation).success).toBe(true);
      expect(JobOperation.safeParse(operation).success).toBe(true);
    }
    expect(MachineAudience.parse("notification")).toBe("notification");
    expect(MachineScope.parse("notification:deliver")).toBe("notification:deliver");
    expect(DomainOperation.safeParse("notification.admin").success).toBe(false);
  });
  it("only carries backend references and rejects delivery destinations or OTP in job input", () => {
    const id = randomUUID();
    const event = { id: randomUUID(), type: "notification.requested", version: 1, occurredAt: new Date().toISOString(), correlationId: id,
      payload: { entity: { type: "notification", id, version: 1 }, inputRef: id, contextRef: randomUUID() } };
    expect(N8n06Trigger.safeParse(event).success).toBe(true);
    for (const extra of [{ email: "outside@example.test" }, { code: "123456" }, { approval: true }])
      expect(N8n06Trigger.safeParse({ ...event, payload: { ...event.payload, ...extra } }).success).toBe(false);
    expect(N8n06Trigger.safeParse({ ...event, version: 2 }).success).toBe(false);
  });
});
