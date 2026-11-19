import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { receiveCourseEvent } from "./app.js";

describe("course event intake", () => {
  it("never creates a delivery intent from payment matching", async () => {
    const query = vi.fn(), id = randomUUID();
    const event = { id, correlationId: id, version: 1, occurredAt: new Date().toISOString(), type: "payment.matched", payload: {} };
    await expect(receiveCourseEvent({ query } as unknown as PoolClient, event, id)).rejects.toThrow("Unexpected course notification event");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects disagreement between class envelope and schedule version before reading members", async () => {
    const query = vi.fn(), id = randomUUID(), classId = randomUUID();
    const event = { id, correlationId: id, version: 1, occurredAt: new Date().toISOString(), type: "class.schedule_changed",
      entityId: classId, entityVersion: 3, payload: { classId, branchId: randomUUID(), sourceVersion: 2, status: "OPEN" } };
    await expect(receiveCourseEvent({ query } as unknown as PoolClient, event, id)).rejects.toThrow("Class event entity mismatch");
    expect(query).not.toHaveBeenCalled();
  });
});
