import { z } from "zod";
import { ListQuery } from "./catalog.js";

export const PersonKind = z.enum(["CONTACT", "LEARNER", "PAYER"]);
export const LeadStage = z.enum(["NEW", "CONTACTED", "QUALIFIED", "LOST"]);
export const LeadSource = z.enum(["WALK_IN", "PHONE", "WEB_CHAT", "REFERRAL", "FACEBOOK", "ZALO", "OTHER"]);
export const ConsentPurpose = z.enum(["ADMISSIONS", "MARKETING", "COURSE_NOTICES"]);
const Phone = z.string().trim().max(30).default("").transform(value => {
  const compact = value.replace(/[\s().-]/g, "");
  return /^0[0-9]{8,10}$/.test(compact) ? `+84${compact.slice(1)}` : compact;
}).refine(value => !value || /^\+[1-9][0-9]{7,14}$/.test(value), "Nhập số điện thoại hợp lệ, dùng +mã nước hoặc số Việt Nam bắt đầu bằng 0");
const Email = z.union([z.email().max(254), z.literal("")]).default("").transform(value => value.toLowerCase());
export const PersonInput = z.object({
  branchId: z.uuid(), kind: PersonKind, fullName: z.string().trim().min(1).max(150),
  phone: Phone, email: Email, notes: z.string().trim().max(2000).default(""),
}).strict().refine(p => p.kind === "LEARNER" || !!p.phone || !!p.email, { path: ["phone"], message: "Người liên hệ/người trả tiền cần số điện thoại hoặc email" });
export type PersonInput = z.infer<typeof PersonInput>;
export const PersonUpdate = z.object({ version: z.number().int().positive(), input: PersonInput }).strict();
export const PersonQuery = ListQuery.extend({ branchId: z.uuid().optional(), kind: PersonKind.optional(), search: z.string().trim().max(100).optional(), includeErased: z.enum(["true", "false"]).default("false") }).strict();
export const LeadInput = z.object({
  branchId: z.uuid(), contactId: z.uuid(), learnerId: z.uuid().nullable().default(null), payerId: z.uuid().nullable().default(null),
  courseId: z.uuid().nullable().default(null), source: LeadSource, ownerId: z.uuid().nullable().default(null), notes: z.string().trim().max(2000).default(""),
}).strict();
export const LeadUpdate = z.object({ version: z.number().int().positive(), stage: LeadStage, ownerId: z.uuid().nullable(), notes: z.string().trim().max(2000) }).strict();
export const LeadQuery = ListQuery.extend({ branchId: z.uuid().optional(), stage: LeadStage.optional(), source: LeadSource.optional(), ownerId: z.uuid().optional(), unassigned: z.enum(["true", "false"]).default("false"), search: z.string().trim().max(100).optional() }).strict();
export const ConsentInput = z.object({
  purpose: ConsentPurpose, status: z.enum(["GRANTED", "REVOKED"]),
  statementVersion: z.string().trim().min(1).max(50), statementText: z.string().trim().min(1).max(5000),
  method: z.enum(["WRITTEN", "VERBAL", "WEB_FORM"]),
}).strict();
export const RelationshipInput = z.object({ fromPersonId: z.uuid(), learnerId: z.uuid(), kind: z.enum(["SELF", "PARENT", "GUARDIAN", "OTHER"]) }).strict();
export const RelationshipDecision = z.object({ version: z.number().int().positive(), status: z.enum(["VERIFIED", "REJECTED"]), evidenceRef: z.string().trim().min(1).max(100) }).strict();
export const ErasureInput = z.object({ personId: z.uuid(), reason: z.enum(["SUBJECT_REQUEST", "DUPLICATE_RECORD", "OTHER"]) }).strict();
export const ErasureDecision = z.object({ version: z.number().int().positive(), decision: z.enum(["VERIFIED", "REJECTED"]), method: z.enum(["REGISTERED_CONTACT_CALLBACK", "IN_PERSON_CHECK", "VERIFIED_REPRESENTATIVE"]), evidenceRef: z.string().trim().min(1).max(100) }).strict();
export const ErasureService = z.enum(["CRM", "CONVERSATION", "ENROLLMENT", "PAYMENT", "REPORTING", "BACKUPS"]);
export const ErasureTaskUpdate = z.object({ version: z.number().int().positive(), status: z.enum(["DONE", "NOT_APPLICABLE", "BLOCKED"]), evidenceRef: z.string().trim().min(1).max(100) }).strict();
export const VersionInput = z.object({ version: z.number().int().positive() }).strict();

export type PersonView = PersonInput & { id: string; version: number; status: "ACTIVE" | "ERASED"; createdAt: string };
export type ConsentView = z.infer<typeof ConsentInput> & { id: string; personId: string; recordedAt: string; actorId: string };
export type RelationshipView = z.infer<typeof RelationshipInput> & { id: string; version: number; status: "PENDING" | "VERIFIED" | "REJECTED"; evidenceRef: string; fromName: string; learnerName: string };
export type LeadView = z.infer<typeof LeadInput> & { id: string; version: number; stage: z.infer<typeof LeadStage>; contactName: string; contactPhone: string; createdAt: string };
export type ErasureTaskView = { service: z.infer<typeof ErasureService>; status: "PENDING" | "DONE" | "NOT_APPLICABLE" | "BLOCKED"; evidenceRef: string; version: number };
export type ErasureView = { id: string; personId: string; branchId: string; personName: string; reason: string; status: "PENDING_VERIFICATION" | "VERIFIED" | "PROCESSING" | "COMPLETED" | "REJECTED"; version: number; tasks: ErasureTaskView[]; createdAt: string };
