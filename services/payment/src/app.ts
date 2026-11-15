import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import QRCode from "qrcode";
import { MachineClaims, PaymentReviewDecision, SyntheticPaymentInput,RegistrationTrigger,PaymentReceivedEvent } from "@spacex/contracts";
import { authenticate, allowRoles, bearer, checkBranch, iamRequest, principal, verifyCommand, type AuthConfig } from "@spacex/auth";
import { createApp, HttpError } from "@spacex/http";
import { enqueueEvent } from "@spacex/messaging";

export interface PaymentConfig { enrollmentUrl:string; classUrl:string; sourceClientId:string; sourceClientSecret:string; reviewOwnerId:string; syntheticWebhookSecret:string; syntheticEnabled:boolean; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row=Record<string,any>;
const denied=()=>new HttpError(403,"FORBIDDEN","Payment authority does not match");
const conflict=(code:string)=>new HttpError(409,code,"Read the durable payment operation before retrying");
export function syntheticSignature(secret:string,payload:unknown){return createHmac("sha256",secret).update(JSON.stringify(SyntheticPaymentInput.parse(payload))).digest("hex");}
export function createPaymentApp(pool:Pool,auth:AuthConfig,config:PaymentConfig){
  z.uuid().parse(config.reviewOwnerId);
  if(config.syntheticEnabled&&Buffer.byteLength(config.syntheticWebhookSecret)<32)throw new Error("Isolated synthetic webhook secret required");
  async function tx<T>(work:(c:PoolClient)=>Promise<T>){const c=await pool.connect();try{await c.query("BEGIN");await c.query("SET LOCAL lock_timeout='5s'");const r=await work(c);await c.query("COMMIT");return r;}catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}}
  async function api(base:string,path:string,token:string):Promise<Row>{let r:Response;try{r=await fetch(base+path,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(4000),redirect:"error"});}catch{throw new HttpError(503,"SOURCE_UNAVAILABLE","Payment source unavailable");}if(!r.ok)throw new HttpError([401,403,404,409].includes(r.status)?r.status:503,r.status>=500?"SOURCE_UNAVAILABLE":"SOURCE_DENIED","Payment source denied");return(await r.json() as {data:Row}).data;}
  async function bound(token:string,id:string,audience:"payment"|"enrollment"|"class-schedule"="payment"){
    const u=await verifyCommand(auth,token,audience,audience==="payment"?"payment:write":audience==="enrollment"?"enrollment:write":"classes:enroll");
    if(u.delegation?.entity?.type!=="enrollment"||u.delegation.entity.id!==id)throw denied();return u;
  }
  async function audit(c:PoolClient,id:string,actor:string,action:string,correlation:string){const auditId=randomUUID();await c.query("INSERT INTO payment_audit(id,target_id,actor_id,action,correlation_id) VALUES($1,$2,$3,$4,$5)",[auditId,id,actor,action,correlation]);await enqueueEvent(c,{id:auditId,type:"payment.changed",version:1,occurredAt:new Date().toISOString(),correlationId:correlation,payload:{targetId:id,action,auditRef:auditId}});}
  async function emit(c:PoolClient,r:Row,type:string,inputRef:string,workflowId:"WF-06"|"WF-07",eventId=randomUUID(),causationId?:string){
    const {accessToken}=await iamRequest(auth.identityUrl,"/internal/iam/machine/token","",{clientId:config.sourceClientId,clientSecret:config.sourceClientSecret,audience:"payment",scopes:["automation:source"],workflows:[workflowId],ttlSeconds:60}) as {accessToken:string};
    const entity={type:"enrollment",id:r.enrollment_id};
    const {contextRef}=await iamRequest(auth.identityUrl,"/internal/iam/service-delegations",accessToken,{audience:"payment",input:{eventId,workflowId,workflowVersion:1,branchId:r.branch_id,entity,inputRef,operations:["enrollment.execute","classes.enroll","payment.execute"]}}) as {contextRef:string};
    await enqueueEvent(c,RegistrationTrigger.parse({id:eventId,type,version:1,occurredAt:new Date().toISOString(),correlationId:r.enrollment_id,...(causationId?{causationId}:{}),entityId:r.enrollment_id,payload:{entity,inputRef,contextRef}}));return contextRef;
  }
  async function money(c:Pool|PoolClient,r:Row){
    const {rows}=await c.query("SELECT COALESCE(sum(amount),0)::bigint AS total,count(*)::int AS count FROM payment_ledger WHERE payment_id=$1",[r.id]);
    const m=(await c.query("SELECT * FROM payment_matches WHERE payment_id=$1",[r.id])).rows[0];
    return {receivedAmount:Number(rows[0].total),transactionCount:rows[0].count,matchRef:m?.id,matchLedgerId:m?.ledger_id};
  }
  async function view(c:Pool|PoolClient,r:Row){
    const totals=await money(c,r),reviews=(await c.query("SELECT id,ledger_id AS \"ledgerId\",status,owner_id AS \"ownerId\",deadline_at AS \"deadlineAt\",reason FROM payment_reviews WHERE payment_id=$1 ORDER BY deadline_at DESC",[r.id])).rows;
    const now=(await c.query("SELECT clock_timestamp() AS now")).rows[0].now as Date;
    const status=r.status==="OPEN"&&r.expires_at<=now?"EXPIRED":r.status;
    const qrPayload=`DEMO-ONLY:VND:${r.amount_due}:${r.reference}:${new Date(r.expires_at).toISOString()}`;
    const qrImageDataUrl=status==="OPEN"?await QRCode.toDataURL(qrPayload,{width:256,margin:4,errorCorrectionLevel:"M"}):undefined;
    return {id:r.id,enrollmentId:r.enrollment_id,branchId:r.branch_id,amountDue:Number(r.amount_due),currency:"VND",reference:r.reference,status,expiresAt:r.expires_at,adapter:"SYNTHETIC",qrPayload,qrImageDataUrl,reviews,...totals,moneyStatus:totals.receivedAmount===0?"UNPAID":totals.matchRef?totals.receivedAmount>Number(r.amount_due)?"MATCHED_WITH_EXCESS":"MATCHED":"REVIEW"};
  }
  async function review(c:PoolClient,r:Row|undefined,ledgerId:string,reason:string){
    const id=randomUUID(),result=await c.query("INSERT INTO payment_reviews(id,payment_id,ledger_id,branch_id,owner_id,reason) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(ledger_id,reason) DO NOTHING RETURNING id",[id,r?.id??null,ledgerId,r?.branch_id??null,config.reviewOwnerId,reason]);
    if(result.rowCount&&r)await emit(c,r,"payment.review_required",id,"WF-07");return id;
  }
  return createApp("payment",app=>{
    app.get("/ready",async(_req,res)=>{await pool.query("SELECT id FROM payment_ledger LIMIT 0");res.json({ready:true});});
    app.post("/internal/payment/synthetic-webhook",async(req,res)=>{
      if(!config.syntheticEnabled||process.env.NODE_ENV!=="test")throw denied();
      const payload=SyntheticPaymentInput.parse(req.body),signature=req.get("x-demo-signature")??"",expected=syntheticSignature(config.syntheticWebhookSecret,payload);
      if(!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature,"hex"),Buffer.from(expected,"hex")))throw new HttpError(401,"INVALID_SYNTHETIC_SIGNATURE","Demo webhook authentication failed");
      const data=await tx(async c=>{
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${payload.provider}:${payload.account}:${payload.transactionId}`]);
        const old=(await c.query("SELECT *,payload=$4::jsonb AS identical FROM payment_ledger WHERE provider=$1 AND account=$2 AND transaction_id=$3",[payload.provider,payload.account,payload.transactionId,payload])).rows[0];
        if(old){if(!old.identical)throw conflict("TRANSACTION_PAYLOAD_CONFLICT");return {ledgerId:old.id,duplicate:true};}
        const r=(await c.query("SELECT *,clock_timestamp() AS now FROM payment_requests WHERE reference=$1 FOR UPDATE",[payload.reference])).rows[0];
        const ledgerId=randomUUID(),receivedEventId=randomUUID();await c.query("INSERT INTO payment_ledger(id,provider,account,transaction_id,payload,amount,reference,payment_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[ledgerId,payload.provider,payload.account,payload.transactionId,payload,payload.amount,payload.reference,r?.id??null]);
        let matchRef:string|undefined;
        if(r){
          const prior=await money(c,r);
          if(prior.transactionCount===1&&payload.amount===Number(r.amount_due)&&["OPEN","EXPIRED"].includes(r.status)){
            matchRef=randomUUID();const eventId=randomUUID(),contextRef=await emit(c,r,"payment.matched",matchRef,"WF-06",eventId,receivedEventId);
            await c.query("INSERT INTO payment_matches(id,payment_id,ledger_id,amount,late,event_id,context_id) VALUES($1,$2,$3,$4,$5,$6,$7)",[matchRef,r.id,ledgerId,payload.amount,r.expires_at<=r.now,eventId,contextRef]);
            await c.query("INSERT INTO payment_allocations(ledger_id,payment_id,amount) VALUES($1,$2,$3)",[ledgerId,r.id,payload.amount]);
            await c.query("UPDATE payment_requests SET status='SETTLED',version=version+1 WHERE id=$1",[r.id]);
          }else{
            const reason=r.status==="CANCELLED"?"AFTER_CANCEL":prior.transactionCount>1?"MULTIPLE_TRANSACTIONS":payload.amount<Number(r.amount_due)?"UNDERPAID":"OVERPAID";
            await review(c,r,ledgerId,reason);await c.query("UPDATE payment_requests SET status=CASE WHEN status='SETTLED' THEN status ELSE 'REVIEW' END,version=version+1 WHERE id=$1",[r.id]);
          }
        }else await review(c,undefined,ledgerId,"UNALLOCATED_REFERENCE");
        await audit(c,ledgerId,config.sourceClientId,"payment.received",r?.enrollment_id??ledgerId);
        await enqueueEvent(c,PaymentReceivedEvent.parse({id:receivedEventId,type:"payment.received",version:1,occurredAt:new Date().toISOString(),correlationId:r?.enrollment_id??ledgerId,payload:{ledgerId,paymentId:r?.id??null,amount:payload.amount,currency:"VND",adapter:"SYNTHETIC"}}));
        return {ledgerId,matchRef,duplicate:false};
      });res.json({data});
    });
    app.get("/internal/payment/enrollments/:id/enrollment-authority",async(req,res)=>{
      const id=z.uuid().parse(req.params.id),u=await bound(bearer(req.get("authorization")),id,"enrollment"),r=(await pool.query("SELECT * FROM payment_requests WHERE enrollment_id=$1",[id])).rows[0];
      if(!r){res.json({data:{status:"CANCELLED",receivedAmount:0,matchRef:null}});return;}checkBranch(u,r.branch_id);res.json({data:await view(pool,r)});
    });
    for(const kind of ["seat","enrollment"] as const)app.get(`/internal/payment/matches/:id/${kind}-authority`,async(req,res)=>{
      const id=z.uuid().parse(req.params.id),r=(await pool.query("SELECT m.*,p.enrollment_id,p.branch_id,p.expires_at,p.status,p.amount_due FROM payment_matches m JOIN payment_requests p ON p.id=m.payment_id WHERE m.id=$1",[id])).rows[0];
      if(!r)throw new HttpError(404,"NOT_FOUND","Verified payment match not found");const u=await bound(bearer(req.get("authorization")),r.enrollment_id,kind==="seat"?"class-schedule":"enrollment");checkBranch(u,r.branch_id);
      if(u.delegation?.inputRef!==id)throw denied();
      const blocked=(await pool.query("SELECT 1 FROM payment_reviews WHERE payment_id=$1 AND ledger_id=$2 AND (reason='NO_SEAT' OR status='REFUND_PENDING')",[r.payment_id,r.ledger_id])).rowCount;
      res.json({data:{id,enrollmentId:r.enrollment_id,paymentRequestId:r.payment_id,eventId:r.event_id,amountMatched:Number(r.amount),eligible:!blocked&&r.status==="SETTLED"&&Number(r.amount)===Number(r.amount_due),late:r.late||r.expires_at<=new Date()}});
    });
    app.get("/internal/payment/enrollments/:id",async(req,res)=>{
      const id=z.uuid().parse(req.params.id),u=await bound(bearer(req.get("authorization")),id),r=(await pool.query("SELECT * FROM payment_requests WHERE enrollment_id=$1",[id])).rows[0];
      if(r)checkBranch(u,r.branch_id);res.json({data:r?await view(pool,r):null});
    });
    app.post("/internal/payment/enrollments/:id/:action",async(req,res)=>{
      const action=z.enum(["create","close","exception"]).parse(req.params.action),input=(action==="create"?z.object({}).strict():action==="exception"?z.object({reason:z.literal("NO_SEAT")}).strict():z.object({reason:z.enum(["EXPIRE","CANCEL","FAILED"])}).strict()).parse(req.body);
      const id=z.uuid().parse(req.params.id),token=bearer(req.get("authorization"));
      const data=await tx(async c=>{
        const u=await bound(token,id),d=u.delegation!,key=`automation:${d.jobId}:payment.execute:${action}`;
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[id]);
        const old=(await c.query("SELECT *,payload=$2::jsonb AS identical FROM payment_operations WHERE key=$1",[key,input])).rows[0];
        if(old){if(!old.identical)throw conflict("IDEMPOTENCY_MISMATCH");return old.result;}
        let r=(await c.query("SELECT *,clock_timestamp() AS now FROM payment_requests WHERE enrollment_id=$1 FOR UPDATE",[id])).rows[0];
        if(action==="create"){
          if(d.workflowId!=="WF-05"||d.source)throw denied();
          const authority=await api(config.enrollmentUrl,`/internal/enrollment/enrollments/${id}/payment-authority`,token);
          if(authority.branchId!==d.branchId)throw denied();
          if(!r){
            if((await c.query("SELECT 1 FROM payment_closures WHERE enrollment_id=$1",[id])).rowCount)throw conflict("PAYMENT_CLOSED");
            const source=authority;
            if(source.branchId!==d.branchId||source.status!=="HELD"||!source.holdId||new Date(source.expiresAt)<=new Date())throw conflict("HOLD_REQUIRED");
            const seat=await api(config.classUrl,`/internal/classes/enrollments/${id}/payment-authority`,token);
            if(seat.hold?.status!=="HELD"||seat.hold.id!==source.holdId||seat.hold.enrollmentId!==id)throw conflict("HOLD_REQUIRED");
            const amount=z.number().int().positive().max(1_000_000_000).parse(source.snapshot.amountDue);
            r=(await c.query("INSERT INTO payment_requests(id,enrollment_id,branch_id,snapshot,amount_due,reference,expires_at,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[randomUUID(),id,d.branchId,source.snapshot,amount,`DEMO${id.replaceAll("-","")}`,source.expiresAt,key])).rows[0];
          }
        }else if(action==="exception"){
          if(!r||!["WF-06","WF-07"].includes(d.workflowId??"")||d.source!=="service")throw denied();
          const seat=await api(config.classUrl,`/internal/classes/enrollments/${id}/payment-authority`,token);
          if(seat.committed||seat.committable!==false)throw conflict("SEAT_STILL_AVAILABLE");
          const match=(await c.query("SELECT * FROM payment_matches WHERE payment_id=$1",[r.id])).rows[0];
          if(!match)throw conflict("MATCH_REQUIRED");
          await review(c,r,match.ledger_id,"NO_SEAT");
        }else{
          if(!["WF-05","WF-07"].includes(d.workflowId??""))throw denied();
          const reason=z.enum(["EXPIRE","CANCEL","FAILED"]).parse(req.body.reason);
          const source=await api(config.enrollmentUrl,`/internal/enrollment/enrollments/${id}/payment-authority`,token);
          if(source.branchId!==d.branchId || (reason==="CANCEL" && (d.workflowId!=="WF-07"||d.source||!source.cancelRequested)) ||
            (reason==="FAILED" && (d.workflowId!=="WF-05"||d.source)) || (reason==="EXPIRE" && (d.workflowId!=="WF-07"||d.source!=="service")))throw denied();
          if(!r){
            if(reason==="EXPIRE"){
              const seat=await api(config.classUrl,`/internal/classes/enrollments/${id}/payment-authority`,token);
              if(seat.hold?.status==="HELD")throw conflict("DEADLINE_NOT_DUE");
            }
            const deadline=source.expiresAt?new Date(source.expiresAt):new Date(Date.parse(source.createdAt)+21*60_000);
            if(reason==="EXPIRE"&&deadline>new Date())throw conflict("DEADLINE_NOT_DUE");
            await c.query("INSERT INTO payment_closures(enrollment_id,reason,job_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[id,reason,d.jobId]);
            const closure=(await c.query("SELECT reason FROM payment_closures WHERE enrollment_id=$1",[id])).rows[0];
            const result={status:closure.reason==="EXPIRE"?"EXPIRED":"CANCELLED",receivedAmount:0};
            await bound(token,id);await audit(c,id,u.sub,"payment.closed_before_creation",id);
            await c.query("INSERT INTO payment_operations(key,enrollment_id,action,payload,result) VALUES($1,$2,$3,$4,$5)",[key,id,action,input,result]);return result;
          }
          checkBranch(u,r.branch_id);const totals=await money(c,r);
          if(reason==="EXPIRE"&&r.expires_at>r.now&&!totals.receivedAmount)throw conflict("DEADLINE_NOT_DUE");
          if(!totals.matchRef)r=(await c.query("UPDATE payment_requests SET status=$2,version=version+1 WHERE id=$1 RETURNING *",[r.id,totals.receivedAmount>0?"REVIEW":reason==="EXPIRE"?"EXPIRED":"CANCELLED"])).rows[0];
        }
        checkBranch(u,r.branch_id);
        await bound(token,id);
        const result=await view(c,r);
        if(action==="create"&&r.status==="OPEN"&&!(await c.query("SELECT 1 WHERE $1::timestamptz>clock_timestamp()",[r.expires_at])).rowCount)throw conflict("HOLD_EXPIRED");
        await audit(c,r.id,u.sub,`payment.${action}`,id);await c.query("INSERT INTO payment_operations(key,enrollment_id,action,payload,result) VALUES($1,$2,$3,$4,$5)",[key,id,action,input,result]);return result;
      });res.json({data});
    });
    app.post("/internal/payment/review-deadlines",async(req,res)=>{
      z.object({}).strict().parse(req.body);const claims=MachineClaims.parse(await iamRequest(auth.identityUrl,"/internal/iam/machine/introspect",bearer(req.get("authorization")),{audience:"automation-bridge",scope:"automation:authorize"}));if(!claims.workflows.includes("WF-07"))throw denied();
      const ids=await tx(async c=>{const rows=(await c.query("UPDATE payment_reviews SET status='ESCALATED',version=version+1 WHERE status IN ('OPEN','EXTENDED') AND deadline_at<=clock_timestamp() RETURNING *")).rows;for(const r of rows)await audit(c,r.id,config.sourceClientId,"payment.review_escalated",r.payment_id??r.id);return rows.map(r=>r.id);});res.json({data:{ids}});
    });
    app.use("/api/v1",authenticate(auth),allowRoles("center_director","branch_director","admissions","accountant"));
    app.get("/api/v1/payment-requests/:id",async(req,res)=>{const r=(await pool.query("SELECT * FROM payment_requests WHERE id=$1",[z.uuid().parse(req.params.id)])).rows[0],u=principal(res);if(!r)throw new HttpError(404,"NOT_FOUND","Payment request not found");checkBranch(u,r.branch_id);if(u.role==="admissions"&&r.snapshot.actorId!==u.sub)throw denied();res.json({data:await view(pool,r)});});
    app.get("/api/v1/payment-reviews",allowRoles("center_director","branch_director","accountant"),async(_req,res)=>{const u=principal(res),rows=(await pool.query("SELECT id,payment_id AS \"paymentId\",owner_id AS \"ownerId\",reason,status,deadline_at AS \"deadlineAt\",version,extended,decision FROM payment_reviews WHERE ($1 OR branch_id=ANY($2) OR (branch_id IS NULL AND owner_id=$3)) ORDER BY deadline_at LIMIT 100",[u.role==="center_director",u.branchIds,u.sub])).rows;res.json({data:rows});});
    app.get("/api/v1/payment-reviews/:id",allowRoles("center_director","branch_director","accountant"),async(req,res)=>{
      const u=principal(res),r=(await pool.query("SELECT * FROM payment_reviews WHERE id=$1",[z.uuid().parse(req.params.id)])).rows[0];if(!r)throw denied();if(r.branch_id)checkBranch(u,r.branch_id);else if(u.role!=="center_director"&&r.owner_id!==u.sub)throw denied();
      const ledger=(await pool.query("SELECT id,amount,reference,provider,account,transaction_id AS \"transactionId\",received_at AS \"receivedAt\" FROM payment_ledger WHERE id=$1",[r.ledger_id])).rows[0];
      const decisions=(await pool.query("SELECT version,payload,proposed_by AS \"proposedBy\",approved_by AS \"approvedBy\",created_at AS \"createdAt\" FROM payment_review_decisions WHERE review_id=$1 ORDER BY version",[r.id])).rows;
      const proposals=(await pool.query("SELECT version,payload,actor_id AS \"actorId\",created_at AS \"createdAt\" FROM payment_review_proposals WHERE review_id=$1 ORDER BY version",[r.id])).rows;
      res.json({data:{id:r.id,status:r.status,reason:r.reason,ownerId:r.owner_id,deadlineAt:r.deadline_at,version:r.version,ledger,decisions,proposals}});
    });
    app.post("/api/v1/payment-reviews/:id/decision",allowRoles("accountant"),async(req,res)=>{
      const input=PaymentReviewDecision.parse(req.body),u=principal(res),id=z.uuid().parse(req.params.id);
      await tx(async c=>{const r=(await c.query("SELECT * FROM payment_reviews WHERE id=$1 FOR UPDATE",[id])).rows[0];if(!r)throw denied();if(r.branch_id)checkBranch(u,r.branch_id);else if(r.owner_id!==u.sub)throw denied();
        if(r.version!==input.version||r.status==="REFUND_PENDING"||(input.decision==="EXTEND"&&r.extended))throw conflict("STALE_REVIEW_DECISION");
        await iamRequest(auth.identityUrl,"/api/v1/auth/introspect",bearer(req.get("authorization")),{});
        await c.query("INSERT INTO payment_review_proposals(id,review_id,version,payload,actor_id,session_id) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),id,r.version,input,u.sub,u.sid]);
        await c.query("UPDATE payment_reviews SET proposed_by=$2,proposed_session=$3,decision=$4,version=version+1 WHERE id=$1",[id,u.sub,u.sid,input]);await audit(c,id,u.sub,"review.proposed",r.payment_id??id);
      });res.json({data:{id,status:"PENDING_APPROVAL"}});
    });
    app.post("/api/v1/payment-reviews/:id/approve",allowRoles("center_director","branch_director"),async(req,res)=>{
      const input=z.object({version:z.number().int().positive()}).strict().parse(req.body),u=principal(res),id=z.uuid().parse(req.params.id),token=bearer(req.get("authorization"));
      await tx(async c=>{const r=(await c.query("SELECT * FROM payment_reviews WHERE id=$1 FOR UPDATE",[id])).rows[0];if(!r||!r.decision||r.proposed_by===u.sub)throw denied();if(r.branch_id)checkBranch(u,r.branch_id);if(r.version!==input.version||r.approved_by)throw conflict("STALE_REVIEW_DECISION");
        await iamRequest(auth.identityUrl,"/internal/iam/financial-proposal-session",token,{accountId:r.proposed_by,sessionId:r.proposed_session,branchId:r.branch_id});
        const decision=r.decision.decision;if(decision==="EXTEND"&&r.extended)throw conflict("REVIEW_ALREADY_EXTENDED");
        await c.query("INSERT INTO payment_review_decisions(id,review_id,version,payload,proposed_by,approved_by) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),id,r.version,r.decision,r.proposed_by,u.sub]);
        await c.query("UPDATE payment_reviews SET approved_by=NULL,approved_session=NULL,proposed_by=NULL,proposed_session=NULL,decision=NULL,status=$2,extended=extended OR $3,deadline_at=CASE WHEN $3 THEN clock_timestamp()+interval '24 hours' ELSE deadline_at END,version=version+1 WHERE id=$1",[id,decision==="EXTEND"?"EXTENDED":"REFUND_PENDING",decision==="EXTEND"]);
        if(r.payment_id){const p=(await c.query("SELECT * FROM payment_requests WHERE id=$1",[r.payment_id])).rows[0];await emit(c,p,"payment.review_decided",id,"WF-07");}
        await iamRequest(auth.identityUrl,"/api/v1/auth/introspect",token,{});await audit(c,id,u.sub,"review.approved",r.payment_id??id);
      });res.json({data:{id}});
    });
  });
}
