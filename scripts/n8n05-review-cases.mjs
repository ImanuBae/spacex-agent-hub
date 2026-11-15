import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";

export async function runN8n05ReviewCases(t){
  const {h,test,api,request,offer,customer,preview,confirm,claim,authorize,step,finish,purchase,webhook,staff,director,accountant,worker}=t;
  const db=h.pools,classes=db["class-schedule"];
  const en=(id,a)=>`/internal/enrollment/enrollments/${id}/${a}`,pm=(id,a)=>`/internal/payment/enrollments/${id}/${a}`,seat=(id,a)=>`/internal/classes/enrollments/${id}/${a}`;
  async function selection(){const o=await offer(),c=await customer();return{...c,classId:o.classId,packageId:o.packageId};}
  async function heldBeforeQr(){const selected=await selection(),p=await preview(selected),s=await confirm(p),ctx=await claim("WF-05"),id=s.enrollment_id;assert.equal(ctx.job.entity.id,id);await step(ctx,"enrollment.execute","enrollment",en(id,"create"));await step(ctx,"classes.enroll","class-schedule",seat(id,"hold"));await step(ctx,"enrollment.execute","enrollment",en(id,"held"));return{id,ctx,selected};}
  async function cancellation(p){const row=await api("enrollment",`/api/v1/enrollments/${p.id}`,"GET",undefined,staff.accessToken);await api("enrollment",`/api/v1/enrollments/${p.id}/cancel`,"POST",{version:row.version,reason:"DEMO explicitly verified customer cancellation"},staff.accessToken,202,randomUUID());const ctx=await claim("WF-07");assert.equal(ctx.job.entity.id,p.id);return ctx;}
  async function cancelAfterClose(p,ctx){const row=(await step(ctx,"enrollment.execute","enrollment",en(p.id,"cancel"))).data;if(row.releaseAuthorized)await step(ctx,"classes.enroll","class-schedule",seat(p.id,"release"));await finish(ctx);return row;}
  async function reconcile(p){const ctx=await claim("WF-07");assert.equal(ctx.job.entity.id,p.id);await step(ctx,"payment.execute","payment",pm(p.id,"close"),{reason:"EXPIRE"});const row=(await step(ctx,"enrollment.execute","enrollment",en(p.id,"reconcile"))).data;if(row.releaseAuthorized&&row.status!=="CONFIRMED")await step(ctx,"classes.enroll","class-schedule",seat(p.id,"release"));await finish(ctx);return{jobId:ctx.job.jobId,row};}
  async function settle(p,m){const ctx=await claim("WF-06");assert.equal(ctx.job.entity.id,p.id);await step(ctx,"enrollment.execute","enrollment",en(p.id,"confirming"));await step(ctx,"classes.enroll","class-schedule",seat(p.id,"commit"),{matchRef:m.data.matchRef});await step(ctx,"enrollment.execute","enrollment",en(p.id,"confirm"));await finish(ctx);}
  async function refundExcess(p){const r=(await db.payment.query("SELECT * FROM payment_reviews WHERE payment_id=$1 AND reason='MULTIPLE_TRANSACTIONS' ORDER BY deadline_at DESC LIMIT 1",[p.payment.id])).rows[0];assert(r);await api("payment",`/api/v1/payment-reviews/${r.id}/decision`,"POST",{version:r.version,decision:"REFUND_PENDING",reason:"DEMO refund only the additional transfer, preserve tuition"},accountant.accessToken);await api("payment",`/api/v1/payment-reviews/${r.id}/approve`,"POST",{version:r.version+1},director.accessToken);return r;}
  for(const first of ["CLOSE","CREATE"])await test(`REVIEW-QR-CANCEL-RACE-${first}`,"Real concurrent Payment close/create serialize under one resource lock; a completed cancellation has no active QR or held seat",async()=>{
    const p=await heldBeforeQr(),cancel=await cancellation(p),createToken=await authorize(p.ctx,"payment.execute"),closeToken=await authorize(cancel,"payment.execute");
    const blocker=await db.payment.connect();let creating,closing;
    try{
      await blocker.query("BEGIN");await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[p.id]);
      const waiters=async n=>h.eventually(async()=>Number((await db.payment.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'")).rows[0].n)>=n,"Payment resource lock contenders");
      if(first==="CLOSE"){closing=request("payment",pm(p.id,"close"),"POST",{reason:"CANCEL"},closeToken);await waiters(1);creating=request("payment",pm(p.id,"create"),"POST",{},createToken,409);}
      else{creating=request("payment",pm(p.id,"create"),"POST",{},createToken);await waiters(1);closing=request("payment",pm(p.id,"close"),"POST",{reason:"CANCEL"},closeToken);}
      await waiters(2);await blocker.query("COMMIT");
    }finally{await blocker.query("ROLLBACK");blocker.release();}
    const results=await Promise.all([creating,closing]);const cancelled=await cancelAfterClose(p,cancel);assert.equal(cancelled.status,"CANCELLED");
    await step(p.ctx,"enrollment.execute","enrollment",en(p.id,"payment"),{},409);await finish(p.ctx);
    const payment=(await db.payment.query("SELECT status FROM payment_requests WHERE enrollment_id=$1",[p.id])).rows;
    assert.equal(payment.filter(r=>r.status==="OPEN").length,0);assert.equal(payment.length,first==="CLOSE"?0:1);
    if(first==="CLOSE")assert.equal((await db.payment.query("SELECT count(*)::int AS n FROM payment_closures WHERE enrollment_id=$1",[p.id])).rows[0].n,1);
    assert.equal((await classes.query("SELECT count(*)::int AS n FROM holds WHERE enrollment_id=$1 AND status IN ('HELD','COMMITTED')",[p.id])).rows[0].n,0);
    return{enrollmentId:p.id,first,createStatus:results[0].status,closeStatus:results[1].status,cancellationJob:cancel.job.jobId,paymentStates:payment};
  });
  await test("REVIEW-SERVICE-CANNOT-INVENT-CUSTOMER-CANCEL","A valid underpaid service review job cannot claim customer cancellation or release a live hold",async()=>{
    const p=await purchase(await selection());await webhook(p.payment,{amount:50000});const ctx=await claim("WF-07");assert.equal(ctx.job.entity.id,p.id);
    await step(ctx,"payment.execute","payment",pm(p.id,"close"),{reason:"CANCEL"},403);await step(ctx,"enrollment.execute","enrollment",en(p.id,"cancel"),{},403);
    await step(ctx,"payment.execute","payment",pm(p.id,"close"),{reason:"EXPIRE"});const row=(await step(ctx,"enrollment.execute","enrollment",en(p.id,"reconcile"))).data;assert.equal(row.releaseAuthorized,false);
    await step(ctx,"classes.enroll","class-schedule",seat(p.id,"release"),{},409);await finish(ctx);
    const before=(await classes.query("SELECT status FROM holds WHERE enrollment_id=$1",[p.id])).rows[0];assert.equal(before.status,"HELD");
    const c=await cancellation(p);await step(c,"payment.execute","payment",pm(p.id,"close"),{reason:"CANCEL"});await cancelAfterClose(p,c);
    return{enrollmentId:p.id,serviceJob:ctx.job.jobId,forgedCancelRejected:2,earlyReleaseRejected:true,ledgerAmount:50000};
  });
  for(const timing of ["BEFORE_CONFIRM","AFTER_CONFIRM"])await test(`REVIEW-EXCESS-REFUND-${timing}`,"Independent refund of an additional ledger entry preserves original tuition allocation and exactly one committed entitlement",async()=>{
    const p=await purchase(await selection()),matched=await webhook(p.payment);if(timing==="AFTER_CONFIRM")await settle(p,matched);
    const extra=await webhook(p.payment),review=await refundExcess(p);const reviews=[await reconcile(p),await reconcile(p)];
    if(timing==="BEFORE_CONFIRM")await settle(p,matched);
    const row=(await db.enrollment.query("SELECT status,release_authorized FROM enrollments WHERE id=$1",[p.id])).rows[0];assert.equal(row.status,"CONFIRMED");assert.equal(row.release_authorized,false);
    const ledger=(await db.payment.query("SELECT count(*)::int AS n,sum(amount)::int AS total FROM payment_ledger WHERE payment_id=$1",[p.payment.id])).rows[0];assert.deepEqual(ledger,{n:2,total:200000});
    assert.equal((await db.payment.query("SELECT count(*)::int AS n FROM payment_allocations WHERE payment_id=$1",[p.payment.id])).rows[0].n,1);assert.notEqual(review.ledger_id,matched.data.ledgerId);assert.equal(review.ledger_id,extra.data.ledgerId);
    assert.equal((await classes.query("SELECT count(*)::int AS n FROM holds WHERE enrollment_id=$1 AND status='COMMITTED'",[p.id])).rows[0].n,1);
    return{enrollmentId:p.id,tuitionLedger:matched.data.ledgerId,extraLedger:extra.data.ledgerId,reviewId:review.id,refundExecuted:false,reviews,ledger};
  });
  await test("REVIEW-LATE-CONFIRM-CLEARS-RELEASE","A cached expiry operation cannot revoke a later paid commitment; fresh Enrollment state clears release permission",async()=>{
    const p=await purchase(await selection()),deadline=new Date(Date.now()-2000).toISOString();await classes.query("UPDATE holds SET expires_at=$2 WHERE enrollment_id=$1",[p.id,deadline]);await db.enrollment.query("UPDATE enrollments SET expires_at=$2 WHERE id=$1",[p.id,deadline]);await db.payment.query("UPDATE payment_requests SET expires_at=$2 WHERE enrollment_id=$1",[p.id,deadline]);
    const token=(await h.iamCall("/internal/iam/machine/token",{clientId:worker.id,clientSecret:worker.clientSecret,audience:"automation-bridge",scopes:["automation:authorize"],workflows:["WF-07"],ttlSeconds:60})).accessToken;await api("enrollment","/internal/enrollment/deadlines","POST",{},token);
    const expiring=await claim("WF-07");assert.equal(expiring.job.entity.id,p.id);await step(expiring,"payment.execute","payment",pm(p.id,"close"),{reason:"EXPIRE"});const old=(await step(expiring,"enrollment.execute","enrollment",en(p.id,"reconcile"))).data;assert.equal(old.releaseAuthorized,true);
    const paid=await webhook(p.payment);await settle(p,paid);
    const cached=(await step(expiring,"enrollment.execute","enrollment",en(p.id,"reconcile"))).data;assert.equal(cached.releaseAuthorized,true);
    const classToken=await authorize(expiring,"classes.enroll"),current=await api("class-schedule",`/internal/classes/enrollments/${p.id}`,"GET",undefined,classToken);assert.equal(current.committed,true);await finish(expiring);
    const row=(await db.enrollment.query("SELECT status,release_authorized FROM enrollments WHERE id=$1",[p.id])).rows[0];assert.deepEqual(row,{status:"CONFIRMED",release_authorized:false});
    await webhook(p.payment);const reviewed=await reconcile(p);assert.equal(reviewed.row.status,"CONFIRMED");assert.equal(reviewed.row.releaseAuthorized,false);
    return{enrollmentId:p.id,cachedExpiryJob:expiring.job.jobId,cachedPermission:true,currentCommitment:true,currentPermission:false,reviewJob:reviewed.jobId};
  });
  await test("REVIEW-LEGACY-SEAT-ENDPOINTS-CANNOT-BYPASS-PAYMENT","Real Enrollment holds cannot be cancelled directly or bypassed through Class cancellation",async()=>{
    const p=await purchase(await selection()),r=await api("enrollment",`/api/v1/enrollments/${p.id}`,"GET",undefined,staff.accessToken),cls=await api("class-schedule",`/api/v1/classes/${r.snapshot.classId}`,"GET",undefined,director.accessToken);
    await request("class-schedule",`/api/v1/holds/${r.holdId}/cancel`,"POST",{},staff.accessToken,409);
    await request("class-schedule",`/api/v1/classes/${cls.id}/status`,"POST",{version:cls.version,status:"CANCELLED",reason:"DEMO class cancellation requires enrollment reconciliation"},director.accessToken,409);
    assert.equal((await classes.query("SELECT status FROM holds WHERE enrollment_id=$1",[p.id])).rows[0].status,"HELD");
    const c=await cancellation(p);await step(c,"payment.execute","payment",pm(p.id,"close"),{reason:"CANCEL"});await cancelAfterClose(p,c);return{enrollmentId:p.id,legacyCancellationRejected:true,classCancellationRejected:true};
  });
  await test("REVIEW-ORPHAN-HOLD-USES-CLASS-DEADLINE","An old PENDING_HOLD checkpoint cannot expire a newer live Class hold; system recovery first reads Class server truth",async()=>{
    const selected=await selection(),p=await preview(selected),s=await confirm(p),ctx=await claim("WF-05"),id=s.enrollment_id;
    await step(ctx,"enrollment.execute","enrollment",en(id,"create"));const hold=(await step(ctx,"classes.enroll","class-schedule",seat(id,"hold"))).data;
    await db.enrollment.query("UPDATE enrollments SET created_at=clock_timestamp()-interval '22 minutes' WHERE id=$1",[id]);
    const token=(await h.iamCall("/internal/iam/machine/token",{clientId:worker.id,clientSecret:worker.clientSecret,audience:"automation-bridge",scopes:["automation:authorize"],workflows:["WF-07"],ttlSeconds:60})).accessToken;
    await request("class-schedule","/internal/classes/deadlines","POST",{enrollmentIds:[id]},token,401);
    assert.equal((await api("enrollment","/internal/enrollment/deadlines","POST",{},token)).count,0);
    const observed=(await db.enrollment.query("SELECT status,hold_id,expires_at FROM enrollments WHERE id=$1",[id])).rows[0];assert.equal(observed.status,"PENDING_HOLD");assert.equal(observed.hold_id,hold.id);assert.equal(observed.expires_at.toISOString(),hold.expiresAt);
    const deadline=new Date(Date.now()-2000).toISOString();await classes.query("UPDATE holds SET expires_at=$2 WHERE enrollment_id=$1",[id,deadline]);await db.enrollment.query("UPDATE enrollments SET expires_at=$2 WHERE id=$1",[id,deadline]);
    assert.equal((await api("enrollment","/internal/enrollment/deadlines","POST",{},token)).count,1);
    const e=await claim("WF-07");assert.equal(e.job.entity.id,id);await step(e,"payment.execute","payment",pm(id,"close"),{reason:"EXPIRE"});const expired=(await step(e,"enrollment.execute","enrollment",en(id,"reconcile"))).data;assert.equal(expired.status,"EXPIRED");await step(e,"classes.enroll","class-schedule",seat(id,"release"));await finish(e);
    await step(ctx,"payment.execute","payment",pm(id,"create"),{},409);await finish(ctx);
    assert.equal((await db.payment.query("SELECT count(*)::int AS n FROM payment_requests WHERE enrollment_id=$1",[id])).rows[0].n,0);
    return{enrollmentId:id,holdId:hold.id,liveDeadlineObserved:hold.expiresAt,expiredJob:e.job.jobId,qr:0};
  });
}
