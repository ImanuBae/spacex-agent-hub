import { z } from "zod";

const Name = z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/);
// Opaque backend references, never dereferenced as URLs or used as credentials.
const Ref = z.string().regex(/^[a-zA-Z0-9:_./-]{1,200}$/);
export const AutomationInput = z.object({
  entity: z.object({ type: Name, id: Ref, version: z.number().int().nonnegative().optional() }).strict(),
  contextRef: Ref, inputRef: Ref,
}).strict();
export const WorkflowBindings = z.array(z.object({
  eventType: Name, workflowId: Name, workflowVersion: z.number().int().positive(),
  inputSchemaVersion: z.literal(1),
}).strict()).superRefine((bindings, ctx) => {
  const ids = bindings.map(b => `${b.eventType}:${b.workflowId}`);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "One active version per event/workflow" });
});
export type WorkflowBinding = z.infer<typeof WorkflowBindings>[number];
export const AutomationClaim = z.object({ workflowId: Name, workflowVersion: z.number().int().positive() }).strict();
export const AutomationOperation = z.object({
  name: Name, operationId: Ref.optional(), resultRef: Ref.optional(),
}).strict();
const Fence = z.object({
  leaseToken: z.uuid(), attempt: z.number().int().positive(),
  expectedVersion: z.number().int().positive(), step: Name,
});
export const AutomationCheckpoint = Fence.extend({ operation: AutomationOperation.optional() }).strict();
export const AutomationWait = z.object({ type: Name, entityId: Ref }).strict();
export const AutomationResult = Fence.extend({
  outcome: z.enum(["DONE", "WAITING", "RETRY", "DEAD"]),
  resultRef: Ref.optional(), errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(),
  waitFor: AutomationWait.optional(), deadlineAt: z.iso.datetime().optional(),
  retryAfterSeconds: z.number().int().min(0).max(86400).optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.outcome === "WAITING") !== !!(value.waitFor && value.deadlineAt) ||
      (value.outcome !== "WAITING" && (value.waitFor || value.deadlineAt)))
    ctx.addIssue({ code: "custom", message: "WAITING requires event condition and deadline only" });
  if (["RETRY", "DEAD"].includes(value.outcome) && !value.errorCode)
    ctx.addIssue({ code: "custom", message: "Failure requires an error code" });
  if (value.outcome === "RETRY" && !["NETWORK_ERROR", "TIMEOUT", "UPSTREAM_UNAVAILABLE", "RATE_LIMITED"].includes(value.errorCode ?? ""))
    ctx.addIssue({ code: "custom", message: "Only technical failures may retry" });
  if (value.retryAfterSeconds !== undefined && value.outcome !== "RETRY")
    ctx.addIssue({ code: "custom", message: "Retry-After only applies to RETRY" });
});
export const AutomationReplay = z.object({
  expectedVersion: z.number().int().positive(), reason: z.string().trim().min(10).max(500),
}).strict();
export const AutomationJob = z.object({
  jobId: z.uuid(), eventId: z.uuid(), correlationId: z.string(), causationId: z.uuid().optional(),
  workflowId: Name, workflowVersion: z.number().int().positive(), inputSchemaVersion: z.literal(1),
  ...AutomationInput.shape,
  status: z.enum(["PENDING", "RUNNING", "WAITING", "RETRY", "DONE", "DEAD"]),
  version: z.number().int().positive(), step: Name, attempt: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(), replayCount: z.number().int().nonnegative(),
  leaseToken: z.uuid().optional(), leaseExpiresAt: z.iso.datetime().optional(),
  operationRefs: z.array(AutomationOperation.extend({ operationKey: Ref })),
  waitFor: AutomationWait.optional(), deadlineAt: z.iso.datetime().optional(),
  wakeEventId: z.uuid().optional(), wakeReason: z.enum(["EVENT", "DEADLINE"]).optional(),
  nextAttemptAt: z.iso.datetime().optional(), resultRef: Ref.optional(), errorCode: Name.optional(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});
export type AutomationJob = z.infer<typeof AutomationJob>;
