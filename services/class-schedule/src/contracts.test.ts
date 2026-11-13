import { describe, it, expect } from "vitest";
import { ClassInput, HoldInput, ClassQuery } from "@spacex/contracts";
import { EnrollmentCommitInput, EnrollmentSeatInput } from "./app.js";
describe("class boundary", () => {
  it("rejects browser controlled TTL, actor, price and counters", () => {
    const id = "10000000-0000-4000-8000-000000000002";
    for (const extra of [
      { ttlSeconds: 5 },
      { actorId: id },
      { priceVnd: 0 },
      { committed: 4 },
    ])
      expect(
        HoldInput.safeParse({
          classId: id,
          packageId: id,
          learnerId: id,
          enrollmentId: id,
          ...extra,
        }).success,
      ).toBe(false);
  });
  it("rejects unsupported sorting/pagination and lifecycle fields", () => {
    expect(ClassQuery.safeParse({ sort: "capacity desc;--" }).success).toBe(
      false,
    );
    expect(ClassQuery.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(ClassInput.safeParse({ status: "OPEN" }).success).toBe(false);
  });
  it("accepts only source-derived seat inputs and a verified-match reference", () => {
    const matchRef = "10000000-0000-4000-8000-000000000002";
    expect(EnrollmentCommitInput.parse({ matchRef })).toEqual({ matchRef });
    expect(EnrollmentSeatInput.parse({})).toEqual({});
    for (const input of [{ actorId: matchRef }, { learnerId: matchRef }, { ttlSeconds: 86400 }, { amount: 1 }]) {
      expect(EnrollmentSeatInput.safeParse(input).success).toBe(false);
      expect(EnrollmentCommitInput.safeParse({ matchRef, ...input }).success).toBe(false);
    }
    expect(EnrollmentCommitInput.safeParse({ paid: true }).success).toBe(false);
    expect(EnrollmentCommitInput.safeParse({ matchRef: "paid" }).success).toBe(false);
  });
});
