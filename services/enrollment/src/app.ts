import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { DemoTermsVersion, EnrollmentPreview, MachineClaims,RegistrationTrigger,EnrollmentConfirmedEvent } from "@spacex/contracts";
import { authenticate, allowRoles, bearer, checkBranch, iamRequest, principal, verifyCommand, type AuthConfig } from "@spacex/auth";
import { createApp, HttpError } from "@spacex/http";
import { enqueueEvent } from "@spacex/messaging";
import { registerAdjustments } from "./adjustments.js";

export interface EnrollmentConfig { catalogUrl: string; classUrl: string; crmUrl: string; paymentUrl: string; sourceClientId: string; sourceClientSecret: string; notificationUrl?: string; }
// Database rows are converted at the HTTP boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const denied = () => new HttpError(403, "FORBIDDEN", "Enrollment authority does not match");
const conflict = (code: string) => new HttpError(409, code, "Reload the authoritative enrollment state");
const terms = "DEMO tổng hợp: giữ chỗ 20 phút theo Class server; QR tổng hợp, không chuyển tiền thật. Review không gia hạn chỗ; ngoại lệ cần duyệt độc lập, hoàn/chuyển chưa thực hiện.";
export function quoteVersion(quote: Row) { const { quotedAt: _time, ...stable } = quote; void _time; return createHash("sha256").update(JSON.stringify(stable)).digest("hex"); }

