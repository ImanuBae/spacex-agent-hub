import { z } from "zod";

export const ErasureScope = z.object({
  requestId: z.uuid(), personId: z.uuid(), branchId: z.uuid(),
  conversationIds: z.array(z.uuid()).max(1000), noEnrollment: z.boolean(),
}).strict();
export type ErasureScope = z.infer<typeof ErasureScope>;
export const RestoreExclusions = z.array(ErasureScope).min(1).max(1000);

export const ErasureProof = z.object({
  status: z.enum(["DONE","NOT_APPLICABLE","BLOCKED"]),
  code: z.enum(["ANONYMIZED","NO_SCOPED_DATA","AGGREGATES_ONLY","RETENTION","UNVERIFIED_SCOPE"]),
  evidenceRef: z.uuid(),
}).strict();
export type ErasureProof = z.infer<typeof ErasureProof>;
