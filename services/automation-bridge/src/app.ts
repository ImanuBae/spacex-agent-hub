import { z } from "zod";
import { authenticate, allowRoles, principal, bearer, iamRequest, type AuthConfig } from "@spacex/auth";
import { AutomationClaim, AutomationCheckpoint, AutomationResult, AutomationReplay, CommandFence } from "@spacex/contracts";
import { createApp } from "@spacex/http";
import { machineAuth, machine, type MachineConfig } from "./auth.js";
import { BridgeStore, jobView } from "./store.js";
import { alertIncidents, incidentOwner, listIncidents, readIncident } from "./incidents.js";

const IncidentPage = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export function createBridgeApp(store: BridgeStore, auth: AuthConfig, machines?: MachineConfig) {
  const worker = (scope: string) => machineAuth(machines, scope, auth.identityUrl);
  return createApp("automation-bridge", app => {
    app.get("/ready", async (_req, res) => {
      await store.pool.query("SELECT 1 FROM automation_jobs LIMIT 1"); res.json({ status: "ok" });
    });
    const base = "/internal/automation/jobs";
    app.post(`${base}/claim`, worker("automation:claim"), async (req, res) => {
      const input = AutomationClaim.parse(req.body), actor = machine(res, input.workflowId);
      res.json({ data: await store.claim(input.workflowId, input.workflowVersion, actor) });
    });
    app.get(`${base}/:id`, worker("automation:read"), async (req, res) => {
      const row = await store.row(store.pool, z.uuid().parse(req.params.id)); machine(res, row.workflow_id);
      res.json({ data: jobView(row) });
    });
    app.post(`${base}/:id/checkpoint`, worker("automation:checkpoint"), async (req, res) => {
      const id = z.uuid().parse(req.params.id), input = AutomationCheckpoint.parse(req.body);
      const row = await store.row(store.pool, id), actor = machine(res, row.workflow_id);
      res.json({ data: await store.checkpoint(id, input, actor) });
    });
    app.post(`${base}/:id/result`, worker("automation:result"), async (req, res) => {
      const id = z.uuid().parse(req.params.id), input = AutomationResult.parse(req.body);
      const row = await store.row(store.pool, id), actor = machine(res, row.workflow_id);
      res.json({ data: await store.result(id, input, actor) });
    });
    app.post(`${base}/:id/authorization-check`, worker("automation:authorize"), async (req, res) => {
      const id = z.uuid().parse(req.params.id), input = CommandFence.parse(req.body);
      const row = await store.row(store.pool, id), actor = machine(res, row.workflow_id);
      res.json({ data: await store.authorization(id, input, actor) });
    });
    app.post(`${base}/:id/authorize`, worker("automation:authorize"), async (req, res) => {
      const jobId = z.uuid().parse(req.params.id), input = CommandFence.parse(req.body);
      const row = await store.row(store.pool, jobId); machine(res, row.workflow_id);
      res.json({ data: await iamRequest(auth.identityUrl, "/internal/iam/commands/token", bearer(req.get("authorization")), { jobId, ...input }) });
    });
    app.post("/internal/automation/incidents/alert", worker("automation:incidents"), async (_req, res) => {
      machine(res, "WF-12");
      res.json({ data: await alertIncidents(store.pool) });
    });
    const operator = [authenticate(auth), allowRoles(incidentOwner)];
    app.get("/api/v1/automation/incidents", ...operator, async (req, res) => {
      const { page, pageSize } = IncidentPage.parse(req.query);
      res.set("Cache-Control", "no-store").json(await listIncidents(store.pool, page, pageSize));
    });
    app.get("/api/v1/automation/incidents/:id", ...operator, async (req, res) => {
      const id = z.uuid().parse(req.params.id);
      res.set("Cache-Control", "no-store").json({ data: await readIncident(store.pool, id) });
    });
    app.post("/api/v1/automation/jobs/:id/replay", ...operator, async (req, res) => {
      const id = z.uuid().parse(req.params.id), input = AutomationReplay.parse(req.body);
      const { jobId, workflowVersion, attempt, status, version } = await store.replay(id, input, principal(res).sub);
      res.set("Cache-Control", "no-store").json({ data: { jobId, workflowVersion, attempt, status, version } });
    });
  });
}
