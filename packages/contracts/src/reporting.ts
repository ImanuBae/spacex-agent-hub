import { z } from "zod";
import { EventEnvelope } from "./events.js";

export const reportTimezone = "Asia/Saigon";
const localDay = new Intl.DateTimeFormat("sv-SE", { timeZone: reportTimezone, dateStyle: "short" });
export const reportDay = (date: Date) => localDay.format(date);
export const ReportDay = z.iso.date();
export const ReportPeriod = z.object({ start: ReportDay, end: ReportDay }).strict().refine(
  ({ start, end }) => start <= end && Date.parse(end) - Date.parse(start) < 31 * 86_400_000,
  "Use an inclusive period of up to 31 days",
);
export const ReportBranch = z.union([z.uuid(), z.literal("unassigned")]);
export const ReportSourceRow = z.object({ day: ReportDay, branchId: z.uuid().nullable() });
export const ReportCount = z.string().regex(/^\d+$/);
export const ReportingRefreshEvent = EventEnvelope.extend({
  type: z.literal("reporting.refresh_requested"), version: z.literal(1), causationId: z.uuid(),
  payload: z.object({ entity: z.object({ type: z.literal("reporting-day"), id: ReportDay }).strict(),
    inputRef: ReportDay, contextRef: z.literal("reporting:source-refresh") }).strict(),
}).refine(event => event.payload.inputRef === event.payload.entity.id);
