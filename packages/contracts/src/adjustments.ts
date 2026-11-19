import { z } from "zod";
import { AutomationInput } from "./automation.js";
import { EventEnvelope } from "./events.js";

export const AdjustmentPolicyVersion = "DEMO-N8N06-2026-11-16-v1";
export const N8n06Trigger = EventEnvelope.extend({
  type: z.enum(["class.change.approved", "adjustment.ready", "notification.requested"]),
  version: z.literal(1),
  payload: AutomationInput,
});