export function createEnrollmentApp(pool: Pool, auth: AuthConfig, config: EnrollmentConfig) {
  async function tx<T>(work: (c: PoolClient) => Promise<T>) {
    const c = await pool.connect();
    try { await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); const result = await work(c); await c.query("COMMIT"); return result; }
    catch (error) { await c.query("ROLLBACK"); const code=(error as {code?:string}).code; if(code)console.error(JSON.stringify({event:"enrollment.transaction_failed",sqlState:code})); if (code === "23505") throw conflict("DUPLICATE_ENROLLMENT"); throw error; } finally { c.release(); }
  }
  async function api(base: string, path: string, token: string): Promise<Row> {
    let r: Response;
    try { r = await fetch(base + path, { headers: {authorization:`Bearer ${token}`}, signal:AbortSignal.timeout(4000), redirect:"error" }); }
    catch { throw new HttpError(503,"DEPENDENCY_UNAVAILABLE","Authoritative source unavailable"); }
    if (!r.ok) throw new HttpError([400,401,403,404,409].includes(r.status)?r.status:503,r.status>=500?"DEPENDENCY_UNAVAILABLE":"SOURCE_DENIED","Authoritative source rejected request");
    return (await r.json() as {data:Row}).data;
  }
  async function audit(c: PoolClient, id: string, actor: string, action: string, correlation: string) {
    const auditId=randomUUID();
    await c.query("INSERT INTO enrollment_audit(id,target_id,actor_id,action,correlation_id) VALUES($1,$2,$3,$4,$5)",[auditId,id,actor,action,correlation]);
    await enqueueEvent(c,{id:auditId,type:"enrollment.changed",version:1,occurredAt:new Date().toISOString(),correlationId:correlation,payload:{targetId:id,action,auditRef:auditId}});
  }
  async function bound(token: string, id: string, audience: "enrollment"|"payment"|"class-schedule" = "enrollment") {
    const u = await verifyCommand(auth,token,audience,audience === "enrollment"?"enrollment:write":audience === "payment"?"payment:write":"classes:enroll");
    const d=u.delegation;
    if (d?.entity?.type !== "enrollment" || d.entity.id !== id) throw denied();
    if(d.workflowId==="WF-05"){
      const s=await source(pool,id);
      if(d.inputRef!==s.id||u.sub!==s.actor_id||u.sid!==s.session_id||d.branchId!==s.branch_id||s.status==="REVOKED")throw denied();
    }else if(d.workflowId==="WF-06"){
      if(d.source!=="service")throw denied();
    }else if(d.workflowId==="WF-07"){
      if(d.source!=="service"){
        const cancel=(await pool.query("SELECT * FROM enrollment_cancellations WHERE id=$1 AND enrollment_id=$2",[d.inputRef,id])).rows[0];
        if(!cancel||cancel.actor_id!==u.sub||cancel.session_id!==u.sid)throw denied();
      }
    }else throw denied();
    return u;
  }
  async function source(c: Pool | PoolClient, id: string) {
    const r = (await c.query("SELECT *,clock_timestamp() AS now FROM confirmations WHERE enrollment_id=$1",[id])).rows[0];
    if (!r) throw new HttpError(404,"NOT_FOUND","Confirmation not found"); return r;
  }
  async function record(c: Pool | PoolClient, id: string, lock = false) {
    const r = (await c.query(`SELECT *,clock_timestamp() AS now FROM enrollments WHERE id=$1 ${lock?"FOR UPDATE":""}`,[id])).rows[0];
    if (!r) throw new HttpError(404,"NOT_FOUND","Enrollment not found"); return r;
  }
  function view(r: Row) { return {id:r.id,confirmationId:r.confirmation_id,status:r.status,version:r.version,snapshot:r.snapshot,holdId:r.hold_id,expiresAt:r.expires_at,paymentRequestId:r.payment_id,matchRef:r.match_ref,releaseAuthorized:r.release_authorized}; }
  async function sourceToken(){return (await iamRequest(auth.identityUrl,"/internal/iam/machine/token","",{clientId:config.sourceClientId,clientSecret:config.sourceClientSecret,audience:"enrollment",scopes:["automation:source"],workflows:["WF-07"],ttlSeconds:60}) as {accessToken:string}).accessToken;}
  async function emit(c: PoolClient, r: Row, type: string, inputRef: string, workflowId: "WF-07", eventId=randomUUID()) {
    const accessToken=await sourceToken();
    const entity={type:"enrollment",id:r.id,version:r.version};
    const {contextRef} = await iamRequest(auth.identityUrl,"/internal/iam/service-delegations",accessToken,{audience:"enrollment",input:{eventId,workflowId,workflowVersion:1,branchId:r.branch_id,entity,inputRef,operations:["enrollment.execute","classes.enroll","payment.execute"]}}) as {contextRef:string};
    await enqueueEvent(c,RegistrationTrigger.parse({id:eventId,type,version:1,occurredAt:new Date().toISOString(),correlationId:r.correlation_id,entityId:r.id,entityVersion:r.version,payload:{entity,inputRef,contextRef}}));
  }
  return createApp("enrollment", app => {
    registerAdjustments(app, pool, auth, config);
    app.get("/ready",async (_req,res)=>{await pool.query("SELECT id FROM enrollments LIMIT 0");res.json({ready:true});});
    app.use("/api/v1",authenticate(auth),allowRoles("center_director","branch_director","admissions"));
    app.post("/api/v1/enrollment-confirmations/preview",async(req,res)=>{
      const input=EnrollmentPreview.parse(req.body), u=principal(res), token=bearer(req.get("authorization")), key=z.uuid().parse(req.get("idempotency-key"));
      const data=await tx(async c=>{
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[u.sub+key]);
        const old=(await c.query("SELECT *,payload=$3::jsonb AS identical FROM confirmations WHERE actor_id=$1 AND operation_key=$2",[u.sub,key,input])).rows[0];
        if(old){if(!old.identical||old.session_id!==u.sid)throw conflict("IDEMPOTENCY_MISMATCH");return old;}
        const people=await api(config.crmUrl,`/api/v1/crm/enrollment-authority?contactId=${input.contactId}&learnerId=${input.learnerId}&payerId=${input.payerId}`,token);
        const cls=await api(config.classUrl,`/api/v1/classes/${input.classId}`,token);checkBranch(u,people.branchId);
        if(cls.branchId!==people.branchId||cls.packageId!==input.packageId||cls.status!=="OPEN")throw conflict("CLASS_NOT_SELLABLE");
        const quote=await api(config.catalogUrl,`/api/v1/packages/${input.packageId}/quote`,token);
        if(quote.courseId!==cls.courseId||quote.sessionCount!==cls.sessions.length||!Number.isSafeInteger(quote.priceVnd)||quote.priceVnd<=0)throw conflict("QUOTE_MISMATCH");
        const snapshot={...input,classVersion:cls.version,actorId:u.sub,branchId:people.branchId,amountDue:quote.priceVnd,currency:"VND",quoteId:quoteVersion(quote),quoteVersion:quoteVersion(quote),policyVersion:`${quote.courseVersion}:${quote.packageVersion}`,termsVersion:DemoTermsVersion,terms,quote,crm:people};
        await iamRequest(auth.identityUrl,"/api/v1/auth/introspect",token,{});
        const r=(await c.query("INSERT INTO confirmations(id,enrollment_id,actor_id,session_id,branch_id,snapshot,payload,operation_key,event_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",[randomUUID(),randomUUID(),u.sub,u.sid,people.branchId,snapshot,input,key,randomUUID()])).rows[0];
        await audit(c,r.id,u.sub,"confirmation.previewed",res.locals.correlationId);return r;
      });res.status(201).json({data:{id:data.id,snapshot:data.snapshot,expiresAt:data.expires_at,status:data.status}});
    });
    for(const action of ["confirm","revoke"] as const)app.post(`/api/v1/enrollment-confirmations/:id/${action}`,async(req,res)=>{
      if(action==="confirm")z.object({accepted:z.literal(true)}).strict().parse(req.body);else z.object({}).strict().parse(req.body);
      const u=principal(res),token=bearer(req.get("authorization")),id=z.uuid().parse(req.params.id);
      const data=await tx(async c=>{
        const r=(await c.query("SELECT *,clock_timestamp() AS now FROM confirmations WHERE id=$1 FOR UPDATE",[id])).rows[0];
        if(!r||r.actor_id!==u.sub||r.session_id!==u.sid)throw denied();checkBranch(u,r.branch_id);
        if(action==="revoke"){
          if(r.status==="CONSUMED")throw conflict("ALREADY_CONSUMED");
          await c.query("UPDATE confirmations SET status='REVOKED' WHERE id=$1",[id]);
        }else{
          if(r.status==="REVOKED"||r.expires_at<=r.now)throw conflict("CONFIRMATION_EXPIRED");
          if(r.status!=="DRAFT")return {id,status:r.status};
          const quote=await api(config.catalogUrl,`/api/v1/packages/${r.snapshot.packageId}/quote`,token);
          if(quoteVersion(quote)!==r.snapshot.quoteVersion||r.snapshot.termsVersion!==DemoTermsVersion)throw conflict("RECONFIRM_REQUIRED");
          await api(config.crmUrl,`/api/v1/crm/enrollment-authority?contactId=${r.snapshot.contactId}&learnerId=${r.snapshot.learnerId}&payerId=${r.snapshot.payerId}`,token);
          const entity={type:"enrollment",id:r.enrollment_id,version:1};
          const {contextRef}=await iamRequest(auth.identityUrl,"/internal/iam/delegations",token,{eventId:r.event_id,workflowId:"WF-05",workflowVersion:1,branchId:r.branch_id,entity,inputRef:id,operations:["enrollment.execute","classes.enroll","payment.execute"]}) as {contextRef:string};
          const changed=await c.query("UPDATE confirmations SET status='CONFIRMED',context_id=$2 WHERE id=$1 AND status='DRAFT' AND expires_at>clock_timestamp() RETURNING id",[id,contextRef]);
          if(!changed.rowCount)throw conflict("CONFIRMATION_EXPIRED");
          await enqueueEvent(c,{id:r.event_id,type:"enrollment.requested",version:1,occurredAt:new Date().toISOString(),correlationId:r.enrollment_id,entityId:r.enrollment_id,entityVersion:1,payload:{entity,contextRef,inputRef:id}});
        }
        await iamRequest(auth.identityUrl,"/api/v1/auth/introspect",token,{});
        await audit(c,id,u.sub,`confirmation.${action}`,res.locals.correlationId);return {id,status:action==="confirm"?"CONFIRMED":"REVOKED"};
      });res.json({data});
    });
    app.get("/api/v1/enrollment-confirmations/:id",async(req,res)=>{
      const u=principal(res),r=(await pool.query("SELECT *,clock_timestamp() AS now FROM confirmations WHERE id=$1",[z.uuid().parse(req.params.id)])).rows[0];
      if(!r||(u.role==="admissions"&&r.actor_id!==u.sub))throw denied();checkBranch(u,r.branch_id);
      const row=(await pool.query("SELECT * FROM enrollments WHERE id=$1",[r.enrollment_id])).rows[0];
      let enrollment: Row|undefined=row?view(row):undefined;
      if(row?.payment_id){const payment=await api(config.paymentUrl,`/api/v1/payment-requests/${row.payment_id}`,bearer(req.get("authorization")));enrollment={...enrollment,paymentRequest:payment,moneyStatus:payment.moneyStatus};}
      const status=["DRAFT","CONFIRMED"].includes(r.status)&&r.expires_at<=r.now?"EXPIRED":r.status;
      res.json({data:{id:r.id,status,expiresAt:r.expires_at,snapshot:r.snapshot,enrollment}});
    });
    app.get("/api/v1/enrollments",async(_req,res)=>{
      const u=principal(res),rows=(await pool.query("SELECT * FROM enrollments WHERE ($1::uuid[] IS NULL OR branch_id=ANY($1)) AND ($2 OR actor_id=$3) ORDER BY created_at DESC LIMIT 100",[u.role==="center_director"?null:u.branchIds,u.role!=="admissions",u.sub])).rows;
      res.json({data:rows.map(view)});
    });
    app.get("/api/v1/enrollments/:id",async(req,res)=>{const r=await record(pool,z.uuid().parse(req.params.id)),u=principal(res);checkBranch(u,r.branch_id);if(u.role==="admissions"&&r.actor_id!==u.sub)throw denied();res.json({data:view(r)});});
    app.post("/api/v1/enrollments/:id/cancel",async(req,res)=>{
      const id=z.uuid().parse(req.params.id),key=z.uuid().parse(req.get("idempotency-key")),input=z.object({version:z.number().int().positive(),reason:z.string().trim().min(10).max(1000)}).strict().parse(req.body),u=principal(res),token=bearer(req.get("authorization"));
      const data=await tx(async c=>{
        const r=await record(c,id,true);checkBranch(u,r.branch_id);if(u.role==="admissions"&&r.actor_id!==u.sub)throw denied();
        const old=(await c.query("SELECT *,payload=$2::jsonb AS identical FROM enrollment_cancellations WHERE id=$1",[key,input])).rows[0];
        if(old){if(!old.identical||old.actor_id!==u.sub||old.session_id!==u.sid||old.enrollment_id!==id)throw conflict("IDEMPOTENCY_MISMATCH");return {id:key,status:"REQUESTED"};}
        if(r.version!==input.version||!["HELD","PENDING_HOLD","PAYMENT_REVIEW"].includes(r.status))throw conflict("INVALID_CANCELLATION");
        const eventId=randomUUID(),entity={type:"enrollment",id,version:r.version};
        const {contextRef}=await iamRequest(auth.identityUrl,"/internal/iam/delegations",token,{eventId,workflowId:"WF-07",workflowVersion:1,branchId:r.branch_id,entity,inputRef:key,operations:["enrollment.execute","payment.execute","classes.enroll"]}) as {contextRef:string};
        await c.query("INSERT INTO enrollment_cancellations(id,enrollment_id,actor_id,session_id,payload,event_id,context_id) VALUES($1,$2,$3,$4,$5,$6,$7)",[key,id,u.sub,u.sid,input,eventId,contextRef]);
        await enqueueEvent(c,{id:eventId,type:"enrollment.cancel_requested",version:1,occurredAt:new Date().toISOString(),correlationId:r.correlation_id,entityId:id,entityVersion:r.version,payload:{entity,inputRef:key,contextRef}});
        await audit(c,id,u.sub,"cancellation.requested",r.correlation_id);return {id:key,status:"REQUESTED"};
      });res.status(202).json({data});
    });
    app.get("/internal/enrollment/enrollments/:id/customer-authority",async(req,res)=>{
      const id=z.uuid().parse(req.params.id),u=await bound(bearer(req.get("authorization")),id),r=await source(pool,id);checkBranch(u,r.branch_id);
      res.json({data:{id,branchId:r.branch_id,contactId:r.snapshot.contactId,learnerId:r.snapshot.learnerId,payerId:r.snapshot.payerId}});
    });
    for(const kind of ["seat","payment"] as const)app.get(`/internal/enrollment/enrollments/:id/${kind}-authority`,async(req,res)=>{
      const id=z.uuid().parse(req.params.id),token=bearer(req.get("authorization")),u=await bound(token,id,kind==="seat"?"class-schedule":"payment"),r=await record(pool,id);checkBranch(u,r.branch_id);
      let quoteCurrent=true;
      if(r.status==="PENDING_HOLD"&&kind==="seat"){
        try{quoteCurrent=quoteVersion(await api(config.catalogUrl,`/internal/catalog/class-quote/${r.snapshot.packageId}`,token))===r.snapshot.quoteVersion;}
        catch(error){if(error instanceof HttpError&&error.status===409)quoteCurrent=false;else throw error;}
      }
      const cancellation=u.delegation?.source?false:!!(await pool.query("SELECT 1 FROM enrollment_cancellations WHERE id=$1 AND enrollment_id=$2 AND actor_id=$3 AND session_id=$4",[u.delegation?.inputRef,id,u.sub,u.sid])).rowCount;
      res.json({data:{...r.snapshot,id,state:r.status,status:r.status,version:r.version,snapshot:r.snapshot,quote:r.snapshot.quote,quoteCurrent,matchRef:r.match_ref,holdId:r.hold_id,expiresAt:r.expires_at,createdAt:r.created_at,cancelRequested:cancellation,releaseAuthorized:r.release_authorized}});
    });
    app.get("/internal/enrollment/enrollments/:id",async(req,res)=>{const id=z.uuid().parse(req.params.id),u=await bound(bearer(req.get("authorization")),id),r=await record(pool,id);checkBranch(u,r.branch_id);const cancellation=(await pool.query("SELECT 1 FROM enrollment_cancellations WHERE id=$1 AND enrollment_id=$2",[u.delegation!.inputRef,id])).rowCount;res.json({data:{...view(r),cancelRequested:!!cancellation}});});
    app.post("/internal/enrollment/enrollments/:id/:action",async(req,res)=>{
      z.object({}).strict().parse(req.body);const id=z.uuid().parse(req.params.id),action=z.enum(["create","held","payment","confirming","confirm","reconcile","cancel","failed","exception"]).parse(req.params.action),token=bearer(req.get("authorization"));
      const data=await tx(async c=>{
        const u=await bound(token,id),d=u.delegation!,s=await source(c,id);checkBranch(u,s.branch_id);
        if(d.workflowId==="WF-05"&&(s.actor_id!==u.sub||s.session_id!==u.sid||d.inputRef!==s.id))throw denied();
        if(d.workflowId==="WF-06"&&d.source!=="service")throw denied();
        if(action==="cancel"&&(d.workflowId!=="WF-07"||d.source))throw denied();
        if(!((d.workflowId==="WF-05"&&["create","held","payment","failed"].includes(action))||(d.workflowId==="WF-06"&&["confirming","confirm","exception"].includes(action))||(d.workflowId==="WF-07"&&["reconcile","cancel","exception"].includes(action))))throw denied();
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[id]);
        const key=`automation:${d.jobId}:enrollment.execute:${action}`;
        const old=(await c.query("SELECT * FROM enrollment_operations WHERE key=$1",[key])).rows[0];if(old)return old.result;
        let r=(await c.query("SELECT *,clock_timestamp() AS now FROM enrollments WHERE id=$1 FOR UPDATE",[id])).rows[0];
        if(action==="create"){
          const locked=(await c.query("SELECT *,clock_timestamp() AS now FROM confirmations WHERE id=$1 FOR UPDATE",[s.id])).rows[0];
          if(r)return view(r);
          if(locked.status!=="CONFIRMED"||locked.expires_at<=locked.now)throw conflict("CONFIRMATION_EXPIRED");
          let current:boolean;
          try {
            const quote=await api(config.catalogUrl,`/internal/catalog/enrollment-quote/${s.snapshot.packageId}`,token);
            await api(config.crmUrl,`/internal/crm/enrollment-authority?enrollmentId=${id}`,token);
            current=quoteVersion(quote)===s.snapshot.quoteVersion&&s.snapshot.termsVersion===DemoTermsVersion;
          } catch(error) { if(error instanceof HttpError&&error.status===409)current=false;else throw error; }
          const status=current?"PENDING_HOLD":"NEEDS_CONFIRMATION";
          r=(await c.query("INSERT INTO enrollments(id,confirmation_id,actor_id,branch_id,learner_id,class_id,snapshot,status,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",[id,s.id,s.actor_id,s.branch_id,s.snapshot.learnerId,s.snapshot.classId,s.snapshot,status,id])).rows[0];
          await bound(token,id);
          const consumed=await c.query("UPDATE confirmations SET status='CONSUMED' WHERE id=$1 AND status='CONFIRMED' AND expires_at>clock_timestamp() RETURNING id",[s.id]);
          if(!consumed.rowCount)throw conflict("CONFIRMATION_EXPIRED");
        }else{
          if(!r)throw conflict("ENROLLMENT_NOT_CREATED");
          if(action==="held"){
            const seat=await api(config.classUrl,`/internal/classes/enrollments/${id}/enrollment-authority`,token);
            if(r.status!=="PENDING_HOLD"||seat.hold?.status!=="HELD")throw conflict("HOLD_REQUIRED");
            r=(await c.query("UPDATE enrollments SET status='HELD',hold_id=$2,expires_at=$3,version=version+1 WHERE id=$1 RETURNING *",[id,seat.hold.id,seat.hold.expiresAt])).rows[0];
          }else if(action==="payment"){
            const p=await api(config.paymentUrl,`/internal/payment/enrollments/${id}/enrollment-authority`,token);
            if(!["HELD","CONFIRMING","CONFIRMED","PAYMENT_REVIEW"].includes(r.status)||p.enrollmentId!==id||p.amountDue!==r.snapshot.amountDue||!r.hold_id||new Date(p.expiresAt)>r.expires_at)throw conflict("PAYMENT_REQUEST_REQUIRED");
            r=(await c.query("UPDATE enrollments SET payment_id=$2,version=version+1 WHERE id=$1 RETURNING *",[id,p.id])).rows[0];
          }else if(action==="confirming"){
            const match=await api(config.paymentUrl,`/internal/payment/matches/${d.inputRef}/enrollment-authority`,token);
            if(!match.eligible||match.enrollmentId!==id)throw conflict("VERIFIED_MATCH_REQUIRED");
            if(["CANCELLED","REFUND_PENDING","NEEDS_CONFIRMATION"].includes(r.status))return view(r);
            if(!["HELD","EXPIRED","PAYMENT_REVIEW","CONFIRMING","CONFIRMED"].includes(r.status))throw conflict("INVALID_TRANSITION");
            if(r.status!=="CONFIRMED")r=(await c.query("UPDATE enrollments SET status='CONFIRMING',match_ref=$2,payment_id=COALESCE(payment_id,$3),release_authorized=false,version=version+1 WHERE id=$1 RETURNING *",[id,match.id,match.paymentRequestId])).rows[0];
          }else if(action==="confirm"){
            const seat=await api(config.classUrl,`/internal/classes/enrollments/${id}/enrollment-authority`,token);
            if(!seat.committed||seat.hold?.status!=="COMMITTED"||r.status!=="CONFIRMING")throw conflict("COMMIT_REQUIRED");
            const match=await api(config.paymentUrl,`/internal/payment/matches/${r.match_ref}/enrollment-authority`,token);
            if(!match.eligible||match.enrollmentId!==id)throw conflict("VERIFIED_MATCH_REQUIRED");
            r=(await c.query("UPDATE enrollments SET status='CONFIRMED',hold_id=$2,release_authorized=false,version=version+1 WHERE id=$1 RETURNING *",[id,seat.hold.id])).rows[0];
            await enqueueEvent(c,EnrollmentConfirmedEvent.parse({id:randomUUID(),type:"enrollment.confirmed",version:1,occurredAt:new Date().toISOString(),correlationId:r.correlation_id,causationId:match.eventId,entityId:id,entityVersion:r.version,payload:{enrollmentId:id,confirmationId:r.confirmation_id,learnerId:r.learner_id,contactId:r.snapshot.contactId,payerId:r.snapshot.payerId,classId:r.class_id,courseId:r.snapshot.quote.courseId,packageId:r.snapshot.packageId,holdId:r.hold_id,matchRef:r.match_ref,paymentRequestId:r.payment_id,branchId:r.branch_id,amountDue:r.snapshot.amountDue,currency:"VND",snapshotVersion:r.snapshot.quoteVersion,policyVersion:r.snapshot.policyVersion,termsVersion:r.snapshot.termsVersion,automationJobId:d.jobId}}));
          }else{
            const seat=await api(config.classUrl,`/internal/classes/enrollments/${id}/enrollment-authority`,token);
            const money=await api(config.paymentUrl,`/internal/payment/enrollments/${id}/enrollment-authority`,token);
            if(seat.committed||r.status==="CONFIRMED")return view(r);
            if(action==="reconcile"&&!money.receivedAmount&&seat.hold?.status==="HELD")return view(r);
            const noSeat=money.reviews?.some((x:Row)=>x.reason==="NO_SEAT"&&x.ledgerId===money.matchLedgerId),refund=money.reviews?.some((x:Row)=>x.status==="REFUND_PENDING"&&(!money.matchRef||x.ledgerId===money.matchLedgerId));
            if(money.matchRef&&!noSeat&&!refund&&!["CANCELLED","REFUND_PENDING"].includes(r.status))return view(r);
            if(!["CANCELLED","EXPIRED","REVIEW"].includes(money.status)&&!noSeat&&!refund)throw conflict("RECONCILE_PAYMENT_FIRST");
            const status=refund?"REFUND_PENDING":money.receivedAmount>0?"PAYMENT_REVIEW":action==="cancel"||action==="failed"?"CANCELLED":"EXPIRED";
            const release=r.release_authorized||action==="cancel"||action==="failed"||noSeat||refund||r.expires_at<=r.now;
            if(r.status===status&&r.release_authorized===release)return view(r);
            r=(await c.query("UPDATE enrollments SET status=$2,release_authorized=$3,version=version+1,deadline_version=CASE WHEN $3 THEN version+1 ELSE deadline_version END WHERE id=$1 RETURNING *",[id,status,release])).rows[0];
          }
        }
        await bound(token,id);const result=view(r);
        await audit(c,id,u.sub,`enrollment.${action}`,r.correlation_id);
        await c.query("INSERT INTO enrollment_operations(key,enrollment_id,action,payload,result) VALUES($1,$2,$3,'{}',$4)",[key,id,action,result]);return result;
      });res.json({data});
    });
    app.post("/internal/enrollment/deadlines",async(req,res)=>{
      z.object({}).strict().parse(req.body);const claims=MachineClaims.parse(await iamRequest(auth.identityUrl,"/internal/iam/machine/introspect",bearer(req.get("authorization")),{audience:"automation-bridge",scope:"automation:authorize"}));
      if(!claims.workflows.includes("WF-07"))throw denied();
      const count=await tx(async c=>{
        const rows=(await c.query("SELECT * FROM enrollments WHERE status IN ('PENDING_HOLD','HELD','PAYMENT_REVIEW') AND COALESCE(expires_at,created_at+interval '21 minutes')<=clock_timestamp() AND deadline_version IS DISTINCT FROM version ORDER BY COALESCE(expires_at,created_at+interval '21 minutes') LIMIT 50 FOR UPDATE SKIP LOCKED")).rows;
        if(!rows.length)return 0;
        let response:Response;
        try{response=await fetch(`${config.classUrl}/internal/classes/deadlines`,{method:"POST",headers:{authorization:`Bearer ${await sourceToken()}`,"content-type":"application/json"},body:JSON.stringify({enrollmentIds:rows.map(r=>r.id)}),signal:AbortSignal.timeout(4000),redirect:"error"});}
        catch{throw new HttpError(503,"CLASS_UNAVAILABLE","Class deadline source unavailable");}
        if(!response.ok)throw new HttpError(503,"CLASS_UNAVAILABLE","Class deadline source denied");
        const observed=(await response.json() as {data:Row[]}).data;let emitted=0;
        for(const r of rows){
          const seat=observed.find(s=>s.enrollmentId===r.id)?.hold;
          if(seat&&(seat.classId!==r.class_id||seat.learnerId!==r.learner_id||seat.packageId!==r.snapshot.packageId))throw new HttpError(503,"CLASS_MISMATCH","Class deadline resource mismatch");
          if(seat?.status==="COMMITTED")continue;
          if(seat?.status==="HELD"){
            if(!r.expires_at||new Date(seat.expiresAt).getTime()!==r.expires_at.getTime()){
              await c.query("UPDATE enrollments SET hold_id=$2,expires_at=$3,version=version+1 WHERE id=$1",[r.id,seat.id,seat.expiresAt]);
              await audit(c,r.id,config.sourceClientId,"enrollment.deadline_observed",r.correlation_id);
            }continue;
          }
          await emit(c,r,"enrollment.deadline",r.id,"WF-07");await c.query("UPDATE enrollments SET deadline_version=version WHERE id=$1",[r.id]);emitted++;
        }return emitted;
      });res.json({data:{count}});
    });
  });
}
