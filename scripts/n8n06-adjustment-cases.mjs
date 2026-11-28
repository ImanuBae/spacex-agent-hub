import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";

const base = "/api/v1";

export async function runN8n06AdjustmentCases(t) {
  const { h, test, api, request, offer, webhook, staff, director, accountant, outsider, waitDone, confirmed, adjustment, startPayment } = t;
  const entitlement = p => api("enrollment", `${base}/student/enrollments/${p.id}`, "GET", undefined, p.student.accessToken);
  const adjustmentRow = id => api("enrollment", `${base}/adjustments/${id}`, "GET", undefined, staff.accessToken);
  const seats = async (source, target) => (await h.pools["class-schedule"].query("SELECT id,class_id AS \"classId\",status,enrollment_id AS \"enrollmentId\" FROM holds WHERE enrollment_id=ANY($1::uuid[]) ORDER BY enrollment_id", [[source, target]])).rows;
  const refund = id => api("payment", `${base}/refunds/${id}`, "GET", undefined, accountant.accessToken);
  const execute = (id, version) => api("payment", `${base}/refunds/${id}/execute`, "POST", { version }, accountant.accessToken);
  const movements = async id => (await h.pools.payment.query("SELECT id,direction,amount::int,adapter FROM synthetic_payment_executions WHERE adjustment_id=$1 ORDER BY direction", [id])).rows;
  async function restartPayment(fault) {
    const child = h.services.get("payment"), exited = once(child, "exit");
    assert(child.kill("SIGTERM"));
    await exited;
    await startPayment(fault);
  }
  async function replayJob(trace) {
    const { rows:[job] } = await h.pool.query("SELECT version FROM automation_jobs WHERE id=$1",[trace.jobId]);
    await api("automation-bridge",`${base}/automation/jobs/${trace.jobId}/replay`,"POST",{expectedVersion:job.version,reason:"DEMO recover from uncertain synthetic outcome"});
  }
  const acceptedInvite = async (person, target) => {
    const list = await api("enrollment", `${base}/waitlist`, "POST", { enrollmentId: person.id, classId: target.classId, packageId: target.packageId, consent: true }, staff.accessToken, 201);
    const invited = await api("enrollment", `${base}/waitlist/${list.id}/invite`, "POST", { version: list.version }, director.accessToken);
    return invited;
  };

  await test("WF09-REFUND-OVER-CAP-CONCURRENT", "An existing active reservation serializes competing proposals and rejects a refund above the received amount without releasing tuition", async () => {
    const person = await confirmed(), prior = await entitlement(person), input = { enrollmentId: person.id, type: "REFUND", version: prior.currentEntitlement.version, reason: "DEMO refund amount exceeds allocated funds", amount: 100_001, refundMode: "CANCEL" };
    const key = randomUUID();
    const competing = await Promise.all([request("enrollment", `${base}/adjustments`, "POST", input, accountant.accessToken, null, key), request("enrollment", `${base}/adjustments`, "POST", { ...input, amount: 99_999 }, accountant.accessToken, null, randomUUID())]);
    const winner = competing.find(r => r.status === 201);
    assert(winner); assert.deepEqual(competing.map(r => r.status).sort(), [201, 409]);
    // Keep the over-cap proof independent of which competing proposal reached the lock first.
    const original = winner.data;
    await api("enrollment", `${base}/adjustments/${original.id}/revoke`, "POST", { version: original.version }, accountant.accessToken);
    const r = await adjustment(person, { type: "REFUND", amount: 100_001, refundMode: "CANCEL", actor: accountant });
    const proof = await waitDone("WF-09", r.id);
    const refund = await api("payment", `${base}/refunds/${r.id}`, "GET", undefined, accountant.accessToken);
    const current = await entitlement(person), hold = await seats(person.id, r.targetSeatId);
    assert.equal(refund.status, "FAILED"); assert.equal(refund.errorCode, "REFUND_CAP_EXCEEDED");
    assert.equal((await adjustmentRow(r.id)).status, "FAILED"); assert.equal(current.currentEntitlement.state, "ACTIVE");
    assert.deepEqual(hold.map(x => x.status), ["COMMITTED"]);
    const count = (await h.pools.payment.query("SELECT count(*)::int AS n FROM synthetic_payment_executions WHERE adjustment_id=$1", [r.id])).rows[0].n;
    assert.equal(count, 0);
    return { ...proof, adjustmentId: r.id, refundState: refund.status, refundErrorCode: refund.errorCode, receiptCount: count, concurrentStatuses: competing.map(x => x.status), oldSeat: hold[0].id };
  });

  await test("WF09-EXCESS-REFUND-KEEPS-TUITION", "The synthetic adapter refunds part of a reviewed excess after independent authorization, without modifying the tuition ledger, match or seat", async () => {
    const person = await confirmed();
    const extra = await webhook(person.payment, { amount: 30_000 });
    const review = (await api("payment", `${base}/payment-reviews`, "GET", undefined, accountant.accessToken)).find(r => r.paymentId === person.payment.id);
    assert(review, "The extra receipt requires its own accounting review");
    await api("payment", `${base}/payment-reviews/${review.id}/decision`, "POST", { version: review.version, decision: "REFUND_PENDING", reason: "DEMO verified excess transaction" }, accountant.accessToken);
    const proposal = await api("payment", `${base}/payment-reviews/${review.id}`, "GET", undefined, director.accessToken);
    await api("payment", `${base}/payment-reviews/${review.id}/approve`, "POST", { version: proposal.version }, director.accessToken);
    const r = await adjustment(person, { type: "REFUND", amount: 12_000, refundMode: "EXCESS" });
    const waiting = await waitDone("WF-09", r.id, "WAITING");
    const pending = await api("payment", `${base}/refunds/${r.id}`, "GET", undefined, accountant.accessToken);
    assert.equal(pending.status, "RESERVED");
    assert.equal(pending.receiptRef, null);
    const financeRefund = async () => (await api("payment", `${base}/payment-transactions?id=${r.id}`, "GET", undefined, accountant.accessToken))[0];
    const pendingTransaction = await financeRefund();
    assert.equal(pendingTransaction.status, "REFUND_PENDING");
    assert.equal(pendingTransaction.receiptRef, null);
    const reviewDetail = () => api("payment", `${base}/payment-reviews/${review.id}`, "GET", undefined, director.accessToken);
    assert.deepEqual((await reviewDetail()).refunds.map(x => [x.id, x.status, x.receiptRef]), [[r.id, "RESERVED", null]]);
    const execution = await Promise.all([request("payment", `${base}/refunds/${r.id}/execute`, "POST", { version: pending.version }, accountant.accessToken, null), request("payment", `${base}/refunds/${r.id}/execute`, "POST", { version: pending.version }, accountant.accessToken, null)]);
    assert.deepEqual(execution.map(x => x.status).sort(), [200, 409]);
    const done = await waitDone("WF-09", r.id);
    const posted = (await h.pools.payment.query("SELECT id,direction,amount::int,adapter FROM synthetic_payment_executions WHERE adjustment_id=$1", [r.id])).rows;
    assert.deepEqual(posted.map(({ direction, amount, adapter }) => ({ direction, amount, adapter })), [{ direction: "REFUND", amount: 12_000, adapter: "SYNTHETIC" }]);
    const detail = await reviewDetail();
    assert.equal(detail.status, "REFUND_PENDING");
    assert.deepEqual(detail.refunds.map(x => [x.id, x.status, x.receiptRef]), [[r.id, "EXECUTED", posted[0].id]]);
    const refundedTransaction = await financeRefund();
    assert.equal(refundedTransaction.status, "REFUNDED");
    assert.equal(refundedTransaction.receiptRef, posted[0].id);
    assert.equal(refundedTransaction.amount, 12_000);
    const ledger = (await h.pools.payment.query("SELECT count(*)::int AS entries,sum(amount)::int AS received FROM payment_ledger WHERE payment_id=$1", [person.payment.id])).rows[0];
    assert.deepEqual(ledger, { entries: 2, received: 130_000 });
    const tuition = await entitlement(person);
    assert.equal(tuition.currentEntitlement.state, "ACTIVE");
    assert.deepEqual((await seats(person.id, r.targetSeatId)).map(x => x.status), ["COMMITTED"]);
    return { waiting, done, adjustmentId: r.id, reviewedLedgerId: extra.data.ledgerId, ledger, refundReceiptId: posted[0].id, financeStatuses: [pendingTransaction.status, refundedTransaction.status], executionStatuses: execution.map(x => x.status) };
  });

  await test("WF09-SUSPEND-RESUME", "Suspension preserves the unused rights and releases the old seat. Resumption obtains and commits a distinct new seat", async () => {
    const person = await confirmed();
    const suspend = await adjustment(person, { type: "SUSPEND" });
    const suspendedTrace = await waitDone("WF-09", suspend.id);
    const suspended = (await entitlement(person)).currentEntitlement;
    assert.equal(suspended.state, "SUSPENDED"); assert(suspended.remainingSessions > 0);
    assert(new Date(suspended.expiresAt) > new Date());
    assert.deepEqual((await seats(person.id, suspend.targetSeatId)).map(r => r.status), ["CANCELLED"]);
    const target = await offer();
    const resume = await adjustment(person, { type: "RESUME", target });
    const resumedTrace = await waitDone("WF-09", resume.id);
    const resumed = (await entitlement(person)).currentEntitlement;
    assert.equal(resumed.state, "ACTIVE"); assert.equal(resumed.classId, target.classId); assert.equal(resumed.seatId, resume.targetSeatId);
    assert.equal(resumed.remainingSessions, suspended.remainingSessions); assert.equal(resumed.expiresAt, null);
    assert.deepEqual((await seats(person.id, resume.targetSeatId)).map(r => r.status).sort(), ["CANCELLED", "COMMITTED"]);
    return { suspendedTrace, resumedTrace, enrollmentId: person.id, remainingSessions: resumed.remainingSessions, targetSeatId: resumed.seatId };
  });

  await test("WF09-WAITLIST-LAST-SEAT", "Two learners accepting separate invitations contend at Class. Exactly one target seat commits and the other learner keeps their prior seat", async () => {
    const first = await confirmed(), second = await confirmed(), target = await offer({ capacity: 1 });
    const a = await acceptedInvite(first, target);
    const duplicate = await api("enrollment", `${base}/waitlist`, "POST", { enrollmentId: first.id, classId: target.classId, packageId: target.packageId, consent: true }, staff.accessToken, 201);
    assert.equal(duplicate.id, a.id);
    const b = await acceptedInvite(second, target);
    await request("enrollment", `${base}/waitlist/${a.id}/accept`, "POST", { version: a.version }, second.student.accessToken, 403);
    await request("enrollment", `${base}/waitlist/${a.id}/revoke`, "POST", { version: a.version }, outsider.accessToken, 403);
    const invites = await Promise.all([[a, first], [b, second]].map(([invitation, person]) => api("enrollment", `${base}/waitlist/${invitation.id}/accept`, "POST", { version: invitation.version }, person.student.accessToken)));
    assert(invites.every(x => x.status === "ACCEPTED"));
    const traces = [];
    for (const invitation of invites) traces.push(await waitDone("WF-09", invitation.adjustmentId));
    const results = await Promise.all(invites.map(i => adjustmentRow(i.adjustmentId)));
    assert.deepEqual(results.map(x => x.status).sort(), ["EXECUTED", "FAILED"]);
    assert.equal((await h.pools["class-schedule"].query("SELECT count(*)::int AS n FROM holds WHERE class_id=$1 AND status='COMMITTED'", [target.classId])).rows[0].n, 1);
    const losing = results.find(x => x.status === "FAILED"), loser = losing.enrollmentId === first.id ? first : second;
    assert.equal((await entitlement(loser)).currentEntitlement.classId, loser.selection.classId);
    assert.deepEqual((await seats(loser.id, losing.targetSeatId)).map(x => x.status), ["COMMITTED"]);
    return { traces, invitationIds: invites.map(x => x.id), results: results.map(x => ({ id: x.id, status: x.status })), committedTargetSeats: 1 };
  });

  await test("WF09-WAITLIST-DECLINE-REVOKE", "Declined or revoked invitations cannot be accepted and never create target hold rows", async () => {
    const person = await confirmed(), target = await offer();
    const rejected = [];
    for (const action of ["decline", "revoke"]) {
      const invitation = await acceptedInvite(person, target);
      const stopped = await api("enrollment", `${base}/waitlist/${invitation.id}/${action}`, "POST", { version: invitation.version }, action === "decline" ? person.student.accessToken : director.accessToken);
      const attempted = await request("enrollment", `${base}/waitlist/${invitation.id}/accept`, "POST", { version: stopped.version }, person.student.accessToken, 409);
      const a = await adjustmentRow(invitation.adjustmentId);
      assert.equal(a.status, "REVOKED"); assert.equal(attempted.body.error.code, "INVITATION_UNAVAILABLE");
      assert.deepEqual((await seats(person.id, a.targetSeatId)).map(x => x.status), ["COMMITTED"]);
      rejected.push({ invitationId: invitation.id, adjustmentId: a.id, invitationStatus: stopped.status, attemptedStatus: attempted.status });
    }
    return { rejected };
  });

  await test("WF09-WAITLIST-FIFO-CONSENT", "Withdrawn consent blocks invitation, queued revocation releases FIFO priority, and invitation alone creates no hold", async () => {
    const first = await confirmed(), second = await confirmed(), target = await offer({capacity:1});
    const join = person => api("enrollment",`${base}/waitlist`,"POST",{enrollmentId:person.id,classId:target.classId,packageId:target.packageId,consent:true},staff.accessToken,201);
    const a = await join(first), b = await join(second);
    await api("crm",`${base}/crm/people/${first.selection.learnerId}/consents`,"POST",{purpose:"COURSE_NOTICES",status:"REVOKED",statementVersion:"DEMO-v1",statementText:"DEMO consent withdrawn",method:"WRITTEN"},staff.accessToken,201,randomUUID());
    const invite = entry => request("enrollment",`${base}/waitlist/${entry.id}/invite`,"POST",{version:entry.version},director.accessToken,null);
    assert.equal((await invite(a)).body.error.code,"CONSENT_REQUIRED");
    assert.equal((await invite(b)).body.error.code,"WAITLIST_PRIORITY");
    await request("enrollment",`${base}/waitlist/${a.id}/revoke`,"POST",{version:a.version},outsider.accessToken,403);
    const revoked = await api("enrollment",`${base}/waitlist/${a.id}/revoke`,"POST",{version:a.version},director.accessToken);
    assert.equal(revoked.status,"REVOKED"); assert.equal(revoked.adjustmentId,null);
    const invitation = await invite(b);
    assert.equal(invitation.status,200); assert.equal(invitation.data.status,"INVITED");
    const count = (await h.pools["class-schedule"].query("SELECT count(*)::int AS n FROM holds WHERE class_id=$1",[target.classId])).rows[0].n;
    assert.equal(count,0);
    return { revoked:a.id,invited:b.id,adjustmentId:invitation.data.adjustmentId,targetHolds:count };
  });

  await test("WF09-INVITATION-AND-SUSPENSION-EXPIRY", "Past-deadline invitation and suspension fixtures cannot acquire a target seat, including before a deadline poll", async () => {
    const person = await confirmed(), target = await offer(), invitation = await acceptedInvite(person, target);
    // The isolated database fixture represents a server deadline already reached; Class and Enrollment APIs still decide eligibility.
    await h.pools.enrollment.query("UPDATE enrollment_waitlist SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [invitation.id]);
    await h.pools.enrollment.query("UPDATE enrollment_adjustments SET deadline_at=clock_timestamp()-interval '1 second' WHERE id=$1", [invitation.adjustmentId]);
    const invalid = await request("enrollment", `${base}/waitlist/${invitation.id}/accept`, "POST", { version: invitation.version }, person.student.accessToken, 409);
    assert.equal(invalid.body.error.code, "INVITATION_UNAVAILABLE");
    await h.eventually(async () => (await adjustmentRow(invitation.adjustmentId)).status === "EXPIRED", "expired invitation adjustment persisted by WF09 deadline poll");
    const abandoned = await adjustmentRow(invitation.adjustmentId);
    assert.deepEqual((await seats(person.id, abandoned.targetSeatId)).map(x => x.status), ["COMMITTED"]);
    const suspend = await adjustment(person, { type: "SUSPEND" });
    const trace = await waitDone("WF-09", suspend.id);
    await h.pools.enrollment.query("UPDATE enrollment_entitlements SET expires_at=clock_timestamp()-interval '1 second' WHERE enrollment_id=$1", [person.id]);
    const current = await entitlement(person);
    assert.equal(current.currentEntitlement.state, "EXPIRED");
    const denied = await request("enrollment", `${base}/adjustments`, "POST", { enrollmentId: person.id, type: "RESUME", version: current.currentEntitlement.version, reason: "DEMO attempt to resume after server expiry", targetClassId: target.classId, packageId: target.packageId }, staff.accessToken, 409, randomUUID());
    assert(["INVALID_ENTITLEMENT", "STALE_ENTITLEMENT"].includes(denied.body.error.code));
    const targetHolds = (await h.pools["class-schedule"].query("SELECT count(*)::int AS n FROM holds WHERE class_id=$1", [target.classId])).rows[0].n;
    assert.equal(targetHolds, 0);
    return { trace, invitationId: invitation.id, inviteExpiryUpdate: abandoned.status, suspendedEntitlement: current.currentEntitlement.state, resumeErrorCode: denied.body.error.code, targetHolds };
  });

  await test("WF09-TRANSFER-DELTA", "Transfer collects an authorized positive difference before committing and refunds a reserved negative difference without changing registration price", async () => {
    const results = [];
    for (const [priceVnd, direction] of [[125_000, "CHARGE"], [80_000, "REFUND"]]) {
      const person = await confirmed(), target = await offer({ priceVnd }), r = await adjustment(person, { target });
      const waiting = await waitDone("WF-09", r.id, "WAITING"), pending = await refund(r.id);
      assert.equal(pending.delta, priceVnd - 100_000);
      assert.equal(pending.status, direction === "CHARGE" ? "WAITING" : "RESERVED");
      assert.deepEqual(await movements(r.id), []);
      const before = await seats(person.id, r.targetSeatId);
      assert.equal(before.find(s=>s.enrollmentId===person.id)?.status, direction==="CHARGE"?"COMMITTED":"CANCELLED");
      assert.equal(before.find(s=>s.enrollmentId===r.targetSeatId)?.status, direction==="CHARGE"?"HELD":"COMMITTED");
      await execute(r.id,pending.version);
      const done = await waitDone("WF-09",r.id), current = await entitlement(person);
      const actual = await movements(r.id);
      assert.equal(actual.length,1);
      assert.deepEqual({ direction:actual[0].direction,amount:actual[0].amount,adapter:actual[0].adapter },{ direction,amount:Math.abs(pending.delta),adapter:"SYNTHETIC" });
      assert.equal(current.currentEntitlement.classId,target.classId);
      assert.equal(current.currentEntitlement.amount,priceVnd);
      assert.equal(current.snapshot.amountDue,100_000);
      assert.equal((await seats(person.id,r.targetSeatId)).find(s=>s.enrollmentId===r.targetSeatId)?.status,"COMMITTED");
      results.push({ waiting,done,movement:actual[0],targetSeatId:r.targetSeatId });
    }
    return { results };
  });

  await test("WF09-TRANSFER-CHARGE-COMPENSATION", "An uncertain charge is reversed once when the target hold expires before commit and the original entitlement is retained", async () => {
    await restartPayment("UNKNOWN_AFTER");
    try {
      const person = await confirmed(), target = await offer({priceVnd:125_000}), r = await adjustment(person,{target});
      const waiting = await waitDone("WF-09",r.id,"WAITING"), pending = await refund(r.id);
      await execute(r.id,pending.version);
      const interrupted = await waitDone("WF-09",r.id,"DEAD");
      assert.equal(interrupted.errorCode,"PAYMENT_UNKNOWN");
      const [charge] = await movements(r.id);
      assert.equal(charge.direction,"CHARGE"); assert.equal(charge.amount,25_000);
      assert.equal((await entitlement(person)).currentEntitlement.classId,person.selection.classId);
      const advanced = await h.pools["class-schedule"].query("UPDATE holds SET expires_at=clock_timestamp()-interval '1 second' WHERE enrollment_id=$1 AND status='HELD'",[r.targetSeatId]);
      assert.equal(advanced.rowCount,1,"Synthetic server deadline advances an actual target hold before commit");
      await replayJob(interrupted);
      const done = await waitDone("WF-09",r.id);
      assert.equal(done.jobId,interrupted.jobId); assert(done.attempt>interrupted.attempt);
      const after = await movements(r.id);
      assert.deepEqual(after.map(x=>[x.direction,x.amount]),[["CHARGE",25_000],["REVERSAL",25_000]]);
      assert.equal(after[0].id,charge.id);
      assert.equal((await adjustmentRow(r.id)).status,"FAILED");
      assert.equal((await entitlement(person)).currentEntitlement.classId,person.selection.classId);
      assert.equal((await seats(person.id,r.targetSeatId)).find(s=>s.enrollmentId===person.id)?.status,"COMMITTED");
      const activeTarget = (await h.pools["class-schedule"].query("SELECT count(*)::int AS n FROM holds WHERE enrollment_id=$1 AND (status='COMMITTED' OR status='HELD' AND expires_at>clock_timestamp())",[r.targetSeatId])).rows[0].n;
      assert.equal(activeTarget,0);
      return {waiting,interrupted,done,movements:after,activeTarget};
    } finally { await restartPayment(); }
  });

  const refundCases = [["WF09-REFUND-UNKNOWN_BEFORE", "UNKNOWN_BEFORE"], ["WF09-REFUND-UNKNOWN_AFTER", "UNKNOWN_AFTER"]];
  if (h.incidentWorker) refundCases.push(["WF12-INCIDENT-REPLAY", "UNKNOWN_AFTER"]);
  if (h.restoreDrill) refundCases.push(["WF12-RESTORE", "UNKNOWN_AFTER"]);
  for (const [caseId, fault] of refundCases) await test(caseId, "A refund with an uncertain provider result keeps the reservation and only reconciles a durable adapter receipt on replay", async () => {
    await restartPayment(fault);
    try {
      const person = await confirmed(), r = await adjustment(person,{type:"REFUND",amount:100_000,refundMode:"CANCEL"});
      const waiting = await waitDone("WF-09",r.id,"WAITING"), pending = await refund(r.id);
      assert.equal(pending.status,"RESERVED");
      assert.equal((await entitlement(person)).currentEntitlement.state,"CANCELLED");
      assert.deepEqual((await seats(person.id,r.targetSeatId)).map(s=>s.status),["CANCELLED"]);
      await execute(r.id,pending.version);
      const unknown = await waitDone("WF-09",r.id,"DEAD"), state = await refund(r.id);
      assert.equal(unknown.errorCode,"PAYMENT_UNKNOWN");
      assert.equal(state.status,"UNKNOWN"); assert.equal(state.receiptRef,null); assert(state.ownerId);
      const before = await movements(r.id), withReceipt = fault==="UNKNOWN_AFTER";
      assert.equal(before.length,withReceipt?1:0);
      if (caseId === "WF12-RESTORE") {
        const { restoreIncident } = await import("./wf12-restore-case.mjs");
        return restoreIncident(h, unknown, { enrollmentId: person.id, adjustmentId: r.id, paymentId: person.payment.id }, () => replayJob(unknown));
      }
      let incident;
      if (caseId === "WF12-INCIDENT-REPLAY") {
        const { replayIncident } = await import("./wf12-incident-case.mjs");
        incident = await replayIncident(t, unknown);
      } else await replayJob(unknown);
      const replay = await waitDone("WF-09",r.id,withReceipt?"DONE":"DEAD"), after = await refund(r.id);
      assert(replay.attempt>unknown.attempt);
      assert.equal(after.status,withReceipt?"EXECUTED":"UNKNOWN");
      assert.equal(after.receiptRef,withReceipt?before[0].id:null);
      assert.deepEqual(await movements(r.id),before);
      if (incident) {
        assert.equal(replay.jobId, unknown.jobId);
        assert.deepEqual([...replay.operationKeys].sort(), [...unknown.operationKeys].sort());
        return { waiting, unknown, replay, before, refundStatus:after.status, incident:await incident.verify(replay) };
      }
      return { waiting,unknown,replay,before,refundStatus:after.status,ownerId:after.ownerId };
    } finally { if (caseId !== "WF12-RESTORE") await restartPayment(); }
  });

  await test("WF09-REVOKED-APPROVAL", "The preparer cannot approve and an independently recorded approval with a revoked session cannot authorize settlement or change entitlement", async () => {
    const person = await confirmed(), current = await entitlement(person);
    const make = (type, actor, fields={}) => api("enrollment",`${base}/adjustments`,"POST",{
      enrollmentId:person.id,type,version:current.currentEntitlement.version,reason:"DEMO exercise independent authority",...fields,
    },actor.accessToken,201,randomUUID());
    const self = await make("SUSPEND",director);
    const own = await request("enrollment",`${base}/adjustments/${self.id}/approve`,"POST",{version:self.version},director.accessToken,403);
    await api("enrollment",`${base}/adjustments/${self.id}/revoke`,"POST",{version:self.version},director.accessToken);

    const approver = await h.iamCall(`${base}/auth/login`,{email:director.email,password:t.password});
    const r = await make("REFUND",accountant,{amount:100_000,refundMode:"CANCEL"});
    const denied = await request("enrollment",`${base}/adjustments/${r.id}/approve`,"POST",{version:r.version},accountant.accessToken,403);
    const approved = await api("enrollment",`${base}/adjustments/${r.id}/approve`,"POST",{version:r.version},approver.accessToken);
    const logout = await fetch(h.urls.identity+base+"/auth/logout",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({refreshToken:approver.refreshToken}),signal:AbortSignal.timeout(5000)});
    assert.equal(logout.status,204);
    await api("enrollment",`${base}/adjustments/${r.id}/choice`,"POST",{version:approved.version,accepted:true},person.student.accessToken);
    const blocked = await waitDone("WF-09",r.id,"DEAD");
    assert.equal(blocked.errorCode,"AUTHORIZATION_DENIED");
    assert.deepEqual(await movements(r.id),[]);
    await request("payment",`${base}/refunds/${r.id}`,"GET",undefined,accountant.accessToken,404);
    assert.equal((await entitlement(person)).currentEntitlement.state,"ACTIVE");
    assert.deepEqual((await seats(person.id,r.targetSeatId)).map(s=>s.status),["COMMITTED"]);
    return { blocked,selfApproval:own.status,accountantApproval:denied.status,retainedEntitlement:"ACTIVE" };
  });
}
