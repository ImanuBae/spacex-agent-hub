import { z } from "zod";
import { AutomationInput } from "./automation.js";
import { TokenClaims } from "./auth.js";

export const MachineScope = z.enum(["automation:claim", "automation:checkpoint", "automation:result", "automation:read", "automation:authorize", "automation:incidents", "erasure:process", "catalog:read", "classes:read", "classes:cancel", "channel:context", "crm:write", "enrollment:write", "payment:write", "classes:enroll", "automation:source", "classes:change", "classes:adjust", "enrollment:adjust", "payment:refund", "notification:deliver", "reporting:source", "reporting:project"]);
export const MachineAudience = z.enum(["automation-bridge", "catalog", "class-schedule", "conversation", "crm", "enrollment", "payment", "notification", "reporting"]);
export const MachineGrant = z.object({ audience: MachineAudience, scopes: z.array(MachineScope).min(1) }).strict();
export const MachinePrincipalInput = z.object({
  id: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
  grants: z.array(MachineGrant).min(1), workflows: z.array(z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/)).min(1),
}).strict();
export const MachineTokenInput = z.object({
  clientId: MachinePrincipalInput.shape.id, clientSecret: z.string().min(32).max(200),
  audience: MachineAudience, scopes: z.array(MachineScope).min(1),
  workflows: MachinePrincipalInput.shape.workflows, ttlSeconds: z.number().int().min(1).max(300).default(300),
}).strict();
export const ReadOperation = z.enum(["catalog.read", "classes.read"]);
export const DomainOperation = z.enum(["catalog.read", "classes.read", "classes.cancel", "crm.execute", "enrollment.execute", "payment.execute", "classes.enroll", "classes.change", "classes.adjust", "enrollment.adjust", "payment.refund", "notification.deliver"]);
export const DelegationInput = AutomationInput.omit({ contextRef: true }).extend({
  eventId: z.uuid(), workflowId: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
  workflowVersion: z.number().int().positive(), branchId: z.uuid(),
  operations: z.array(DomainOperation).min(1),
}).strict();
export const JobOperation = z.enum(["catalog.read", "classes.read", "classes.cancel", "conversation.route", "conversation.send", "conversation.handoff", "crm.execute", "enrollment.execute", "payment.execute", "classes.enroll", "classes.change", "classes.adjust", "enrollment.adjust", "payment.refund", "notification.deliver"]);
export const CommandFence = z.object({ leaseToken: z.uuid(), attempt: z.number().int().positive(), operation: JobOperation }).strict();
export const CommandTokenInput = CommandFence.extend({ jobId: z.uuid() }).strict();
export const CommandBinding = CommandTokenInput.extend({
  eventId: z.uuid(), workflowId: z.string(), workflowVersion: z.number().int().positive(),
  ...AutomationInput.shape,
}).strict();
export const MachineClaims = z.object({
  sub: z.string().min(1), iat: z.number().int(), exp: z.number().int(), aud: MachineAudience,
  kind: z.enum(["machine", "command"]), credentialVersion: z.number().int().positive(),
  scope: z.string(), workflows: z.array(z.string()).min(1), binding: CommandBinding.optional(),
});
export const DelegatedPrincipal = TokenClaims.extend({
  sid: z.uuid(), delegation: z.object({ branchId: z.uuid(), jobId: z.uuid(), operation: DomainOperation, source: z.enum(["guest", "service"]).optional(), inputRef: z.string().optional(), entity: AutomationInput.shape.entity.optional(), workflowId: z.string().optional() }).strict(),
});
