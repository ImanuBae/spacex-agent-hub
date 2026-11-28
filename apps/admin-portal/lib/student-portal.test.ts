import { describe, expect, it } from "vitest";
import { classEvents, courseStatus, dayKey, scheduleFile, type Enrollment, type Schedule } from "./student-portal";

const session = { startsAt: "2026-11-28T18:00:00Z", endsAt: "2026-11-28T20:00:00Z" };
const schedule: Schedule = {
  classId: "class-1", enrollmentId: "enrollment-1", name: "Tin học, lớp tối",
  mode: "online", onlineUrl: "https://private.test/join", sessions: [session],
};
const enrollment: Enrollment = {
  id: "enrollment-1", status: "CONFIRMED", snapshot: { amountDue: 100000 },
  currentEntitlement: { state: "ACTIVE", classId: "class-1", amount: 100000, remainingSessions: 1 },
};

describe("student calendar and course status", () => {
  it("deduplicates classes and assigns evening UTC events to the Vietnam calendar day", () => {
    const events = classEvents([schedule, { ...schedule, enrollmentId: "enrollment-2" }]);
    expect(events).toHaveLength(1);
    expect(dayKey(events[0].startsAt)).toBe("2026-11-29");
    const file = scheduleFile(events);
    expect(file).toContain("DTSTART:20261128T180000Z\r\n");
    expect(file).toContain("SUMMARY:Tin học\\, lớp tối");
    expect(file).not.toContain("https://private.test");
  });

  it("interprets entitlement expiry before the upcoming-class label", () => {
    const now = Date.parse("2026-11-28T12:00:00Z");
    expect(courseStatus(enrollment, schedule, now)).toBe("Chờ khai giảng");
    expect(courseStatus(enrollment, schedule, Date.parse(session.startsAt))).toBe("Đang học");
    expect(courseStatus({ ...enrollment, currentEntitlement: { ...enrollment.currentEntitlement, expiresAt: "2026-11-28T11:00:00Z" } }, schedule, now)).toBe("Hết hạn");
  });
});
