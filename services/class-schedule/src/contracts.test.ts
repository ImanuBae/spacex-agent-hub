import { describe, it, expect } from "vitest";
import { ClassInput, HoldInput, ClassQuery } from "@spacex/contracts";
import { EnrollmentCommitInput, EnrollmentSeatInput } from "./app.js";
import { assessImpact, ChangeDecision, ChangeInput, impactDigest } from "./changes.js";
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

describe("WF08 class impact fence", () => {
  const enrollmentId = "10000000-0000-4000-8000-000000000002";
  const seatId = "10000000-0000-4000-8000-000000000003";
  const classId = "10000000-0000-4000-8000-000000000004";
  const hold = { id: "10000000-0000-4000-8000-000000000005", enrollmentId:seatId, status:"COMMITTED", expiresAt:"2026-11-16T01:00:00Z" };
  const entry = { enrollmentId, seatId, version:7, state:"ACTIVE", choiceValid:false, resolved:false };
  const base = { holds:[hold], enrollments:[entry], digest:impactDigest([hold],[entry]) };

  it("waits for a verified choice and invalidates a choice after an impact change", () => {
    expect(assessImpact(base,base,false)).toBe("WAITING");
    expect(assessImpact(base,{...base,enrollments:[{...entry,choiceValid:true}]},false)).toBe("READY");
    expect(assessImpact(base,{...base,enrollments:[{...entry,choiceValid:true,version:8}]},false)).toBe("STALE");
    expect(assessImpact(base,{...base,holds:[{...hold,status:"HELD"}]},false)).toBe("STALE");
    expect(assessImpact(base,{...base,holds:[hold,{...hold,id:classId}]},true)).toBe("STALE");
  });

  it("allows cancellation only after the exact planned enrollment and seat are resolved", () => {
    const resolved = {...entry,state:"CANCELLED",version:8,resolved:true,resolvedVersion:7};
    expect(assessImpact(base,{...base,enrollments:[resolved]},true)).toBe("WAITING");
    expect(assessImpact(base,{...base,holds:[],enrollments:[resolved]},true)).toBe("READY");
    expect(assessImpact(base,{...base,holds:[],enrollments:[{...resolved,resolvedVersion:6}]},true)).toBe("STALE");
    expect(assessImpact(base,{...base,holds:[],enrollments:[]},true)).toBe("STALE");
  });

  it("never moves a still-held registration with an immutable schedule snapshot", () => {
    const held = {...hold,status:"HELD"};
    const affected = {...entry,state:"HELD",choiceValid:true};
    const plan = {holds:[held],enrollments:[affected],digest:impactDigest([held],[affected])};
    expect(assessImpact(plan,plan,false)).toBe("WAITING");
    expect(assessImpact(plan,{...plan,holds:[hold]},false)).toBe("STALE");
  });

  it("accepts a reason and version but rejects caller-supplied authority or impact", () => {
    const requested = {classId,classVersion:1,kind:"CANCEL",reason:"Schedule cancelled in local policy"};
    expect(ChangeInput.safeParse(requested).success).toBe(true);
    expect(ChangeInput.safeParse({...requested,impact:base}).success).toBe(false);
    expect(ChangeInput.safeParse({...requested,kind:"RESCHEDULE"}).success).toBe(false);
    expect(ChangeDecision.safeParse({version:1,status:"APPROVED",reason:"Accept",accountId:seatId}).success).toBe(false);
  });
});
