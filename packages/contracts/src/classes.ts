import { z } from "zod";
import { ListQuery } from "./catalog.js";

export const SessionInput = z
  .object({ startsAt: z.iso.datetime(), endsAt: z.iso.datetime() })
  .strict()
  .refine((s) => Date.parse(s.startsAt) < Date.parse(s.endsAt), {
    path: ["endsAt"],
    message: "End must follow start",
  });
export const ClassInput = z
  .object({
    code: z.string().trim().min(1).max(50),
    name: z.string().trim().min(1).max(200),
    courseId: z.uuid(),
    packageId: z.uuid(),
    branchId: z.uuid(),
    teacherId: z.uuid().nullable(),
    mode: z.enum(["online", "onsite"]),
    roomId: z.uuid().nullable(),
    onlineUrl: z
      .url()
      .max(1000)
      .refine((v) => v.startsWith("https://"), "Use HTTPS")
      .nullable(),
    capacity: z.number().int().min(1).max(500),
    minimumSize: z.number().int().min(0).max(500),
    registrationClosesAt: z.iso.datetime(),
    decisionAt: z.iso.datetime(),
    sessions: z.array(SessionInput).max(100),
  })
  .strict()
  .refine((v) => v.minimumSize <= v.capacity, {
    path: ["minimumSize"],
    message: "Minimum exceeds capacity",
  });
export type ClassInput = z.infer<typeof ClassInput>;
export const ClassUpdate = z
  .object({ version: z.number().int().positive(), input: ClassInput })
  .strict();
export const ClassTransition = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(["PLANNED", "OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
    reason: z.string().trim().max(1000).default(""),
  })
  .strict().refine(v => v.status !== "CANCELLED" || v.reason.length > 0, { path: ["reason"], message: "Nhập lý do hủy lớp" });
export const ClassQuery = ListQuery.extend({
  courseId: z.uuid().optional(),
  packageId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  mode: z.enum(["online", "onsite"]).optional(),
  status: z.enum(["DRAFT", "PLANNED", "OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  sellable: z.enum(["true", "false"]).default("false"),
  sort: z.enum(["code", "registrationClosesAt"]).default("code"),
})
  .strict()
  .refine((q) => !q.from || !q.to || Date.parse(q.from) < Date.parse(q.to), {
    path: ["to"],
    message: "End must follow start",
  });
export const RoomInput = z
  .object({
    branchId: z.uuid(),
    name: z.string().trim().min(1).max(100),
    capacity: z.number().int().min(1).max(500),
    active: z.boolean().default(true),
  })
  .strict();
export const HoldInput = z
  .object({
    classId: z.uuid(),
    packageId: z.uuid(),
    learnerId: z.uuid(),
    enrollmentId: z.uuid(),
  })
  .strict();
export type HoldInput = z.infer<typeof HoldInput>;
// Enrollment owns the future workflow. Commit is a separate internal endpoint,
// unavailable through Gateway or the Portal BFF, authenticated by a service secret.
export const HoldStatus = z.enum(["HELD", "CANCELLED", "EXPIRED", "COMMITTED"]);
export type HoldView = HoldInput & {
  id: string;
  actorId: string;
  operationKey: string;
  status: z.infer<typeof HoldStatus>;
  expiresAt: string;
  serverTime: string;
};
export type ClassView = ClassInput & {
  id: string;
  status: "DRAFT" | "PLANNED" | "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  version: number;
  committed: number;
  held: number;
  available: number;
  serverTime: string;
  missingConditions: string[];
};
export type DemoFixture = {
  id: string;
  learnerId: string;
  enrollmentId: string;
  label: string;
  branchId: string;
};

export const TeacherTimeInput = z.object({
  teacherId: z.uuid(),
  kind: z.enum(["AVAILABLE", "LEAVE"]),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  reason: z.string().trim().max(1000).default(""),
}).strict().refine(v => Date.parse(v.startsAt) < Date.parse(v.endsAt), {
  path: ["endsAt"], message: "Giờ kết thúc phải sau giờ bắt đầu",
}).refine(v => v.kind !== "LEAVE" || v.reason.length > 0, {
  path: ["reason"], message: "Nhập lý do đề nghị nghỉ",
});
export const TeacherTimeDecision = z.object({
  version: z.number().int().positive(),
  status: z.enum(["APPROVED", "REJECTED", "CANCELLED"]),
  reason: z.string().trim().min(1).max(1000),
}).strict();
export type TeacherTimeView = z.infer<typeof TeacherTimeInput> & {
  id: string; branchId: string; accountId: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  version: number; decisionReason: string;
};
