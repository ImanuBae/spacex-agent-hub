import { z } from "zod";

export const EventEnvelope = z.object({
  id: z.string().uuid(),
  type: z.string(),                       // vd "enrollment.confirmed"
  version: z.number().int().default(1),
  occurredAt: z.string().datetime(),
  correlationId: z.string(),
  payload: z.unknown(),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;