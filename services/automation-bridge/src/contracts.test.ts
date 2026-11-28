import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AutomationInput, AutomationResult, WorkflowBindings, EventEnvelope, CommandFence, DelegationInput, MachineTokenInput } from "@spacex/contracts";

const fence = { leaseToken: randomUUID(), attempt: 1, expectedVersion: 2, step: "smoke" };
it("limits machine credentials and command/delegation input to the reviewed scopes", () => {
  const token = { clientId: "worker", clientSecret: "x".repeat(32), audience: "automation-bridge", scopes: ["automation:claim"], workflows: ["read-smoke"] };
  expect(MachineTokenInput.parse(token).ttlSeconds).toBe(300);
  for (const extra of [{ ttlSeconds: 301 }, { scope: "admin" }, { actorId: "director" }, { scopes: ["classes:write"] }])
    expect(MachineTokenInput.safeParse({ ...token, ...extra }).success).toBe(false);
  const command = { leaseToken: fence.leaseToken, attempt: 1, operation: "catalog.read" };
  expect(CommandFence.safeParse(command).success).toBe(true);
  expect(CommandFence.safeParse({ ...command, operation: "payment.refund" }).success).toBe(true);
  expect(CommandFence.safeParse({ ...command, operation: "reporting.project" }).success).toBe(false);
  expect(MachineTokenInput.safeParse({ ...token, audience: "reporting", scopes: ["reporting:project"], workflows: ["WF-11"] }).success).toBe(true);
  const context = { eventId: randomUUID(), workflowId: "read-smoke", workflowVersion: 1, entity: { type: "request", id: "synthetic" }, inputRef: "read:input", branchId: randomUUID(), operations: ["catalog.read"] };
  expect(DelegationInput.safeParse(context).success).toBe(true);
  for (const extra of [{ actorId: "director" }, { approvalRef: "fake" }, { operations: ["enrollment.create"] }])
    expect(DelegationInput.safeParse({ ...context, ...extra }).success).toBe(false);
});
it("requires bounded wait/retry and rejects untrusted actor or payload fields", () => {
  expect(AutomationResult.safeParse({ ...fence, outcome: "WAITING" }).success).toBe(false);
  expect(AutomationResult.safeParse({ ...fence, outcome: "RETRY" }).success).toBe(false);
  expect(AutomationResult.safeParse({ ...fence, outcome: "RETRY", errorCode: "FORBIDDEN" }).success).toBe(false);
  expect(AutomationResult.safeParse({ ...fence, outcome: "DEAD", errorCode: "PII error text" }).success).toBe(false);
  expect(AutomationResult.safeParse({ ...fence, outcome: "DONE", actorId: "director" }).success).toBe(false);
  expect(AutomationInput.safeParse({ entity: { type: "smoke", id: "synthetic" }, contextRef: "smoke:context", inputRef: "smoke:input", token: "secret" }).success).toBe(false);
});
it("pins one active mapping version and preserves legacy/new event envelopes", () => {
  const binding = { eventType: "automation.test.requested", workflowId: "bridge-smoke", workflowVersion: 1, inputSchemaVersion: 1 };
  expect(WorkflowBindings.safeParse([binding, { ...binding, workflowVersion: 2 }]).success).toBe(false);
  const old = { id: randomUUID(), type: "legacy", version: 1, correlationId: "test", occurredAt: new Date().toISOString(), payload: {} };
  expect(EventEnvelope.parse(old)).toEqual(old);
  const next = { ...old, causationId: randomUUID(), entityId: "synthetic", entityVersion: 7 };
  expect(EventEnvelope.parse(next)).toEqual(next);
  expect(EventEnvelope.parse(next).version).toBe(1);
});
