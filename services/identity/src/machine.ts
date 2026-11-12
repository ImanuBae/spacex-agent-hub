import { createPublicKey, randomBytes, randomUUID } from "node:crypto";
import type { Express } from "express";
import type { Pool } from "pg";
import { importPKCS8, jwtVerify, SignJWT } from "jose";
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
  : { audience: "class-schedule" as const, scope: operation === "classes.cancel" ? "classes:cancel" as const : "classes:read" as const };

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
      const result = await jwtVerify(token, createPublicKey(config.privateKey), { algorithms: ["RS256"], issuer: config.issuer, audience, requiredClaims: ["sub", "iat", "exp", "jti"], maxTokenAge: "5m" });
      claims = MachineClaims.parse(result.payload);
      if (claims.kind !== kind || claims.exp <= claims.iat || claims.exp - claims.iat > (kind === "command" ? 30 : 300)) throw invalid();
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
    const source = (await pool.query("SELECT source_id,credential_version FROM channel_delegations WHERE id=$1", [z.uuid().parse(b.contextRef)])).rows[0];
    if (source) {
      if (b.operation === "classes.cancel") throw denied();
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
    if (!readRoles.includes(row.role) || (row.role !== "center_director" && !row.branch_ids.includes(input.branchId)) ||
      input.eventId !== b.eventId || input.workflowId !== b.workflowId || input.workflowVersion !== b.workflowVersion ||
      input.inputRef !== b.inputRef || JSON.stringify(input.entity) !== JSON.stringify(b.entity) || !input.operations.some(o => o === b.operation)) throw denied();
    return { sub: row.id as string, sid: row.sid as string, role: row.role as Role, branchIds: [input.branchId],
      delegation: { branchId: input.branchId, jobId: b.jobId, operation: b.operation, ...(b.operation === "classes.cancel" ? { inputRef: b.inputRef, entity: b.entity } : {}) } };
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
    if (input.audience !== "automation-bridge" && !(input.audience === "conversation" && input.scopes.every(s => s === "channel:context") && input.workflows.every(w => w === "WF-02"))) throw denied();
    res.json({ data: { accessToken: await sign(c, input.audience, input.scopes, input.workflows, input.ttlSeconds), expiresIn: input.ttlSeconds } });
  });
  app.post("/internal/iam/machine/introspect", async (req, res) => {
    const input = z.object({ audience: MachineAudience, scope: MachineScope }).strict().parse(req.body);
    const { claims } = await verify(bearer(req.get("authorization")), input.audience, input.scope, "machine");
    res.json({ data: claims });
  });
  app.post("/internal/iam/delegations", async (req, res) => {
    configured(); const user = await live(bearer(req.get("authorization"))), input = DelegationInput.parse(req.body);
    if (!readRoles.includes(user.role)) throw denied();
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
    if (!["catalog.read", "classes.read", "classes.cancel"].includes(b.operation)) throw denied();
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
    const { claims } = await verify(bearer(req.get("authorization")), "class-schedule", "classes:cancel", "command");
    const b = CommandBinding.parse(claims.binding), user = await delegation(b);
    if (b.operation !== "classes.cancel" || input.accountId === user.sub) throw denied();
    const row = (await pool.query(`SELECT a.id FROM accounts a JOIN sessions s ON s.account_id=a.id
      WHERE a.id=$1 AND s.id=$2 AND a.active=true AND a.role='branch_director' AND $3=ANY(a.branch_ids)
      AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()`, [input.accountId, input.sessionId, user.delegation.branchId])).rows[0];
    if (!row) throw denied();
    res.json({ data: { allowed: true } });
  });
}
