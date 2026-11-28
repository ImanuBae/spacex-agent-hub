import { z } from "zod";
import {EventEnvelope} from "./events.js";
import {AutomationInput} from "./automation.js";

export const DemoTermsVersion = "DEMO-N8N05-2026-11-14-v1";
export const BankTransferTermsVersion = "BANK-TRANSFER-v1";
export const EnrollmentPreview = z.object({ contactId: z.uuid(), learnerId: z.uuid(), payerId: z.uuid(), classId: z.uuid(), packageId: z.uuid() }).strict();
export const EnrollmentStatus = z.enum(["PENDING_HOLD", "HELD", "CONFIRMING", "CONFIRMED", "PAYMENT_REVIEW", "EXPIRED", "CANCELLED", "REFUND_PENDING", "NEEDS_CONFIRMATION"]);
export const SyntheticPaymentInput = z.object({
  provider: z.literal("SYNTHETIC"), account: z.literal("DEMO-N8N05"), transactionId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  reference: z.string().max(100), amount: z.number().int().positive().max(1_000_000_000), currency: z.literal("VND"),
}).strict();
export const PaymentReviewDecision = z.object({ version: z.number().int().positive(), decision: z.enum(["EXTEND", "REFUND_PENDING"]), reason: z.string().trim().min(10).max(1000) }).strict();
export const RegistrationTrigger = EventEnvelope.extend({type:z.enum(["crm.requested","enrollment.requested","payment.matched","enrollment.deadline","enrollment.cancel_requested","payment.review_required","payment.review_decided"]),version:z.literal(1),payload:AutomationInput});
export const EnrollmentConfirmedEvent = EventEnvelope.extend({type:z.literal("enrollment.confirmed"),version:z.literal(1),causationId:z.uuid(),entityId:z.uuid(),entityVersion:z.number().int().positive(),payload:z.object({
  enrollmentId:z.uuid(),confirmationId:z.uuid(),learnerId:z.uuid(),contactId:z.uuid(),payerId:z.uuid(),classId:z.uuid(),courseId:z.uuid(),packageId:z.uuid(),holdId:z.uuid(),matchRef:z.uuid(),paymentRequestId:z.uuid(),branchId:z.uuid(),amountDue:z.number().int().positive(),currency:z.literal("VND"),snapshotVersion:z.string().regex(/^[a-f0-9]{64}$/),policyVersion:z.string(),termsVersion:z.string(),automationJobId:z.uuid(),
}).strict()});
export const PaymentReceivedEvent=EventEnvelope.extend({type:z.literal("payment.received"),version:z.literal(1),payload:z.object({ledgerId:z.uuid(),paymentId:z.uuid().nullable(),amount:z.number().int().positive(),currency:z.literal("VND"),adapter:z.enum(["SYNTHETIC","SEPAY"])}).strict()});
