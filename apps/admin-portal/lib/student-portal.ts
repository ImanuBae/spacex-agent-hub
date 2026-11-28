import type { PublicOffer } from "@spacex/contracts";
import { dateTime } from "./services/classes";

export type Enrollment = {
  id: string; status: string; createdAt?: string; holdExpiresAt?: string | null;
  currentEntitlement: {
    state: string; classId: string; packageId?: string; amount: number;
    remainingSessions: number; expiresAt?: string | null;
  };
  snapshot: { amountDue: number; packageId?: string; courseId?: string; packageName?: string; className?: string };
};

export type Schedule = {
  classId: string; enrollmentId?: string; practiceCourseCode?: string; name: string; mode: string; roomName?: string | null;
  onlineUrl?: string | null; sessions: { startsAt: string; endsAt: string }[];
};

export type StudentNotice = {
  id: string; subject: string; body: string; createdAt: string; readAt: string | null;
  template: string; enrollmentId: string | null;
};

export type LibraryCourse = Pick<PublicOffer, "packageId" | "courseCode" | "courseName" | "goal" | "description"> & {
  practiceSessions?: Schedule["sessions"];
};
export type StudentAccount = { id: string; name: string; email: string; role: string; active: boolean };

export const registrationCode = (id: string) => `ĐK ${id.slice(0, 8).toUpperCase()}`;
export const offerFor = (row: Enrollment, offers: PublicOffer[]) =>
  offers.find(offer => offer.packageId === (row.currentEntitlement.packageId ?? row.snapshot.packageId));

export const orderStatuses: Record<string, string> = {
  PENDING_HOLD: "Đang giữ chỗ", HELD: "Chờ thanh toán", CONFIRMING: "Đang xác nhận chỗ",
  CONFIRMED: "Đã xác nhận đăng ký", PAYMENT_REVIEW: "Cần đối soát", REFUND_PENDING: "Chờ hoàn tiền",
  EXPIRED: "Hết hạn", CANCELLED: "Đã hủy", NEEDS_CONFIRMATION: "Cần xác nhận lại",
};

export function courseStatus(row: Enrollment, schedule?: Schedule, now = Date.now()) {
  const state = row.currentEntitlement.state;
  if (state === "ACTIVE") {
    if (row.currentEntitlement.expiresAt && Date.parse(row.currentEntitlement.expiresAt) <= now) return "Hết hạn";
    if (schedule?.sessions.length && schedule.sessions.every(session => Date.parse(session.startsAt) > now)) return "Chờ khai giảng";
    return "Đang học";
  }
  return ({ SUSPENDED: "Đang bảo lưu", COMPLETED: "Đã hoàn thành" } as Record<string, string>)[state] ?? orderStatuses[row.status] ?? state;
}

export function dayKey(date: string | Date) {
  return new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(date));
}
export function classEvents(schedules: Schedule[]) {
  const classes = new Map(schedules.map(row => [row.classId, row]));
  return [...classes.values()].flatMap(schedule => schedule.sessions.map(session => ({ ...session, schedule })))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
export type ClassEvent = ReturnType<typeof classEvents>[number];

export function practiceSchedules(courses: LibraryCourse[]): Schedule[] {
  return courses.flatMap(course => course.practiceSessions?.length ? [{
    classId: "practice-" + course.courseCode,
    practiceCourseCode: course.courseCode,
    name: course.courseName + " · Lịch trải nghiệm",
    mode: "practice",
    sessions: course.practiceSessions,
  }] : []);
}

export function scheduleFile(events: ClassEvent[]) {
  const timestamp = (value: string) => new Date(value).toISOString().replace(/[-:]|\.\d{3}/g, "");
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r\n|[\n\r]/g, "\\n").replace(/([,;])/g, "\\$1");
  const stamp = timestamp(new Date().toISOString());
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SpaceX Agent Hub//Student Calendar//VI",
    ...events.flatMap(({ startsAt, endsAt, schedule }) => [
      "BEGIN:VEVENT", `UID:${schedule.classId || schedule.enrollmentId}-${timestamp(startsAt)}@spacex-agent-hub`,
      `DTSTAMP:${stamp}`, `DTSTART:${timestamp(startsAt)}`, `DTEND:${timestamp(endsAt)}`,
      `SUMMARY:${escape(schedule.name)}`, `DESCRIPTION:${escape(dateTime(startsAt) + " (Asia/Ho_Chi_Minh)")}`,
      ...(schedule.roomName ? [`LOCATION:${escape(schedule.roomName)}`] : []), "END:VEVENT",
    ]), "END:VCALENDAR", "",
  ].map(foldCalendarLine).join("\r\n");
}

function foldCalendarLine(line: string) {
  const encoder = new TextEncoder();
  let bytes = 0, result = "";
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) { result += "\r\n "; bytes = 1; }
    result += character;
    bytes += size;
  }
  return result;
}
