import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { authenticate, allowRoles, bearer, checkBranch, iamRequest, principal, verifyCommand, registerErasureTarget, type AuthConfig } from "@spacex/auth";
import { eraseConversation } from "./erasure.js";
import { ChatMessageInput, ChatSources, ConversationModeInput, ConversationProof, ConversationDraft, CommandBinding, DelegationInput, MachineClaims } from "@spacex/contracts";
import { createApp, HttpError } from "@spacex/http";
import { enqueueEvent } from "@spacex/messaging";
import { redact } from "./privacy.js";
import type { createLocalAdvisor } from "./local-advisor.js";

export interface ConversationConfig {
  branchId: string; bridgeUrl: string; sourceClientId: string; sourceClientSecret: string;
  modelReady?: boolean; syntheticProviderPilot?: boolean; crmUrl?: string;
  localAI?: { model: string; reply: ReturnType<typeof createLocalAdvisor>; signal: AbortSignal };
}
const denied = () => new HttpError(403, "FORBIDDEN", "Conversation access denied");
const stale = () => new HttpError(409, "STALE_CONVERSATION", "Conversation owner, mode or message changed");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function createConversationApp(pool: Pool, auth: AuthConfig, config: ConversationConfig) {
  z.uuid().parse(config.branchId);
  const localAI = config.localAI;
  // Only an isolated synthetic test deployment may export prose; regex is not a PII boundary.
  const providerAllowed = !localAI && process.env.NODE_ENV === "test" && config.syntheticProviderPilot === true;
  const aiEnabled = Boolean(localAI) || providerAllowed;
  async function tx<T>(work: (c: PoolClient) => Promise<T>) {
    const c = await pool.connect();
    try { await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); const result = await work(c); await c.query("COMMIT"); return result; }
    catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
  }
  async function session(c: Pool | PoolClient, token: string) {
    const s = (await c.query("SELECT * FROM chat_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE", [hash(token)])).rows[0];
    if (!s) throw new HttpError(401, "UNAUTHORIZED", "Guest session expired or revoked"); return s;
  }
  async function row(c: Pool | PoolClient, id: string) {
    const r = (await c.query("SELECT * FROM conversations WHERE id=$1 FOR UPDATE", [z.uuid().parse(id)])).rows[0];
    if (!r || r.erased_at) throw denied(); return r;
  }
  async function audit(c: PoolClient, id: string, actor: string, action: string, version: number) {
    await c.query("INSERT INTO conversation_audit(id,conversation_id,actor,action,version) VALUES($1,$2,$3,$4,$5)", [randomUUID(), id, actor, action, version]);
  }
  async function event(c: PoolClient, type: string, r: { id: string; version: number }, inputRef: string, contextRef: string, id = randomUUID()) {
    await enqueueEvent(c, { id, type, version: 1, occurredAt: new Date().toISOString(), correlationId: r.id,
      entityId: r.id, entityVersion: r.version, payload: { entity: { type: "conversation", id: r.id, version: r.version }, inputRef, contextRef } });
  }
  async function recoverLocalChat(c: PoolClient, id: string) {
    if (localAI) await c.query(`UPDATE conversations SET mode='AI', error_code=NULL, version=version+1,
      local_reply_pending=true, updated_at=clock_timestamp()
      WHERE id=$1 AND mode='HUMAN' AND owner_id IS NULL AND erased_at IS NULL
      AND error_code IN ('DATA_POLICY_BLOCKED','MISSING_KEY')`, [id]);
  }
  if (localAI) {
    const { model, reply, signal } = localAI;
    let working = false;
    const timer = setInterval(async () => {
      if (working || signal.aborted) return;
      working = true;
      try {
        const { rows: [turn] } = await pool.query(`SELECT v.id,v.version,v.branch_id,s.id AS session_id
          FROM conversations v JOIN chat_sessions s ON s.id=v.session_id
          WHERE v.local_reply_pending AND v.mode='AI' AND v.owner_id IS NULL AND v.erased_at IS NULL
          AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() ORDER BY v.updated_at LIMIT 1`);
        if (!turn) return;
        const { rows } = await pool.query(`SELECT text FROM chat_messages WHERE conversation_id=$1 AND sender='GUEST'
          AND conversation_version<=$2 ORDER BY created_at DESC,id DESC LIMIT 4`, [turn.id, turn.version]);
        const result = await reply(rows.reverse().map(message => redact(message.text).slice(0, 600)), turn.branch_id, signal);
        if (signal.aborted) return;
        await tx(async c => {
          const live = await c.query("SELECT id FROM chat_sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE", [turn.session_id]);
          if (!live.rowCount) return;
          const r = await row(c, turn.id);
          if (!r.local_reply_pending || r.version !== turn.version || r.mode !== "AI" || r.owner_id) return;
          if ("errorCode" in result) {
            const { rows: [next] } = await c.query(`UPDATE conversations SET local_reply_pending=false,mode='HUMAN',error_code=$2,
              version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING id,version`, [r.id, result.errorCode]);
            await audit(c, r.id, "automation", result.errorCode, next.version);
            await event(c, "conversation.handoff_requested", next, r.id, r.session_id);
          } else {
            await c.query(`INSERT INTO chat_messages(id,conversation_id,dedup_key,direction,sender,text,sources,model,delivery,conversation_version)
              VALUES($1,$2,$3,'OUT','AI',$4,$5,$6,'QUEUED',$7)`, [randomUUID(), r.id, `local:${r.version}`,
              redact(result.text), JSON.stringify(ChatSources.parse(result.sources)), model, r.version]);
            await c.query("UPDATE conversations SET local_reply_pending=false,error_code=NULL,updated_at=clock_timestamp() WHERE id=$1", [r.id]);
          }
        });
      } catch {
        console.error("conversation.local_reply_unavailable");
      } finally { working = false; }
    }, 500);
    timer.unref();
    signal.addEventListener("abort", () => clearInterval(timer), { once: true });
  }
  async function sourceToken() {
    const result = await iamRequest(auth.identityUrl, "/internal/iam/machine/token", "", {
      clientId: config.sourceClientId, clientSecret: config.sourceClientSecret, audience: "conversation", scopes: ["channel:context"], workflows: ["WF-02"], ttlSeconds: 60,
    }) as { accessToken: string };
    return result.accessToken;
  }
  async function context(id: string, c: Pool | PoolClient = pool) {
    const r = (await c.query(`SELECT x.*,v.branch_id FROM chat_contexts x JOIN conversations v ON v.id=x.conversation_id
      JOIN chat_sessions s ON s.id=x.session_id WHERE x.id=$1 AND x.expires_at>clock_timestamp()
      AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND v.mode='AI' AND v.owner_id IS NULL
      AND v.watermark=x.watermark AND v.version=(x.input->'entity'->>'version')::integer`, [z.uuid().parse(id)])).rows[0];
    if (!r) throw denied(); return { ...r, input: DelegationInput.parse(r.input) };
  }
  async function lockSession(c: PoolClient, conversationId: string) {
    // Match the guest lock order so revocation and draft/turn admission serialize without deadlock.
    const s = (await c.query(`SELECT s.id FROM chat_sessions s JOIN conversations v ON v.session_id=s.id
      WHERE v.id=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() FOR UPDATE OF s`, [conversationId])).rows[0];
    if (!s) throw denied();
  }
  async function proof(token: string, input: z.infer<typeof ConversationProof>, operation: "conversation.route" | "conversation.send" | "conversation.handoff", workflow: string) {
    const claims = MachineClaims.parse(await iamRequest(auth.identityUrl, "/internal/iam/machine/introspect", token, { audience: "automation-bridge", scope: "automation:authorize" }));
    if (!claims.workflows.includes(workflow)) throw denied();
    let response: Response;
    try { response = await fetch(`${config.bridgeUrl}/internal/automation/jobs/${input.jobId}/authorization-check`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ leaseToken: input.leaseToken, attempt: input.attempt, operation }), signal: AbortSignal.timeout(3000), redirect: "error",
    }); } catch { throw new HttpError(503, "BRIDGE_UNAVAILABLE", "Job fence unavailable"); }
    if (!response.ok) throw new HttpError([401,403,409].includes(response.status) ? response.status : 503, "JOB_DENIED", "Job fence denied");
    const b = CommandBinding.parse((await response.json() as { data: unknown }).data);
    if (b.workflowId !== workflow || b.workflowVersion !== 1 || b.entity.type !== "conversation") throw denied(); return b;
  }
  async function history(c: PoolClient, id: string, guest = false) {
    if (guest) await c.query(`UPDATE chat_messages m SET delivery=CASE WHEN m.sender='AI' AND m.conversation_version<>v.version THEN 'CANCELLED' ELSE 'DELIVERED' END
      FROM conversations v WHERE m.conversation_id=v.id AND v.id=$1 AND m.delivery='QUEUED'`, [id]);
    const messages = (await c.query(`SELECT id,direction,sender,text,sources,delivery,created_at AS "createdAt" FROM chat_messages
      WHERE conversation_id=$1 AND ($2=false OR delivery NOT IN ('QUEUED','CANCELLED')) ORDER BY created_at,id`, [id, guest])).rows;
    const r = await row(c, id);
    return { id, mode: r.mode, version: r.version, ownerId: guest ? undefined : r.owner_id, errorCode: r.error_code, aiEnabled, messages };
  }
  return createApp("conversation", app => {
    registerErasureTarget(app, auth, pool, eraseConversation);
    app.post("/api/v1/chat/session", async (req, res) => {
      z.object({ consent: z.literal(true) }).strict().parse(req.body);
      const token = randomBytes(32).toString("base64url"), sid = randomUUID(), id = randomUUID();
      await tx(async c => {
        await c.query("INSERT INTO chat_sessions(id,token_hash,branch_id) VALUES($1,$2,$3)", [sid, hash(token), config.branchId]);
        await c.query("INSERT INTO conversations(id,session_id,branch_id) VALUES($1,$2,$3)", [id, sid, config.branchId]);
      }); res.status(201).json({ data: { token, conversationId: id, expiresIn: 28800 } });
    });
    app.get("/api/v1/chat/history", async (req, res) => {
      const data = await tx(async c => { const s = await session(c, bearer(req.get("authorization")));
        const v = (await c.query("SELECT id FROM conversations WHERE session_id=$1", [s.id])).rows[0];
        await row(c, v.id); await recoverLocalChat(c, v.id); return history(c, v.id, true); }); res.json({ data });
    });
    app.post("/api/v1/chat/revoke", async (req, res) => {
      z.object({}).strict().parse(req.body);
      await tx(async c => { const s = await session(c, bearer(req.get("authorization"))); await c.query("UPDATE chat_sessions SET revoked_at=clock_timestamp() WHERE id=$1", [s.id]); });
      res.json({ data: { revoked: true } });
    });
    app.post("/api/v1/chat/messages", async (req, res) => {
      const input = ChatMessageInput.parse(req.body);
      const data = await tx(async c => {
        const s = await session(c, bearer(req.get("authorization")));
        const v = (await c.query("SELECT id FROM conversations WHERE session_id=$1", [s.id])).rows[0];
        await recoverLocalChat(c, v.id);
        const r = await row(c, v.id);
        const old = (await c.query("SELECT id,text,sender FROM chat_messages WHERE conversation_id=$1 AND dedup_key=$2", [r.id, input.clientMessageId])).rows[0];
        if (old) { if (old.text !== input.text || old.sender !== "GUEST") throw stale(); return { messageId: old.id }; }
        const count = (await c.query("SELECT count(*)::integer AS n FROM chat_messages WHERE conversation_id=$1 AND direction='IN'", [r.id])).rows[0].n;
        if (count >= 100) throw new HttpError(429, "CHAT_LIMIT", "Session message limit reached");
        const id = randomUUID();
        await c.query("INSERT INTO chat_messages(id,conversation_id,dedup_key,direction,sender,text,delivery,conversation_version) VALUES($1,$2,$3,'IN','GUEST',$4,'RECEIVED',$5)", [id, r.id, input.clientMessageId, input.text, r.version+1]);
        const handoff = r.mode === "AI" && !aiEnabled;
        const next = (await c.query(`UPDATE conversations SET version=version+1,watermark=watermark+1,updated_at=clock_timestamp(),
          mode=CASE WHEN $2 THEN 'HUMAN' ELSE mode END,error_code=CASE WHEN $2 THEN 'DATA_POLICY_BLOCKED' ELSE error_code END
          WHERE id=$1 RETURNING *`, [r.id, handoff])).rows[0];
        if (localAI && r.mode === "AI") await c.query("UPDATE conversations SET local_reply_pending=true WHERE id=$1", [r.id]);
        await event(c, "channel.message_received", next, id, s.id);
        if (handoff) {
          await audit(c, r.id, "automation", "DATA_POLICY_BLOCKED", next.version);
          await event(c, "conversation.handoff_requested", next, r.id, s.id);
        }
        return { messageId: id };
      }); res.status(201).json({ data });
    });
    app.use("/api/v1/conversations", authenticate(auth), allowRoles("center_director", "branch_director", "admissions"));
    app.get("/api/v1/conversations", async (_req, res) => {
      const u = principal(res);
      const data = (await pool.query(`SELECT id,mode,version,owner_id AS "ownerId",updated_at AS "updatedAt",error_code AS "errorCode" FROM conversations
        WHERE erased_at IS NULL AND ($1::uuid[] IS NULL OR branch_id=ANY($1)) AND (owner_id IS NULL OR owner_id=$2 OR $3) ORDER BY updated_at DESC LIMIT 100`,
      [u.role === "center_director" ? null : u.branchIds, u.sub, u.role !== "admissions"])).rows; res.json({ data });
    });
    async function staffRow(c: PoolClient, id: string, u: ReturnType<typeof principal>) {
      const r = await row(c, id); checkBranch(u, r.branch_id);
      if (u.role === "admissions" && r.owner_id && r.owner_id !== u.sub) throw denied(); return r;
    }
    app.get("/api/v1/conversations/:id", async (req, res) => {
      res.json({ data: await tx(async c => { const r = await staffRow(c, req.params.id as string, principal(res)); return history(c, r.id); }) });
    });
    app.get("/api/v1/conversations/:id/crm-context", async (req, res) => {
      res.json({ data: await tx(async c => {
        await lockSession(c, z.uuid().parse(req.params.id));
        const r = await staffRow(c, req.params.id as string, principal(res));
        return { provider: "WEB_CHAT", accountRef: r.branch_id, subjectRef: r.session_id, branchId: r.branch_id, conversationId: r.id, version: r.version };
      }) });
    });
    app.get("/internal/conversations/:id/crm-context", async (req, res) => {
      const token = bearer(req.get("authorization")), u = await verifyCommand(auth, token, "crm", "crm:write"), d = u.delegation!;
      if (!config.crmUrl || d.operation !== "crm.execute" || d.entity?.type !== "crm-request" || d.entity.id !== d.inputRef) throw denied();
      let response: Response;
      try { response = await fetch(`${config.crmUrl}/internal/crm/requests/${d.inputRef}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000), redirect: "error" }); }
      catch { throw new HttpError(503, "CRM_UNAVAILABLE", "Verified CRM source unavailable"); }
      if (!response.ok) throw denied();
      const source = (await response.json() as {data:{source?:{conversationId?:string}}}).data.source;
      if (source?.conversationId !== req.params.id) throw denied();
      res.json({ data: await tx(async c => {
        await lockSession(c, z.uuid().parse(req.params.id));
        const r = await staffRow(c, req.params.id as string, u);
        await verifyCommand(auth, token, "crm", "crm:write");
        return { provider: "WEB_CHAT", accountRef: r.branch_id, subjectRef: r.session_id, branchId: r.branch_id, conversationId: r.id, version: r.version };
      }) });
    });
    app.post("/api/v1/conversations/:id/mode", async (req, res) => {
      const input = ConversationModeInput.parse(req.body), u = principal(res);
      const data = await tx(async c => {
        const r = await staffRow(c, req.params.id as string, u); if (r.version !== input.expectedVersion) throw stale();
        if (input.mode === "AI" && u.role === "admissions" && r.owner_id !== u.sub) throw denied();
        if (input.mode === "AI" && !aiEnabled) throw new HttpError(409, "DATA_POLICY_BLOCKED", "Trợ lý AI chưa được bật trong môi trường này.");
        if (input.mode === "AI" && !r.owner_id && r.mode === "AI") throw stale();
        const next = (await c.query("UPDATE conversations SET mode=$2,owner_id=$3,version=version+1,error_code=NULL,updated_at=clock_timestamp() WHERE id=$1 RETURNING *", [r.id, input.mode, input.mode === "HUMAN" ? u.sub : null])).rows[0];
        await c.query("UPDATE chat_messages SET delivery='CANCELLED' WHERE conversation_id=$1 AND sender='AI' AND delivery='QUEUED'", [r.id]);
        await audit(c, r.id, u.sub, `mode.${input.mode}`, next.version);
        await event(c, "conversation.owner_changed", next, r.id, r.session_id);
        let last;
        if (input.mode === "AI") {
          last = (await c.query("SELECT id FROM chat_messages WHERE conversation_id=$1 AND direction='IN' ORDER BY created_at DESC,id DESC LIMIT 1", [r.id])).rows[0];
          if (last) await event(c, "channel.message_received", next, last.id, r.session_id);
        }
        if (localAI) await c.query("UPDATE conversations SET local_reply_pending=$2 WHERE id=$1", [r.id, Boolean(last)]);
        return history(c, r.id);
      }); res.json({ data });
    });
    app.post("/api/v1/conversations/:id/messages", async (req, res) => {
      const input = ChatMessageInput.extend({ expectedVersion: z.number().int().positive() }).strict().parse(req.body), u = principal(res);
      res.status(201).json({ data: await tx(async c => {
        const r = await staffRow(c, req.params.id as string, u);
        const old = (await c.query("SELECT id,text,sender FROM chat_messages WHERE conversation_id=$1 AND dedup_key=$2", [r.id, input.clientMessageId])).rows[0];
        if (old) { if (old.text !== input.text || old.sender !== "STAFF") throw stale(); return { messageId: old.id }; }
        if (r.mode !== "HUMAN" || r.owner_id !== u.sub || r.version !== input.expectedVersion) throw stale();
        const id = randomUUID(); await c.query("INSERT INTO chat_messages(id,conversation_id,dedup_key,direction,sender,text,delivery,conversation_version) VALUES($1,$2,$3,'OUT','STAFF',$4,'QUEUED',$5)", [id, r.id, input.clientMessageId, input.text, r.version]);
        return { messageId: id };
      }) });
    });
    app.get("/internal/conversations/contexts/:id", async (req, res) => {
      const claims = MachineClaims.parse(await iamRequest(auth.identityUrl, "/internal/iam/machine/introspect", bearer(req.get("authorization")), { audience: "conversation", scope: "channel:context" }));
      if (claims.sub !== config.sourceClientId || !claims.workflows.includes("WF-02")) throw denied();
      const r = await context(req.params.id as string); res.json({ data: { sessionId: r.session_id, input: r.input } });
    });
    app.post("/internal/conversations/route", async (req, res) => {
      const input = ConversationProof.parse(req.body), b = await proof(bearer(req.get("authorization")), input, "conversation.route", "WF-01");
      const data = await tx(async c => {
        const r = await row(c, b.entity.id);
        if (localAI || r.version !== b.entity.version || r.mode !== "AI") return { routed: false };
        const message = (await c.query("SELECT id FROM chat_messages WHERE id=$1 AND conversation_id=$2 AND direction='IN'", [b.inputRef, r.id])).rows[0];
        if (!message) throw denied();
        const id = randomUUID(), eventId = randomUUID();
        const existing = (await c.query("SELECT id FROM chat_contexts WHERE conversation_id=$1 AND watermark=$2 AND (input->'entity'->>'version')::integer=$3", [r.id, r.watermark, r.version])).rows[0];
        if (existing) return { contextRef: existing.id };
        const delegation = DelegationInput.parse({ eventId, workflowId: "WF-02", workflowVersion: 1, branchId: r.branch_id,
          entity: { type: "conversation", id: r.id, version: r.version }, inputRef: b.inputRef, operations: ["catalog.read", "classes.read"] });
        await c.query("INSERT INTO chat_contexts(id,conversation_id,session_id,input,watermark) VALUES($1,$2,$3,$4,$5)", [id, r.id, r.session_id, delegation, r.watermark]);
        await event(c, "conversation.ai_requested", r, b.inputRef, id, eventId); return { contextRef: id };
      }); res.json({ data });
    });
    app.post("/internal/conversations/turn", async (req, res) => {
      const input = ConversationProof.parse(req.body), b = await proof(bearer(req.get("authorization")), input, "conversation.send", "WF-02");
      const r = await context(b.contextRef);
      if (r.conversation_id !== b.entity.id || JSON.stringify(r.input.entity) !== JSON.stringify(b.entity) || r.input.inputRef !== b.inputRef || r.input.eventId !== b.eventId) throw denied();
      await iamRequest(auth.identityUrl, "/internal/iam/channel-delegations", await sourceToken(), { contextRef: b.contextRef });
      const data = await tx(async c => {
        await lockSession(c, b.entity.id); await row(c, b.entity.id); await context(b.contextRef, c);
        await proof(bearer(req.get("authorization")), input, "conversation.send", "WF-02");
        if (!providerAllowed) return { messages: [], version: b.entity.version, modelReady: false, providerAllowed: false, errorCode: "DATA_POLICY_BLOCKED" };
        const messages = (await c.query("SELECT sender,text FROM chat_messages WHERE conversation_id=$1 AND sender IN ('GUEST','AI') AND delivery NOT IN ('QUEUED','CANCELLED') ORDER BY created_at DESC,id DESC LIMIT 8", [r.conversation_id])).rows.reverse();
        return { messages: messages.map(m => ({ sender: m.sender, text: redact(m.text) })), version: b.entity.version, modelReady: config.modelReady === true, providerAllowed: true };
      }); res.json({ data });
    });
    app.post("/internal/conversations/draft", async (req, res) => {
      const input = ConversationDraft.parse(req.body), token = bearer(req.get("authorization"));
      const b = await proof(token, input, "conversation.send", "WF-02");
      if (localAI) throw stale();
      const data = await tx(async c => {
        await lockSession(c, b.entity.id);
        const r = await row(c, b.entity.id);
        if (r.mode !== "AI" || r.owner_id || r.version !== b.entity.version) throw stale();
        const ctx = await context(b.contextRef, c);
        if (ctx.conversation_id !== b.entity.id || JSON.stringify(ctx.input.entity) !== JSON.stringify(b.entity) || ctx.input.inputRef !== b.inputRef || ctx.input.eventId !== b.eventId) throw denied();
        if (!input.errorCode && providerAllowed) {
          // A result cannot outlive the Channel credential that authorized its context.
          await iamRequest(auth.identityUrl, "/internal/iam/channel-delegations", await sourceToken(), { contextRef: b.contextRef });
        }
        // Both output and handoff must reject a lease that expired while waiting for locks.
        await proof(token, input, "conversation.send", "WF-02");
        if (input.errorCode) {
          const next = (await c.query("UPDATE conversations SET mode='HUMAN',version=version+1,error_code=$2,updated_at=clock_timestamp() WHERE id=$1 RETURNING *", [r.id, input.errorCode])).rows[0];
          await audit(c, r.id, "automation", input.errorCode, next.version);
          await event(c, "conversation.handoff_requested", next, r.id, r.session_id);
          return { handoff: true };
        }
        if (!providerAllowed) throw new HttpError(403, "DATA_POLICY_BLOCKED", "Provider export is restricted to isolated synthetic tests");
        if (!input.sources.length) throw new HttpError(400, "SOURCES_REQUIRED", "Source receipts required");
        const id = randomUUID();
        await c.query("INSERT INTO chat_messages(id,conversation_id,dedup_key,direction,sender,text,sources,model,delivery,conversation_version) VALUES($1,$2,$3,'OUT','AI',$4,$5,$6,'QUEUED',$7) ON CONFLICT(conversation_id,dedup_key) DO NOTHING", [id, r.id, `ai:${b.eventId}`, redact(input.text), JSON.stringify(input.sources), input.model, r.version]);
        return { queued: true };
      }); res.json({ data });
    });
    app.post("/internal/conversations/handoff", async (req, res) => {
      const input = ConversationProof.parse(req.body), b = await proof(bearer(req.get("authorization")), input, "conversation.handoff", "WF-03");
      res.json({ data: await tx(async c => { const r = await row(c, b.entity.id);
        await audit(c, r.id, "WF-03", "queue.observed", r.version);
        return { mode: r.mode, version: r.version, ownerId: r.owner_id, waitingForStaff: r.mode === "HUMAN" && !r.owner_id };
      }) });
    });
  });
}
