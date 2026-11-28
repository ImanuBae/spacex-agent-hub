import { createPublicKey, randomBytes, randomUUID } from "node:crypto";
import type { Express } from "express";
import type { Pool } from "pg";
import { decodeJwt, importPKCS8, jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import {
  MachinePrincipalInput, MachineTokenInput, MachineClaims, MachineAudience, MachineScope,
  DelegationInput, CommandTokenInput, CommandBinding, type Role,
} from "@spacex/contracts";
import { bearer, checkBranch, type Principal } from "@spacex/auth";
import { HttpError } from "@spacex/http";
import { hashPassword, verifyPassword } from "./password.js";

export interface MachineAuthority { privateKey: string; issuer: string; bridgeUrl: string; channelUrl?: string; }
type Client = { id: string; secret_hash: string; grants: z.infer<typeof MachinePrincipalInput>["grants"]; workflows: string[]; credential_version: number; active: boolean };
const denied = () => new HttpError(403, "FORBIDDEN", "Machine grant or delegation denied");
const invalid = () => new HttpError(401, "UNAUTHORIZED", "Invalid or revoked machine authorization");
const readRoles: Role[] = ["center_director", "branch_director", "admissions", "teacher"];
const target = (operation: string) => operation === "catalog.read"
  ? { audience: "catalog" as const, scope: "catalog:read" as const }
  : operation === "crm.execute" ? { audience: "crm" as const, scope: "crm:write" as const }
  : operation === "enrollment.execute" ? { audience: "enrollment" as const, scope: "enrollment:write" as const }
  : operation === "payment.execute" ? { audience: "payment" as const, scope: "payment:write" as const }
  : operation === "enrollment.adjust" ? { audience: "enrollment" as const, scope: "enrollment:adjust" as const }
  : operation === "payment.refund" ? { audience: "payment" as const, scope: "payment:refund" as const }
  : operation === "notification.deliver" ? { audience: "notification" as const, scope: "notification:deliver" as const }
  : operation === "classes.change" ? { audience: "class-schedule" as const, scope: "classes:change" as const }
  : operation === "classes.adjust" ? { audience: "class-schedule" as const, scope: "classes:adjust" as const }
  : { audience: "class-schedule" as const, scope: operation === "classes.cancel" ? "classes:cancel" as const : operation === "classes.enroll" ? "classes:enroll" as const : "classes:read" as const };
const registrationOperations = ["enrollment.execute", "payment.execute", "classes.enroll"];
const adjustmentOperations = ["enrollment.adjust", "payment.refund", "classes.adjust"];
const newOperations = ["classes.change", ...adjustmentOperations, "notification.deliver"];
const sourceWorkflows: Record<string, string[]> = { enrollment: ["WF-05", "WF-07", "WF-09"], payment: ["WF-06", "WF-07", "WF-09"], "class-schedule": ["WF-08"], notification: ["WF-10"] };
function allowedNewHumanDelegation(input: z.infer<typeof DelegationInput>, role: Role) {
  if (!input.operations.some(operation => newOperations.includes(operation))) return true;
  if (input.workflowVersion !== 1 || input.inputRef !== input.entity.id) return false;
  if (input.workflowId === "WF-08") return input.entity.type === "class-change" && input.operations.every(o => o === "classes.change") && ["center_director", "branch_director", "teacher"].includes(role);
  if (input.workflowId === "WF-09") return input.entity.type === "adjustment" && input.operations.every(o => adjustmentOperations.includes(o)) && ["center_director", "branch_director", "admissions", "accountant"].includes(role);
  return false;
}
export function allowedServiceDelegation(audience: string, input: z.infer<typeof DelegationInput>) {
  if (!sourceWorkflows[audience]?.includes(input.workflowId) || input.workflowVersion !== 1) return false;
  const operations = input.workflowId === "WF-08" ? ["classes.change"] : input.workflowId === "WF-09" ? adjustmentOperations : input.workflowId === "WF-10" ? ["notification.deliver"] : registrationOperations;
  const entity = input.workflowId === "WF-08" ? "class-change" : input.workflowId === "WF-09" ? "adjustment" : input.workflowId === "WF-10" ? "notification" : "enrollment";
  return input.entity.type === entity && input.operations.every(o => operations.includes(o)) &&
    (!input.operations.some(o => newOperations.includes(o)) || input.inputRef === input.entity.id);
}

export function registerMachineRoutes(app: Express, pool: Pool, live: (token: string) => Promise<Principal>, authority?: MachineAuthority) {
  // Key material stays in IAM. Every consumer calls IAM and the Bridge again; no revocation cache.
  const key = authority ? importPKCS8(authority.privateKey, "RS256") : undefined;
  function configured() {
    if (!authority || !key) throw new HttpError(503, "MACHINE_AUTH_NOT_CONFIGURED", "IAM machine authority required");
    return authority;
  }
  async function client(id: string) {
    const row = (await pool.query<Client>("SELECT * FROM machine_principals WHERE id=$1 AND active=true", [id])).rows[0];
    if (!row) throw invalid();
    return row;
  }
  function grant(c: Client, audience: string, scopes: string[], workflows: string[]) {
    if (!scopes.length || !workflows.length || !workflows.every(w => c.workflows.includes(w)) ||
      !scopes.every(s => c.grants.some(g => g.audience === audience && g.scopes.includes(s as z.infer<typeof MachineScope>)))) throw denied();
    // Domain access is only issued with a verified job, never as an unrestricted machine token.
  }
  async function sign(c: Client, audience: string, scopes: string[], workflows: string[], ttl: number, binding?: z.infer<typeof CommandBinding>) {
    const config = configured();
    const issuedAt = Math.floor(Date.now() / 1000);
    return new SignJWT({ kind: binding ? "command" : "machine", credentialVersion: c.credential_version, scope: scopes.join(" "), workflows, ...(binding ? { binding } : {}) })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" }).setSubject(c.id).setJti(randomUUID())
      .setIssuer(config.issuer).setAudience(audience).setIssuedAt(issuedAt).setExpirationTime(issuedAt + ttl).sign(await key!);
  }
  async function verify(token: string, audience: string, scope: string, kind: "machine" | "command") {
    const config = configured();
    let claims: z.infer<typeof MachineClaims>;
    try {
      const result = await jwtVerify(token, createPublicKey(config.privateKey), { algorithms: ["RS256"], issuer: config.issuer, audience, requiredClaims: ["sub", "iat", "exp", "jti"], maxTokenAge: "5m", clockTolerance: 1 });
      claims = MachineClaims.parse(result.payload);
      // Issuance jitter tolerance does not extend expiry or replace live permission/lease checks.
      if (claims.kind !== kind || claims.exp <= Math.floor(Date.now() / 1000) || claims.exp <= claims.iat || claims.exp - claims.iat > (kind === "command" ? 30 : 300)) throw invalid();
    } catch { throw invalid(); }
    const c = await client(claims.sub);
    if (c.credential_version !== claims.credentialVersion) throw invalid();
    grant(c, audience, claims.scope.split(" "), claims.workflows);
    if (!claims.scope.split(" ").includes(scope)) throw denied();
    return { claims, c };
  }
  async function binding(token: string, input: z.infer<typeof CommandTokenInput>) {
    let response: Response;
    try {
      response = await fetch(`${configured().bridgeUrl}/internal/automation/jobs/${input.jobId}/authorization-check`, {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ leaseToken: input.leaseToken, attempt: input.attempt, operation: input.operation }), signal: AbortSignal.timeout(5000), redirect: "error",
      });
    } catch { throw new HttpError(503, "BRIDGE_UNAVAILABLE", "Cannot verify current job lease"); }
    if ([401, 403, 409].includes(response.status)) throw new HttpError(response.status, "JOB_AUTHORIZATION_DENIED", "Job authorization is no longer valid");
    if (!response.ok) throw new HttpError(503, "BRIDGE_UNAVAILABLE", "Cannot verify current job lease");
    return CommandBinding.parse((await response.json() as { data: unknown }).data);
  }
  async function delegation(b: z.infer<typeof CommandBinding>) {
    const service = (await pool.query("SELECT * FROM service_delegations WHERE id=$1 AND expires_at>clock_timestamp()", [z.uuid().parse(b.contextRef)])).rows[0];
    if (service) {
      const producer = await client(service.source_id), input = DelegationInput.parse(service.input);
      if (producer.credential_version !== service.credential_version || !allowedServiceDelegation(service.audience, input) ||
        input.eventId !== b.eventId || input.workflowId !== b.workflowId || input.workflowVersion !== b.workflowVersion ||
        input.inputRef !== b.inputRef || JSON.stringify(input.entity) !== JSON.stringify(b.entity) || !input.operations.includes(b.operation as z.infer<typeof DelegationInput>["operations"][number])) throw denied();
      grant(producer, service.audience, ["automation:source"], [input.workflowId]);
      return { sub: z.uuid().parse(producer.id), sid: service.id as string, role: "ai_agent" as const, branchIds: [input.branchId],
        delegation: { branchId: input.branchId, jobId: b.jobId, operation: b.operation, source: "service" as const, inputRef: b.inputRef, entity: b.entity, workflowId: b.workflowId } };
    }
    const source = (await pool.query("SELECT source_id,credential_version FROM channel_delegations WHERE id=$1", [z.uuid().parse(b.contextRef)])).rows[0];
    if (source) {
      if (!["catalog.read", "classes.read"].includes(b.operation)) throw denied();
      const sourceClient = await client(source.source_id);
      if (sourceClient.credential_version !== source.credential_version) throw denied();
      const guest = await channelContext(sourceClient, b.contextRef);
      const input = guest.input;
      if (input.eventId !== b.eventId || input.workflowId !== b.workflowId || input.workflowVersion !== b.workflowVersion ||
        input.inputRef !== b.inputRef || JSON.stringify(input.entity) !== JSON.stringify(b.entity) || !input.operations.some(o => o === b.operation)) throw denied();
      return { sub: guest.sessionId, sid: guest.sessionId, role: "ai_agent" as const, branchIds: [input.branchId],
        delegation: { branchId: input.branchId, jobId: b.jobId, operation: b.operation, source: "guest" as const } };
    }
    const row = (await pool.query(`SELECT d.input,a.id,a.role,a.branch_ids,s.id AS sid FROM automation_delegations d
      JOIN sessions s ON s.id=d.session_id AND s.account_id=d.account_id JOIN accounts a ON a.id=d.account_id
      WHERE d.id=$1 AND d.revoked_at IS NULL AND d.expires_at>clock_timestamp()
      AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND a.active=true`, [z.uuid().parse(b.contextRef)])).rows[0];
    if (!row) throw denied();
    const input = DelegationInput.parse(row.input);
    if (b.operation === "classes.cancel" && !["center_director", "branch_director"].includes(row.role)) throw denied();
    if (!allowedNewHumanDelegation(input, row.role as Role)) throw denied();
    if (["crm.execute", ...registrationOperations].includes(b.operation) && !["center_director", "branch_director", "admissions", "accountant"].includes(row.role)) throw denied();
    if ((!readRoles.includes(row.role) && row.role !== "accountant") || (row.role !== "center_director" && !row.branch_ids.includes(input.branchId)) ||
      input.eventId !== b.eventId || input.workflowId !== b.workflowId || input.workflowVersion !== b.workflowVersion ||
      input.inputRef !== b.inputRef || JSON.stringify(input.entity) !== JSON.stringify(b.entity) || !input.operations.some(o => o === b.operation)) throw denied();
    return { sub: row.id as string, sid: row.sid as string, role: row.role as Role, branchIds: [input.branchId],
      delegation: { branchId: input.branchId, jobId: b.jobId, operation: b.operation, ...(!["catalog.read", "classes.read"].includes(b.operation) ? { inputRef: b.inputRef, entity: b.entity, workflowId: b.workflowId } : {}) } };
  }
  async function channelContext(c: Client, id: string) {
    if (!authority?.channelUrl) throw new HttpError(503, "CHANNEL_NOT_CONFIGURED", "Verified Channel source required");
    grant(c, "conversation", ["channel:context"], ["WF-02"]);
    const token = await sign(c, "conversation", ["channel:context"], ["WF-02"], 30);
    let response: Response;
    try { response = await fetch(`${authority.channelUrl}/internal/conversations/contexts/${id}`, {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000), redirect: "error",
    }); } catch { throw new HttpError(503, "CHANNEL_UNAVAILABLE", "Cannot verify guest context"); }
    if ([401, 403, 404, 409].includes(response.status)) throw denied();
    if (!response.ok) throw new HttpError(503, "CHANNEL_UNAVAILABLE", "Cannot verify guest context");
    return z.object({ sessionId: z.uuid(), input: DelegationInput }).strict().parse((await response.json() as { data: unknown }).data);
  }
  async function operator(token: string) {
    const user = await live(token);
    if (user.role !== "center_director") throw denied();
    return user;
  }
  async function mutate(actor: string, action: string, query: string, args: unknown[], targetId: string | null = null) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN"); const result = await c.query(query, args);
      if (!result.rowCount) throw new HttpError(404, "NOT_FOUND", "Machine principal or context not found");
      await c.query("INSERT INTO identity_audit(id,actor_id,action,target_id) VALUES($1,$2,$3,$4)", [randomUUID(), actor, action, targetId]);
      await c.query("COMMIT"); return result;
    } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
  }
  app.post("/internal/iam/principals", async (req, res) => {
    configured(); const user = await operator(bearer(req.get("authorization"))), input = MachinePrincipalInput.parse(req.body);
    const secret = randomBytes(32).toString("base64url");
    await mutate(user.sub, `machine.created:${input.id}`, "INSERT INTO machine_principals(id,secret_hash,grants,workflows) VALUES($1,$2,$3,$4)", [input.id, await hashPassword(secret), JSON.stringify(input.grants), input.workflows]);
    res.status(201).json({ data: { id: input.id, clientSecret: secret } });
  });
  for (const action of ["revoke", "rotate"] as const) app.post(`/internal/iam/principals/:id/${action}`, async (req, res) => {
    const user = await operator(bearer(req.get("authorization"))), id = MachinePrincipalInput.shape.id.parse(req.params.id);
    z.object({}).strict().parse(req.body);
    const secret = randomBytes(32).toString("base64url");
    await mutate(user.sub, `machine.${action}:${id}`, action === "revoke"
      ? "UPDATE machine_principals SET active=false,credential_version=credential_version+1 WHERE id=$1"
      : "UPDATE machine_principals SET secret_hash=$2,credential_version=credential_version+1 WHERE id=$1 AND active=true",
    action === "revoke" ? [id] : [id, await hashPassword(secret)]);
    res.json({ data: { id, ...(action === "rotate" ? { clientSecret: secret } : { active: false }) } });
  });
  app.post("/internal/iam/machine/token", async (req, res) => {
    configured(); const input = MachineTokenInput.parse(req.body), c = await client(input.clientId);
    if (!await verifyPassword(input.clientSecret, c.secret_hash)) throw invalid();
    grant(c, input.audience, input.scopes, input.workflows);
    if (input.scopes.includes("automation:incidents") && (input.audience !== "automation-bridge" ||
      input.scopes.length !== 1 || input.workflows.some(w => w !== "WF-12"))) throw denied();
    const erasure = input.audience === "crm" && input.scopes.length === 1 && input.scopes[0] === "erasure:process" &&
      input.workflows.every(w => w === "WF-12");
    if (input.scopes.includes("erasure:process") && !erasure) throw denied();
    const source = input.scopes.every(s => s === "automation:source") && input.workflows.every(w => sourceWorkflows[input.audience]?.includes(w));
    const reporting = input.workflows.every(w => w === "WF-11") && (
      input.audience === "reporting" && input.scopes.every(s => s === "reporting:project") ||
      ["enrollment", "payment"].includes(input.audience) && input.scopes.every(s => s === "reporting:source")
    );
    if (input.audience !== "automation-bridge" && !source && !reporting && !erasure && !(input.audience === "conversation" && input.scopes.every(s => s === "channel:context") && input.workflows.every(w => w === "WF-02"))) throw denied();
    res.json({ data: { accessToken: await sign(c, input.audience, input.scopes, input.workflows, input.ttlSeconds), expiresIn: input.ttlSeconds } });
  });
  app.post("/internal/iam/machine/introspect", async (req, res) => {
    const input = z.object({ audience: MachineAudience, scope: MachineScope }).strict().parse(req.body);
    const { claims } = await verify(bearer(req.get("authorization")), input.audience, input.scope, "machine");
    res.json({ data: claims });
  });
  app.post("/internal/iam/delegations", async (req, res) => {
    configured(); const user = await live(bearer(req.get("authorization"))), input = DelegationInput.parse(req.body);
    if (!readRoles.includes(user.role) && user.role !== "accountant") throw denied();
    if (!allowedNewHumanDelegation(input, user.role)) throw denied();
    if (input.operations.some(o => !["catalog.read", "classes.read"].includes(o)) && !["center_director", "branch_director", "admissions", "accountant"].includes(user.role) && !(user.role === "teacher" && input.workflowId === "WF-08" && input.operations.every(o => o === "classes.change"))) throw denied();
    checkBranch(user, input.branchId);
    const id = randomUUID();
    await mutate(user.sub, "delegation.created", "INSERT INTO automation_delegations(id,account_id,session_id,input) VALUES($1,$2,$3,$4)", [id, user.sub, user.sid, input], id);
    res.status(201).json({ data: { contextRef: id } });
  });
  app.post("/internal/iam/channel-delegations", async (req, res) => {
    const { c } = await verify(bearer(req.get("authorization")), "conversation", "channel:context", "machine");
    const { contextRef } = z.object({ contextRef: z.uuid() }).strict().parse(req.body);
    await channelContext(c, contextRef);
    await pool.query("INSERT INTO channel_delegations(id,source_id,credential_version) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [contextRef, c.id, c.credential_version]);
    const row = (await pool.query("SELECT source_id,credential_version FROM channel_delegations WHERE id=$1", [contextRef])).rows[0];
    if (row.source_id !== c.id || row.credential_version !== c.credential_version) throw denied();
    res.status(201).json({ data: { contextRef } });
  });
  app.post("/internal/iam/service-delegations", async (req, res) => {
    const body = z.object({ audience: z.enum(["enrollment", "payment", "class-schedule", "notification"]), input: DelegationInput }).strict().parse(req.body);
    const { c } = await verify(bearer(req.get("authorization")), body.audience, "automation:source", "machine");
    z.uuid().parse(c.id);
    const input = body.input, workflow = input.workflowId;
    if (!allowedServiceDelegation(body.audience, input)) throw denied();
    grant(c, body.audience, ["automation:source"], [workflow]);
    const id = randomUUID();
    const result = await pool.query(`INSERT INTO service_delegations(id,source_id,credential_version,input,audience) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT (source_id,(input->>'eventId')) DO UPDATE SET id=service_delegations.id RETURNING *,input=$4::jsonb AND audience=$5 AS identical`, [id, c.id, c.credential_version, input, body.audience]);
    const row = result.rows[0];
    if (!row.identical || row.credential_version !== c.credential_version) throw denied();
    res.json({ data: { contextRef: row.id } });
  });
  app.post("/internal/iam/delegations/:id/revoke", async (req, res) => {
    const user = await live(bearer(req.get("authorization"))), id = z.uuid().parse(req.params.id);
    z.object({}).strict().parse(req.body);
    await mutate(user.sub, "delegation.revoked", "UPDATE automation_delegations SET revoked_at=clock_timestamp() WHERE id=$1 AND (account_id=$2 OR $3)", [id, user.sub, user.role === "center_director"], id);
    res.json({ data: { id, revoked: true } });
  });
  app.post("/internal/iam/commands/token", async (req, res) => {
    const token = bearer(req.get("authorization")), input = CommandTokenInput.parse(req.body);
    const { c, claims } = await verify(token, "automation-bridge", "automation:authorize", "machine");
    const b = await binding(token, input), t = target(b.operation);
    if (!["catalog.read", "classes.read", "classes.cancel", "crm.execute", ...registrationOperations, ...newOperations].includes(b.operation)) throw denied();
    if (!claims.workflows.includes(b.workflowId)) throw denied();
    grant(c, t.audience, [t.scope], [b.workflowId]); await delegation(b);
    res.json({ data: { accessToken: await sign(c, t.audience, [t.scope], [b.workflowId], 30, b), expiresIn: 30, audience: t.audience, scope: t.scope } });
  });
  app.post("/internal/iam/commands/introspect", async (req, res) => {
    const input = z.object({ audience: MachineAudience, scope: MachineScope }).strict().parse(req.body);
    const { c, claims } = await verify(bearer(req.get("authorization")), input.audience, input.scope, "command");
    const b = CommandBinding.parse(claims.binding), t = target(b.operation);
    if (input.audience !== t.audience || input.scope !== t.scope) throw denied();
    grant(c, "automation-bridge", ["automation:authorize"], [b.workflowId]);
    const probe = await sign(c, "automation-bridge", ["automation:authorize"], [b.workflowId], 30);
    const current = await binding(probe, b);
    if (JSON.stringify(current) !== JSON.stringify(b)) throw denied();
    res.json({ data: { ...await delegation(b), exp: claims.exp } });
  });
  app.post("/internal/iam/commands/approval-session", async (req, res) => {
    const input = z.object({ accountId: z.uuid(), sessionId: z.uuid() }).strict().parse(req.body);
    const token = bearer(req.get("authorization"));
    let unverified: ReturnType<typeof decodeJwt>;
    try { unverified = decodeJwt(token); } catch { throw invalid(); }
    const operation = CommandBinding.safeParse(unverified.binding);
    if (operation.success && newOperations.includes(operation.data.operation)) {
      if (operation.data.operation === "notification.deliver") throw denied();
      const user = await currentCommand(token);
      if (input.accountId === user.sub) throw denied();
      await storedSession(input.accountId, input.sessionId, user.delegation.branchId, "director");
      res.json({ data: { allowed: true } }); return;
    }
    let audience: string;
    try { audience = z.enum(["class-schedule", "crm", "payment"]).parse(unverified.aud); } catch { throw invalid(); }
    const { claims } = await verify(token, audience, audience === "crm" ? "crm:write" : audience === "payment" ? "payment:write" : "classes:cancel", "command");
    const b = CommandBinding.parse(claims.binding), user = await delegation(b);
    if (!["classes.cancel", "crm.execute", "payment.execute"].includes(b.operation) || input.accountId === user.sub) throw denied();
    const row = (await pool.query(`SELECT a.id FROM accounts a JOIN sessions s ON s.account_id=a.id
      WHERE a.id=$1 AND s.id=$2 AND a.active=true AND a.role='branch_director' AND $3=ANY(a.branch_ids)
      AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()`, [input.accountId, input.sessionId, user.delegation.branchId])).rows[0];
    if (!row) throw denied();
    res.json({ data: { allowed: true } });
  });
  async function currentCommand(token: string) {
    let operation: z.infer<typeof CommandBinding>;
    try { operation = CommandBinding.parse(decodeJwt(token).binding); } catch { throw invalid(); }
    if (!newOperations.includes(operation.operation)) throw denied();
    const t = target(operation.operation), { c, claims } = await verify(token, t.audience, t.scope, "command");
    const b = CommandBinding.parse(claims.binding);
    grant(c, "automation-bridge", ["automation:authorize"], [b.workflowId]);
    const probe = await sign(c, "automation-bridge", ["automation:authorize"], [b.workflowId], 30);
    if (JSON.stringify(await binding(probe, b)) !== JSON.stringify(b)) throw denied();
    return delegation(b);
  }
  async function storedSession(accountId: string, sessionId: string, branchId: string, role: "student" | "accountant" | "director", learnerId?: string) {
    const roles = role === "director" ? ["center_director", "branch_director"] : [role];
    const row = (await pool.query(`SELECT a.id,l.learner_id FROM accounts a JOIN sessions s ON s.account_id=a.id
      LEFT JOIN learner_identities l ON l.account_id=a.id AND l.branch_id=$3 AND ($5::uuid IS NULL OR l.learner_id=$5)
      WHERE a.id=$1 AND s.id=$2 AND a.active=true AND a.role=ANY($4::text[])
      AND (a.role='center_director' OR $3=ANY(a.branch_ids))
      AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() ORDER BY l.created_at,l.learner_id LIMIT 1`, [accountId, sessionId, branchId, roles, learnerId ?? null])).rows[0];
    if (!row || (role === "student" && !row.learner_id)) throw denied();
    return row;
  }
  app.post("/internal/iam/commands/stored-session", async (req, res) => {
    const input = z.object({ accountId: z.uuid(), sessionId: z.uuid(), branchId: z.uuid(), role: z.enum(["student", "accountant", "director"]), learnerId: z.uuid().optional() }).strict().parse(req.body);
    const user = await currentCommand(bearer(req.get("authorization")));
    const { workflowId } = user.delegation;
    if (input.branchId !== user.delegation.branchId || !(workflowId === "WF-09" || workflowId === "WF-08" && input.role === "student")) throw denied();
    const row = await storedSession(input.accountId, input.sessionId, input.branchId, input.role, input.learnerId);
    res.json({ data: { allowed: true, ...(row.learner_id ? { learnerId: row.learner_id } : {}) } });
  });
  app.post("/internal/iam/financial-proposal-session", async (req, res) => {
    const user = await live(bearer(req.get("authorization"))), input = z.object({accountId:z.uuid(),sessionId:z.uuid(),branchId:z.uuid().nullable()}).strict().parse(req.body);
    if (!["center_director","branch_director"].includes(user.role) || input.accountId === user.sub) throw denied();
    if(input.branchId)checkBranch(user,input.branchId);else if(user.role!=="center_director")throw denied();
    const row = (await pool.query(`SELECT a.id FROM accounts a JOIN sessions s ON s.account_id=a.id WHERE a.id=$1 AND s.id=$2
      AND a.active=true AND a.role='accountant' AND ($3::uuid IS NULL OR $3=ANY(a.branch_ids)) AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()`,[input.accountId,input.sessionId,input.branchId])).rows[0];
    if(!row)throw denied();res.json({data:{allowed:true}});
  });
}
