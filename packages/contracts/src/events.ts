import { z } from "zod";

export const EventEnvelope = z.object({
  id: z.string().uuid(),
  type: z.string(),                       // vd "enrollment.confirmed"
  version: z.number().int().default(1),
  occurredAt: z.string().datetime(),
  correlationId: z.string(),
  causationId: z.string().uuid().optional(),
  entityId: z.string().min(1).max(200).optional(),
  entityVersion: z.number().int().nonnegative().optional(),
  payload: z.unknown(),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;
