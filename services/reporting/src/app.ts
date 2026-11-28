import type { Pool } from "pg";
import { z } from "zod";
import { allowRoles, authenticate, bearer, checkBranch, iamRequest, principal, verifyReportingMachine, registerErasureTarget, type AuthConfig } from "@spacex/auth";
import { ReportBranch, ReportCount, ReportDay, ReportPeriod, ReportSourceRow, reportDay, reportTimezone } from "@spacex/contracts";
import { createApp, HttpError } from "@spacex/http";

type Period = z.infer<typeof ReportPeriod>;
type Config = { enrollment: string; payment: string; sourceClientId: string; sourceClientSecret: string };
type Totals = { confirmed: string; received: string; refunded: string };
const empty = { confirmed: "0", received: "0", refunded: "0" };
const enrollmentRows = z.array(ReportSourceRow.extend({ confirmed: ReportCount }));
const paymentRows = z.array(ReportSourceRow.extend({ received: ReportCount, refunded: ReportCount }));

export function createReportingApp(pool: Pool, auth: AuthConfig, config: Config) {
  async function source<T>(audience: "enrollment" | "payment", period: Period, schema: z.ZodType<T>) {
    const { accessToken } = z.object({ accessToken: z.string() }).parse(await iamRequest(auth.identityUrl, "/internal/iam/machine/token", "", {
      clientId: config.sourceClientId, clientSecret: config.sourceClientSecret, audience, scopes: ["reporting:source"], workflows: ["WF-11"], ttlSeconds: 60,
    }));
    try {
      const response = await fetch(config[audience] + "/internal/reporting/source?" + new URLSearchParams(period), {
        headers: { authorization: "Bearer " + accessToken }, signal: AbortSignal.timeout(5000), redirect: "error",
      });
      if (response.ok) return schema.parse((await response.json()).data);
    } catch { /* The existing projection stays available for retry. */ }
    throw new HttpError(503, "SOURCE_UNAVAILABLE", `Could not reconcile ${audience}`);
  }

  async function project(period: Period, eventId?: string) {
    if (period.end > reportDay(new Date())) throw new HttpError(400, "INVALID_REPORT_PERIOD", "Report period ends in the future");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout='8s'");
      // Serialize overlapping rebuilds and event refreshes before reading either source.
      await client.query("SELECT pg_advisory_xact_lock(40110002)");
      if (eventId) {
        const {rows:[prior]} = await client.query("SELECT to_char(day,'YYYY-MM-DD') AS day FROM report_event_checkpoints WHERE event_id=$1", [eventId]);
        if (prior && prior.day !== period.start) throw new HttpError(409, "REPORT_EVENT_CONFLICT", "Event has a different reporting day");
        if (prior) {
          await client.query("COMMIT");
          return { ...period, duplicate: true, resultRef: `reporting:${period.start}` };
        }
      }
      const [orders, money] = await Promise.all([source("enrollment", period, enrollmentRows), source("payment", period, paymentRows)]);
      const rows = new Map<string, Totals & { day: string; branch_key: string }>();
      for (const {day, branchId, ...totals} of [...orders, ...money]) {
        if (day < period.start || day > period.end) throw new HttpError(503, "SOURCE_UNAVAILABLE", "Source date outside requested period");
        const branch_key = branchId ?? "unassigned", key = `${day}/${branch_key}`;
        rows.set(key, { ...empty, day, branch_key, ...rows.get(key), ...totals });
      }
      const params = [period.start, period.end];
      await client.query("DELETE FROM report_daily WHERE day BETWEEN $1::date AND $2::date", params);
      await client.query(`INSERT INTO report_daily(day,branch_key,confirmed,received,refunded)
        SELECT day,branch_key,confirmed,received,refunded FROM jsonb_to_recordset($1::jsonb)
        AS t(day date,branch_key text,confirmed bigint,received bigint,refunded bigint)`, [JSON.stringify([...rows.values()])]);
      await client.query(`INSERT INTO report_day_checkpoints(day,projected_at)
        SELECT d,clock_timestamp() FROM generate_series($1::date,$2::date,interval '1 day') d
        ON CONFLICT (day) DO UPDATE SET projected_at=excluded.projected_at`, params);
      if (eventId) await client.query("INSERT INTO report_event_checkpoints(event_id,day) VALUES($1,$2)", [eventId,period.start]);
      await client.query("COMMIT");
      return { ...period, duplicate: false, resultRef: `reporting:${period.start}`, rows: rows.size };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "55P03") throw new HttpError(503, "SOURCE_UNAVAILABLE", "Report projection busy");
      throw error;
    } finally { client.release(); }
  }

  return createApp("reporting", app => {
    registerErasureTarget(app,auth,pool,async () => ({status:"NOT_APPLICABLE",code:"AGGREGATES_ONLY"}));
    app.get("/ready", async (_req, res) => { await pool.query("SELECT day FROM report_day_checkpoints LIMIT 0"); res.json({ ready: true }); });
    app.post("/internal/reporting/project", async (req, res) => {
      await verifyReportingMachine(auth, bearer(req.get("authorization")), "reporting");
      const { day, eventId } = z.object({ day: ReportDay, eventId: z.uuid() }).strict().parse(req.body);
      res.json({ data: await project({ start: day, end: day }, eventId) });
    });
    app.post("/internal/reporting/rebuild", async (req, res) => {
      await verifyReportingMachine(auth, bearer(req.get("authorization")), "reporting");
      const yesterday = reportDay(new Date(Date.now() - 86_400_000));
      const period = Object.keys(req.body).length ? ReportPeriod.parse(req.body) : { start: yesterday, end: yesterday };
      res.json({ data: await project(period) });
    });
    app.get("/api/v1/reports", authenticate(auth), allowRoles("center_director", "branch_director"), async (req, res) => {
      const { branchId, ...period } = z.object({ start: ReportDay, end: ReportDay, branchId: ReportBranch.optional() }).strict().parse(req.query);
      ReportPeriod.parse(period);
      const user = principal(res), center = user.role === "center_director";
      if (branchId) {
        if (branchId === "unassigned" && !center) throw new HttpError(403, "FORBIDDEN", "Unassigned funds are center-scoped");
        checkBranch(user, branchId);
      }
      const branches = branchId ? [branchId] : center ? null : user.branchIds;
      const { rows: [summary] } = await pool.query(`WITH totals AS (
        SELECT coalesce(sum(confirmed),0)::text AS confirmed,
          coalesce(sum(received) FILTER(WHERE branch_key<>'unassigned'),0)::text AS received,
          coalesce(sum(refunded),0)::text AS refunded,
          coalesce(sum(received) FILTER(WHERE branch_key='unassigned'),0)::text AS "unassignedReceived"
        FROM report_daily WHERE day BETWEEN $1::date AND $2::date
          AND ($3::text[] IS NULL OR branch_key=ANY($3))
      )
      SELECT totals.*, (SELECT count(*)::int FROM report_day_checkpoints WHERE day BETWEEN $1::date AND $2::date) AS "coveredDays",
        ($2::date-$1::date+1)::int AS "periodDays",
        (SELECT max(projected_at) FROM report_day_checkpoints WHERE day BETWEEN $1::date AND $2::date) AS "projectedAt"
      FROM totals`, [period.start,period.end,branches]);
      res.set("cache-control", "no-store").json({ data: { ...period, ...summary, branchId: branchId ?? null, timezone: reportTimezone, dataset: "SYNTHETIC" } });
    });
  });
}
