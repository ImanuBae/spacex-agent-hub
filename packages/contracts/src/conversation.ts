import { z } from "zod";

export const ChatMessageInput = z.object({ clientMessageId: z.uuid(), text: z.string().trim().min(1).max(2000) }).strict();
export const ConversationModeInput = z.object({ expectedVersion: z.number().int().positive(), mode: z.enum(["AI", "HUMAN"]) }).strict();
export const ConversationProof = z.object({ jobId: z.uuid(), leaseToken: z.uuid(), attempt: z.number().int().positive() }).strict();
export const ChatSources = z.array(z.object({ api: z.enum(["catalog.courses", "catalog.packages", "classes.list"]), readAt: z.iso.datetime() }).strict()).max(4);
export const ConversationDraft = ConversationProof.extend({ text: z.string().trim().min(1).max(4000), sources: ChatSources,
  model: z.string().min(1).max(150), errorCode: z.enum(["DATA_POLICY_BLOCKED", "MISSING_KEY", "QUOTA", "TIMEOUT", "TOOL_ERROR", "MODEL_ERROR", "DENIED", "HANDOFF"]).optional(),
}).strict();
