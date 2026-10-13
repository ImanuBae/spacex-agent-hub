import { z } from "zod";
export declare const EventEnvelope: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodString;
    version: z.ZodDefault<z.ZodNumber>;
    occurredAt: z.ZodString;
    correlationId: z.ZodString;
    payload: z.ZodUnknown;
}, z.core.$strip>;
export type EventEnvelope = z.infer<typeof EventEnvelope>;
