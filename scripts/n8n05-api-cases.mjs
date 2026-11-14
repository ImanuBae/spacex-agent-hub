import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { connectBroker } from "@spacex/messaging";

// Each group uses the integrated runtime's real APIs. Only labelled test deadlines are shortened.
export async function runN8n05ApiCases(t) {
  const { h, test, request, api, offer, customer, preview, confirm, claim, authorize, finish, step, purchase, webhook, staff, second, director, accountant, outsider, branch, worker } = t;
  const db = h.pools, classDb = db["class-schedule"];
  const route = (p, action) => `/internal/enrollment/enrollments/${p.id}/${action}`;
  const paymentRoute = (p, action) => `/internal/payment/enrollments/${p.id}/${action}`;
  const seatRoute = (p, action) => `/internal/classes/enrollments/${p.id}/${action}`;
  const one = async (pool, sql, args) => (await pool.query(sql, args)).rows[0];
  const integer = async (pool, sql, args) => Number((await one(pool, sql, args)).n);
  const refs = ctx => ({ jobId: ctx.job.jobId, eventId: ctx.job.eventId, correlationId: ctx.job.correlationId, attempt: ctx.job.attempt, operationKeys: ctx.job.operationRefs.map(r => r.operationKey) });
  async function selection(off, person) {
    off ??= await offer(); person ??= await customer();
    return { ...person, classId: off.classId, packageId: off.packageId };
  }
  async function pending(selected) {
    const p = await preview(selected), source = await confirm(p), ctx = await claim("WF-05");
    assert.equal(ctx.job.entity.id, source.enrollment_id);
    const prepared = { id: source.enrollment_id, confirmation: p, source, ctx };
    prepared.created = (await step(ctx, "enrollment.execute", "enrollment", route(prepared, "create"))).data;
    return prepared;
  }
  async function abandon(p) {
    await step(p.ctx, "payment.execute", "payment", paymentRoute(p, "close"), { reason: "FAILED" });
    await step(p.ctx, "enrollment.execute", "enrollment", route(p, "failed"));
    await step(p.ctx, "classes.enroll", "class-schedule", seatRoute(p, "release"));
    await finish(p.ctx);
  }
  async function counts(p) {
    return {
      orders: await integer(db.enrollment, "SELECT count(*)::int AS n FROM enrollments WHERE id=$1", [p.id]),
      holds: await integer(classDb, "SELECT count(*)::int AS n FROM holds WHERE enrollment_id=$1", [p.id]),
      held: await integer(classDb, "SELECT count(*)::int AS n FROM holds WHERE enrollment_id=$1 AND status='HELD' AND expires_at>clock_timestamp()", [p.id]),
      committed: await integer(classDb, "SELECT count(*)::int AS n FROM holds WHERE enrollment_id=$1 AND status='COMMITTED'", [p.id]),
      qr: await integer(db.payment, "SELECT count(*)::int AS n FROM payment_requests WHERE enrollment_id=$1", [p.id]),
      ledger: await integer(db.payment, "SELECT count(*)::int AS n FROM payment_ledger l JOIN payment_requests p ON p.id=l.payment_id WHERE p.enrollment_id=$1", [p.id]),
      confirmedEvents: await integer(db.enrollment, "SELECT count(*)::int AS n FROM event_outbox WHERE event->>'type'='enrollment.confirmed' AND event->>'entityId'=$1", [p.id]),
    };
  }
  async function workflowToken(workflow = "WF-07") {
    return (await h.iamCall("/internal/iam/machine/token", { clientId: worker.id, clientSecret: worker.clientSecret, audience: "automation-bridge", scopes: ["automation:claim", "automation:read", "automation:authorize"], workflows: [workflow], ttlSeconds: 300 })).accessToken;
  }
  async function expireDeadlines(p) {
    const deadline = new Date(Date.now() - 2000).toISOString();
    await classDb.query("UPDATE holds SET expires_at=$2 WHERE enrollment_id=$1 AND status='HELD'", [p.id, deadline]);
    await db.enrollment.query("UPDATE enrollments SET expires_at=$2 WHERE id=$1", [p.id, deadline]);
    await db.payment.query("UPDATE payment_requests SET expires_at=$2 WHERE enrollment_id=$1", [p.id, deadline]);
  }
  async function reconcile(p, { reason = "EXPIRE", action = "reconcile", ctx } = {}) {
    ctx ??= await claim("WF-07"); assert.equal(ctx.job.entity.id, p.id);
    await step(ctx, "payment.execute", "payment", paymentRoute(p, "close"), { reason });
    const result = (await step(ctx, "enrollment.execute", "enrollment", route(p, action))).data;
    if (result.releaseAuthorized && result.status !== "CONFIRMED") await step(ctx, "classes.enroll", "class-schedule", seatRoute(p, "release"));
    await finish(ctx); return { result, ...refs(ctx) };
  }
  async function expire(p) {
    await expireDeadlines(p);
    const token = await workflowToken(), first = await api("enrollment", "/internal/enrollment/deadlines", "POST", {}, token);
    assert.equal(first.count, 1, "Exactly this isolated enrollment deadline should be due");
    assert.equal((await api("enrollment", "/internal/enrollment/deadlines", "POST", {}, token)).count, 0, "Same resource/version deadline must deduplicate");
    return reconcile(p);
  }
  async function cancel(p) {
    const row = await api("enrollment", `/api/v1/enrollments/${p.id}`, "GET", undefined, staff.accessToken);
    await api("enrollment", `/api/v1/enrollments/${p.id}/cancel`, "POST", { version: row.version, reason: "DEMO customer cancellation before collection" }, staff.accessToken, 202, randomUUID());
    return reconcile(p, { reason: "CANCEL", action: "cancel" });
  }
  async function settle(p, matched) {
    const ctx = await claim("WF-06"); assert.equal(ctx.job.entity.id, p.id); assert.equal(ctx.job.inputRef, matched.data.matchRef);
    await step(ctx, "enrollment.execute", "enrollment", route(p, "confirming"));
    await step(ctx, "classes.enroll", "class-schedule", seatRoute(p, "commit"), { matchRef: matched.data.matchRef });
    const result = (await step(ctx, "enrollment.execute", "enrollment", route(p, "confirm"))).data;
    await finish(ctx); return { result, ...refs(ctx) };
  }
  async function updatePackage(off, changes) {
    const current = await api("catalog", `/api/v1/packages/${off.packageId}`);
    const input = Object.fromEntries(["courseId", "code", "name", "sessionCount", "policyText", "priceVnd", "status"].map(k => [k, current[k]]));
    return api("catalog", `/api/v1/packages/${off.packageId}`, "PUT", { ...input, ...changes });
  }
  async function reviewFor(p, reason) {
    const r = await one(db.payment, "SELECT * FROM payment_reviews WHERE payment_id=$1 AND reason=$2", [p.payment.id, reason]);
    assert(r, `Durable ${reason} review required`); assert.equal(r.owner_id, accountant.id); assert(r.deadline_at instanceof Date); return r;
  }
  async function reviewedPayment(amount) {
    const p = await purchase(await selection()), received = await webhook(p.payment, { amount });
    assert.equal(received.data.matchRef, undefined);
    const outcome = await reconcile(p);
    assert.equal(outcome.result.status, "PAYMENT_REVIEW"); assert.equal(outcome.result.releaseAuthorized, false);
    return { p, received, outcome };
  }

  await test("WF05-STRICT-CONFIRMATION-AND-OWNERSHIP", "Only exact backend selection/explicit acceptance; forged actor/branch/amount rejected and other customers cannot read confirmation", async () => {
    const selected = await selection();
    for (const field of ["actorId", "branchId", "amountDue", "quoteVersion", "termsVersion"]) await request("enrollment", "/api/v1/enrollment-confirmations/preview", "POST", { ...selected, [field]: field === "amountDue" ? 1 : randomUUID() }, staff.accessToken, 400, randomUUID());
    const p = await preview(selected);
    await request("enrollment", `/api/v1/enrollment-confirmations/${p.id}/confirm`, "POST", { accepted: "đồng ý" }, staff.accessToken, 400);
    await request("enrollment", `/api/v1/enrollment-confirmations/${p.id}/confirm`, "POST", { accepted: true, learnerId: randomUUID() }, staff.accessToken, 400);
    for (const actor of [second, outsider]) await request("enrollment", `/api/v1/enrollment-confirmations/${p.id}`, "GET", undefined, actor.accessToken, 403);
    await request("enrollment", `/api/v1/enrollment-confirmations/${p.id}/confirm`, "POST", { accepted: true }, second.accessToken, 403);
    await api("enrollment", `/api/v1/enrollment-confirmations/${p.id}/revoke`, "POST", {}, staff.accessToken);
    const source = await one(db.enrollment, "SELECT enrollment_id,status FROM confirmations WHERE id=$1", [p.id]);
    const actual = await counts({ id: source.enrollment_id }); assert.equal(actual.orders, 0); assert.equal(actual.holds, 0); assert.equal(actual.qr, 0);
    return { confirmationId: p.id, enrollmentId: source.enrollment_id, status: source.status, counts: actual, strictRejections: 7, crossCustomerRejections: 3 };
  });
  await test("WF05-PREVIEW-IDEMPOTENCY", "Concurrent identical preview has one confirmation; changed payload with same operation key is rejected", async () => {
    const selected = await selection(), key = randomUUID();
    const attempts = await Promise.all([request("enrollment", "/api/v1/enrollment-confirmations/preview", "POST", selected, staff.accessToken, 201, key), request("enrollment", "/api/v1/enrollment-confirmations/preview", "POST", selected, staff.accessToken, 201, key)]);
    assert.equal(attempts[0].data.id, attempts[1].data.id);
    await request("enrollment", "/api/v1/enrollment-confirmations/preview", "POST", { ...selected, learnerId: randomUUID() }, staff.accessToken, 409, key);
    assert.equal(await integer(db.enrollment, "SELECT count(*)::int AS n FROM confirmations WHERE operation_key=$1", [key]), 1);
    await api("enrollment", `/api/v1/enrollment-confirmations/${attempts[0].data.id}/revoke`, "POST", {}, staff.accessToken);
    return { confirmationId: attempts[0].data.id, operationKey: key, confirmations: 1, mismatchedPayloadStatus: 409 };
  });
  await test("WF05-CONFIRMATION-EXPIRY-AND-REVOKE", "Expired draft and revoked published confirmation produce no order, hold or QR", async () => {
    const expired = await preview(await selection());
    await db.enrollment.query("UPDATE confirmations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [expired.id]);
    await request("enrollment", `/api/v1/enrollment-confirmations/${expired.id}/confirm`, "POST", { accepted: true }, staff.accessToken, 409);
    const revoked = await preview(await selection()), source = await confirm(revoked), ctx = await claim("WF-05");
    assert.equal(ctx.job.entity.id, source.enrollment_id);
    const token = await authorize(ctx, "enrollment.execute");
    await api("enrollment", `/api/v1/enrollment-confirmations/${revoked.id}/revoke`, "POST", {}, staff.accessToken);
    await request("enrollment", `/internal/enrollment/enrollments/${source.enrollment_id}/create`, "POST", {}, token, 403);
    await finish(ctx); const actual = await counts({ id: source.enrollment_id });
    assert.equal(actual.orders, 0); assert.equal(actual.holds, 0); assert.equal(actual.qr, 0);
    return { expiredConfirmationId: expired.id, revokedConfirmationId: revoked.id, ...refs(ctx), counts: actual };
  });
  await test("WF05-CONFIRMATION-REPLAY", "Concurrent confirmation publishes one source event and create replay consumes one confirmation once", async () => {
    const p = await preview(await selection());
    await Promise.all([api("enrollment", `/api/v1/enrollment-confirmations/${p.id}/confirm`, "POST", { accepted: true }, staff.accessToken), api("enrollment", `/api/v1/enrollment-confirmations/${p.id}/confirm`, "POST", { accepted: true }, staff.accessToken)]);
    const source = await one(db.enrollment, "SELECT * FROM confirmations WHERE id=$1", [p.id]), ctx = await claim("WF-05"), prepared = { id: source.enrollment_id, source, ctx };
    assert.equal(ctx.job.inputRef, p.id);
    const first = await step(ctx, "enrollment.execute", "enrollment", route(prepared, "create"));
    const secondResult = await step(ctx, "enrollment.execute", "enrollment", route(prepared, "create")); assert.deepEqual(secondResult.data, first.data);
    assert.equal(await integer(db.enrollment, "SELECT count(*)::int AS n FROM event_outbox WHERE event->>'type'='enrollment.requested' AND event->'payload'->>'inputRef'=$1", [p.id]), 1);
    assert.equal((await counts(prepared)).orders, 1); await abandon(prepared);
    return { confirmationId: p.id, enrollmentId: prepared.id, ...refs(ctx), sourceEvents: 1, orders: 1 };
  });
  await test("WF05-QUOTE-CHANGED-BEFORE-CONFIRM", "Catalog quote/policy change requires a new explicit confirmation; old snapshot stays unchanged", async () => {
    const off = await offer(), p = await preview(await selection(off)), original = p.snapshot;
    await updatePackage(off, { priceVnd: 120000, policyText: "DEMO policy revision requires confirmation" });
    await request("enrollment", `/api/v1/enrollment-confirmations/${p.id}/confirm`, "POST", { accepted: true }, staff.accessToken, 409);
    const read = await api("enrollment", `/api/v1/enrollment-confirmations/${p.id}`, "GET", undefined, staff.accessToken); assert.deepEqual(read.snapshot, original); assert.equal(read.status, "DRAFT");
    await api("enrollment", `/api/v1/enrollment-confirmations/${p.id}/revoke`, "POST", {}, staff.accessToken);
    return { confirmationId: p.id, originalQuoteVersion: original.quoteVersion, originalAmountDue: original.amountDue, newCatalogAmount: 120000, rejectedStatus: 409 };
  });
  await test("WF05-QUOTE-CHANGED-OR-CLOSED-AFTER-CONFIRM", "Changed or closed Catalog offer creates NEEDS_CONFIRMATION without hold/QR; persisted snapshots are immutable", async () => {
    const results = [];
    for (const changes of [{ priceVnd: 125000 }, { status: "closed" }]) {
      const off = await offer(), p = await preview(await selection(off)), source = await confirm(p), ctx = await claim("WF-05"), prepared = { id: source.enrollment_id, ctx };
      assert.equal(ctx.job.entity.id, prepared.id); await updatePackage(off, changes);
      const result = await step(ctx, "enrollment.execute", "enrollment", route(prepared, "create")); assert.equal(result.data.status, "NEEDS_CONFIRMATION"); assert.equal(result.data.snapshot.amountDue, 100000);
      await step(ctx, "classes.enroll", "class-schedule", seatRoute(prepared, "hold"), {}, 409);
      await step(ctx, "payment.execute", "payment", paymentRoute(prepared, "create"), {}, 409);
      await assert.rejects(db.enrollment.query("UPDATE enrollments SET snapshot=snapshot||'{\"amountDue\":1}'::jsonb WHERE id=$1", [prepared.id]), /Immutable confirmed snapshot/);
      await assert.rejects(db.enrollment.query("UPDATE confirmations SET snapshot=snapshot||'{\"amountDue\":1}'::jsonb WHERE id=$1", [p.id]), /Immutable confirmed snapshot/);
      const actual = await counts(prepared); assert.equal(actual.holds, 0); assert.equal(actual.qr, 0); await finish(ctx);
      results.push({ enrollmentId: prepared.id, confirmationId: p.id, ...refs(ctx), status: result.data.status, counts: actual });
    }
    return { variants: results };
  });
  await test("WF05-CLASS-NOT-OPEN", "A PLANNED class cannot produce a confirmation or take money", async () => {
    const off = await offer({ status: "PLANNED" }), selected = await selection(off);
    await request("enrollment", "/api/v1/enrollment-confirmations/preview", "POST", selected, staff.accessToken, 409, randomUUID());
    const confirmations = await integer(db.enrollment, "SELECT count(*)::int AS n FROM confirmations WHERE payload->>'classId'=$1", [off.classId]);
    assert.equal(confirmations, 0); assert.equal(await integer(classDb, "SELECT count(*)::int AS n FROM holds WHERE class_id=$1", [off.classId]), 0);
    return { classId: off.classId, classStatus: "PLANNED", confirmations, holds: 0 };
  });
  await test("WF05-NO-HOLD-NO-QR", "Backend rejects QR before a real hold and rejects forged hold payload fields", async () => {
    const p = await pending(await selection());
    await step(p.ctx, "payment.execute", "payment", paymentRoute(p, "create"), {}, 409);
    await step(p.ctx, "classes.enroll", "class-schedule", seatRoute(p, "hold"), { actorId: staff.id, branchId: branch }, 400);
    const actual = await counts(p); assert.equal(actual.holds, 0); assert.equal(actual.qr, 0);
    await abandon(p); return { enrollmentId: p.id, ...refs(p.ctx), countsBeforeCompensation: actual, compensatedState: "CANCELLED" };
  });
  await test("WF05-LAST-SEAT-RACE", "Two real enrollments race for one seat: exactly one hold/QR; losing enrollment has neither", async () => {
    const off = await offer({ capacity: 1 }), first = await pending(await selection(off)), other = await pending(await selection(off)), candidates = [first, other];
    const attempts = await Promise.all(candidates.map(p => step(p.ctx, "classes.enroll", "class-schedule", seatRoute(p, "hold"), {}, null)));
    assert.deepEqual(attempts.map(r => r.status).sort(), [200, 409]);
    const winnerIndex = attempts[0].status === 200 ? 0 : 1, winner = candidates[winnerIndex], loser = candidates[1 - winnerIndex];
    await abandon(loser);
    await step(winner.ctx, "enrollment.execute", "enrollment", route(winner, "held"));
    winner.payment = (await step(winner.ctx, "payment.execute", "payment", paymentRoute(winner, "create"))).data;
    await step(winner.ctx, "enrollment.execute", "enrollment", route(winner, "payment")); await finish(winner.ctx);
    const actual = { winner: await counts(winner), loser: await counts(loser) };
    assert.equal(actual.winner.held, 1); assert.equal(actual.winner.qr, 1); assert.equal(actual.loser.holds, 0); assert.equal(actual.loser.qr, 0);
    const cleanup = await cancel(winner);
    return { classId: off.classId, winnerEnrollmentId: winner.id, loserEnrollmentId: loser.id, winnerJob: refs(winner.ctx), loserJob: refs(loser.ctx), countsAtRace: actual, cleanup };
  });
  await test("WF05-DUPLICATE-AND-LOOKUP-AFTER-COMMIT", "A committed hold/QR is looked up before replay; one hold, QR and operation result despite omitted client checkpoint", async () => {
    const p = await pending(await selection());
    const firstHold = await step(p.ctx, "classes.enroll", "class-schedule", seatRoute(p, "hold"));
    const replayHold = await step(p.ctx, "classes.enroll", "class-schedule", seatRoute(p, "hold")); assert.deepEqual(replayHold.data, firstHold.data);
    await step(p.ctx, "enrollment.execute", "enrollment", route(p, "held"));
    const token = await authorize(p.ctx, "payment.execute");
    await api("payment", paymentRoute(p, "create"), "POST", {}, token);
    // The runner observed HTTP success; this deliberately omits its workflow checkpoint, not an actual socket timeout.
    const lookup = await api("payment", `/internal/payment/enrollments/${p.id}`, "GET", undefined, token);
    const replay = await api("payment", paymentRoute(p, "create"), "POST", {}, token); assert.equal(replay.id, lookup.id); p.payment = replay;
    await step(p.ctx, "enrollment.execute", "enrollment", route(p, "payment")); await finish(p.ctx);
    const actual = await counts(p); assert.equal(actual.holds, 1); assert.equal(actual.qr, 1);
    const operations = await integer(db.payment, "SELECT count(*)::int AS n FROM payment_operations WHERE enrollment_id=$1 AND action='create'", [p.id]); assert.equal(operations, 1);
    await cancel(p); return { enrollmentId: p.id, paymentRequestId: lookup.id, ...refs(p.ctx), observedFault: "CLIENT_CHECKPOINT_OMITTED_AFTER_COMMIT", actualSocketTimeout: false, counts: actual, createOperationResults: operations };
  });
  await test("WF06-WEBHOOK-AUTH-DEDUP-CONFLICT", "Signed synthetic webhook only; replay is one immutable ledger/match/allocation and conflicting transaction payload is rejected", async () => {
    const p = await purchase(await selection()), transactionId = randomUUID(), payload = { provider: "SYNTHETIC", account: "DEMO-N8N05", transactionId, reference: p.payment.reference, amount: 100000, currency: "VND" };
    await request("payment", "/internal/payment/synthetic-webhook", "POST", payload, "", 401, undefined, { "x-demo-signature": "0".repeat(64) });
    await request("payment", "/internal/payment/synthetic-webhook", "POST", { ...payload, account: "FORGED" }, "", 400);
    const matched = await webhook(p.payment, { transactionId }), duplicate = await webhook(p.payment, { transactionId });
    assert.equal(duplicate.data.duplicate, true); assert.equal(duplicate.data.ledgerId, matched.data.ledgerId);
    await webhook(p.payment, { transactionId, amount: 100001 }, 409);
    const settled = await settle(p, matched), actual = await counts(p); assert.equal(actual.ledger, 1); assert.equal(actual.committed, 1); assert.equal(actual.confirmedEvents, 1);
    assert.equal(await integer(db.payment, "SELECT count(*)::int AS n FROM payment_allocations WHERE payment_id=$1", [p.payment.id]), 1);
    await assert.rejects(db.payment.query("UPDATE payment_ledger SET amount=1 WHERE id=$1", [matched.data.ledgerId]), /Append only payment ledger/);
    return { enrollmentId: p.id, transactionId, ledgerId: matched.data.ledgerId, matchRef: matched.data.matchRef, ...settled, counts: actual, conflictingPayloadStatus: 409 };
  });
  await test("WF06-COMMIT-CRASH-RECOVERY", "No confirmation before Class commit; expired worker cannot write; reclaim looks up same committed seat and converges once", async () => {
    const p = await purchase(await selection()), matched = await webhook(p.payment), ctx = await claim("WF-06"); assert.equal(ctx.job.entity.id, p.id);
    await step(ctx, "enrollment.execute", "enrollment", route(p, "confirming"));
    await step(ctx, "enrollment.execute", "enrollment", route(p, "confirm"), {}, 409);
    const committed = await step(ctx, "classes.enroll", "class-schedule", seatRoute(p, "commit"), { matchRef: matched.data.matchRef });
    assert.equal(committed.data.status, "COMMITTED"); assert.equal((await counts(p)).confirmedEvents, 0);
    const staleToken = await authorize(ctx, "enrollment.execute"), firstAttempt = ctx.job.attempt;
    await db["automation-bridge"].query("UPDATE automation_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [ctx.job.jobId]);
    await request("enrollment", route(p, "confirm"), "POST", {}, staleToken, 409);
    const recovered = await claim("WF-06"); assert.equal(recovered.job.jobId, ctx.job.jobId); assert.equal(recovered.job.attempt, firstAttempt + 1);
    const seatToken = await authorize(recovered, "classes.enroll"), seat = await api("class-schedule", `/internal/classes/enrollments/${p.id}`, "GET", undefined, seatToken); assert.equal(seat.hold.id, committed.data.id); assert.equal(seat.committed, true);
    await step(recovered, "classes.enroll", "class-schedule", seatRoute(p, "commit"), { matchRef: matched.data.matchRef });
    await step(recovered, "enrollment.execute", "enrollment", route(p, "confirm")); await finish(recovered);
    const actual = await counts(p); assert.equal(actual.holds, 1); assert.equal(actual.committed, 1); assert.equal(actual.confirmedEvents, 1);
    const commits = await integer(classDb, "SELECT count(*)::int AS n FROM class_audit WHERE target_id=$1 AND action='hold.committed'", [committed.data.id]); assert.equal(commits, 1);
    return { enrollmentId: p.id, holdId: committed.data.id, matchRef: matched.data.matchRef, ledgerId: matched.data.ledgerId, fault: "EXPIRED_WORKER_AFTER_CLASS_COMMIT_BEFORE_ENROLLMENT_CONFIRM", firstAttempt, ...refs(recovered), classCommitAudits: commits, counts: actual };
  });
  await test("WF06-TWO-ACTUAL-SYNTHETIC-TRANSFERS", "Different transaction IDs remain two ledger entries; only one tuition allocation/seat, excess has an owned review", async () => {
    const p = await purchase(await selection()), first = await webhook(p.payment), secondTransfer = await webhook(p.payment);
    await settle(p, first); const review = await reviewFor(p, "MULTIPLE_TRANSACTIONS"), reviewed = await reconcile(p);
    assert.equal(reviewed.result.status, "CONFIRMED");
    const money = await api("payment", `/api/v1/payment-requests/${p.payment.id}`, "GET", undefined, staff.accessToken); assert.equal(money.receivedAmount, 200000); assert.equal(money.moneyStatus, "MATCHED_WITH_EXCESS");
    assert.equal(await integer(db.payment, "SELECT COALESCE(sum(amount),0)::int AS n FROM payment_allocations WHERE payment_id=$1", [p.payment.id]), 100000);
    const actual = await counts(p); assert.equal(actual.ledger, 2); assert.equal(actual.committed, 1); assert.equal(actual.confirmedEvents, 1);
    return { enrollmentId: p.id, ledgerIds: [first.data.ledgerId, secondTransfer.data.ledgerId], reviewId: review.id, ownerId: review.owner_id, amountReceived: money.receivedAmount, amountAllocated: 100000, counts: actual, reviewJob: reviewed };
  });
  for (const [id, amount, reason] of [["WF07-UNDERPAYMENT", 90000, "UNDERPAID"], ["WF07-OVERPAYMENT", 110000, "OVERPAID"]]) await test(id, "Amount deviation is durable owned review, never automatic match/confirmation; hold expires without losing money", async () => {
    const { p, received, outcome } = await reviewedPayment(amount), review = await reviewFor(p, reason), expired = await expire(p);
    assert.equal(expired.result.status, "PAYMENT_REVIEW"); const actual = await counts(p); assert.equal(actual.held, 0); assert.equal(actual.committed, 0); assert.equal(actual.confirmedEvents, 0); assert.equal(actual.ledger, 1);
    assert.equal(await integer(db.payment, "SELECT amount::int AS n FROM payment_ledger WHERE id=$1", [received.data.ledgerId]), amount);
    return { enrollmentId: p.id, paymentId: p.payment.id, ledgerId: received.data.ledgerId, reviewId: review.id, ownerId: review.owner_id, deadlineAt: review.deadline_at, receivedAmount: amount, reviewJob: outcome, expiryJob: expired, counts: actual };
  });
  await test("WF07-WRONG-REFERENCE", "Equal amount with wrong reference remains unallocated and owned; it cannot settle any enrollment", async () => {
    const payment = h.firstPurchase.payment, before = await counts(h.firstPurchase), received = await webhook(payment, { reference: `UNKNOWN${randomUUID().replaceAll("-", "")}` });
    const ledger = await one(db.payment, "SELECT id,payment_id,amount FROM payment_ledger WHERE id=$1", [received.data.ledgerId]), review = await one(db.payment, "SELECT id,payment_id,owner_id,reason,status FROM payment_reviews WHERE ledger_id=$1", [ledger.id]);
    assert.equal(ledger.payment_id, null); assert.equal(Number(ledger.amount), 100000); assert.equal(review.payment_id, null); assert.equal(review.owner_id, accountant.id); assert.equal(review.reason, "UNALLOCATED_REFERENCE");
    assert.equal(await integer(db.payment, "SELECT count(*)::int AS n FROM payment_allocations WHERE ledger_id=$1", [ledger.id]), 0); assert.deepEqual(await counts(h.firstPurchase), before);
    const detail = await api("payment", `/api/v1/payment-reviews/${review.id}`, "GET", undefined, accountant.accessToken); assert.equal(detail.ledger.id, ledger.id);
    return { ledgerId: ledger.id, reviewId: review.id, ownerId: review.owner_id, paymentId: null, allocations: 0, originalEnrollmentCountsUnchanged: before };
  });
  await test("WF07-CLASS-DEADLINE-WITHOUT-N8N", "With workflow workers inactive, Class server expiry releases capacity; later deduplicated deadline processing closes original QR", async () => {
    const off = await offer({ capacity: 1 }), p = await purchase(await selection(off)); await expireDeadlines(p);
    const availability = await api("class-schedule", `/api/v1/classes/${off.classId}`, "GET", undefined, staff.accessToken); assert.equal(availability.held, 0); assert.equal(availability.available, 1);
    const next = await purchase(await selection(off));
    assert.equal((await counts(next)).held, 1); assert.equal((await counts(p)).held, 0);
    const token = await workflowToken(); assert.equal((await api("enrollment", "/internal/enrollment/deadlines", "POST", {}, token)).count, 1); assert.equal((await api("enrollment", "/internal/enrollment/deadlines", "POST", {}, token)).count, 0);
    const expired = await reconcile(p); assert.equal(expired.result.status, "EXPIRED");
    const payment = await api("payment", `/api/v1/payment-requests/${p.payment.id}`, "GET", undefined, staff.accessToken); assert.equal(payment.status, "EXPIRED");
    const actual = await counts(p); assert.equal(actual.ledger, 0); assert.equal(actual.committed, 0); assert.equal(actual.confirmedEvents, 0);
    await cancel(next); return { originalEnrollmentId: p.id, nextEnrollmentId: next.id, classId: off.classId, classAvailableBeforeDeadlinePoll: availability.available, paymentStatus: payment.status, workerMode: "NO_ACTIVE_BUSINESS_WORKFLOWS_OR_DEADLINE_POLL_DURING_CLASS_PROOF", expiryJob: expired, counts: actual };
  });
  await test("WF07-LATE-FULL-AVAILABLE", "Full money after expiry can reacquire the original seat atomically when capacity remains; one confirmation only", async () => {
    const p = await purchase(await selection()), expired = await expire(p); assert.equal(expired.result.status, "EXPIRED");
    const received = await webhook(p.payment), match = await one(db.payment, "SELECT late FROM payment_matches WHERE id=$1", [received.data.matchRef]); assert.equal(match.late, true);
    const settled = await settle(p, received), actual = await counts(p); assert.equal(actual.holds, 1); assert.equal(actual.committed, 1); assert.equal(actual.confirmedEvents, 1); assert.equal(actual.ledger, 1);
    return { enrollmentId: p.id, ledgerId: received.data.ledgerId, matchRef: received.data.matchRef, late: match.late, expiryJob: expired, settlementJob: settled, counts: actual };
  });
  await test("WF07-LATE-FULL-NO-SEAT", "Late full payment cannot steal another enrollment's final seat; durable NO_SEAT review has owner/deadline and no early confirmation", async () => {
    const off = await offer({ capacity: 1 }), p = await purchase(await selection(off)); await expire(p);
    const occupant = await purchase(await selection(off)), received = await webhook(p.payment), ctx = await claim("WF-06"); assert.equal(ctx.job.entity.id, p.id);
    await step(ctx, "enrollment.execute", "enrollment", route(p, "confirming")); await step(ctx, "classes.enroll", "class-schedule", seatRoute(p, "commit"), { matchRef: received.data.matchRef }, 409);
    await step(ctx, "payment.execute", "payment", paymentRoute(p, "exception"), { reason: "NO_SEAT" });
    const exception = (await step(ctx, "enrollment.execute", "enrollment", route(p, "exception"))).data; assert.equal(exception.status, "PAYMENT_REVIEW"); await finish(ctx);
    const review = await reviewFor(p, "NO_SEAT"), reviewed = await reconcile(p), actual = await counts(p);
    assert.equal(actual.committed, 0); assert.equal(actual.confirmedEvents, 0); assert.equal(actual.ledger, 1); assert.equal((await counts(occupant)).held, 1);
    await cancel(occupant); return { enrollmentId: p.id, occupiedByEnrollmentId: occupant.id, ledgerId: received.data.ledgerId, matchRef: received.data.matchRef, reviewId: review.id, ownerId: review.owner_id, deadlineAt: review.deadline_at, exceptionJob: refs(ctx), reviewJob: reviewed, counts: actual };
  });
  await test("WF07-REVIEW-TIMEOUT", "Review timeout escalates to its owner, releases expired hold through reconciliation, and preserves every ledger entry", async () => {
    const { p, received } = await reviewedPayment(90000), review = await reviewFor(p, "UNDERPAID");
    await db.payment.query("UPDATE payment_reviews SET deadline_at=clock_timestamp()-interval '1 second' WHERE id=$1", [review.id]);
    const timeout = await api("payment", "/internal/payment/review-deadlines", "POST", {}, await workflowToken()); assert(timeout.ids.includes(review.id));
    assert(!(await api("payment", "/internal/payment/review-deadlines", "POST", {}, await workflowToken())).ids.includes(review.id));
    const expired = await expire(p), current = await reviewFor(p, "UNDERPAID"); assert.equal(current.status, "ESCALATED"); assert.equal(current.owner_id, accountant.id);
    const actual = await counts(p); assert.equal(actual.held, 0); assert.equal(actual.ledger, 1); assert.equal(actual.confirmedEvents, 0);
    return { enrollmentId: p.id, reviewId: review.id, ledgerId: received.data.ledgerId, ownerId: current.owner_id, reviewStatus: current.status, expiryJob: expired, counts: actual };
  });
  let extended;
  await test("WF07-REVIEW-EXTEND-ONCE", "Independent approved review extension is at most 24h once and never extends Class hold or QR", async () => {
    const { p, received } = await reviewedPayment(90000), review = await reviewFor(p, "UNDERPAID"), hold = await one(classDb, "SELECT expires_at FROM holds WHERE enrollment_id=$1", [p.id]);
    await request("payment", `/api/v1/payment-reviews/${review.id}/decision`, "POST", { version: review.version, decision: "EXTEND", reason: "DEMO verified review needs one extension" }, staff.accessToken, 403);
    await api("payment", `/api/v1/payment-reviews/${review.id}/decision`, "POST", { version: review.version, decision: "EXTEND", reason: "DEMO verified review needs one extension" }, accountant.accessToken);
    await request("payment", `/api/v1/payment-reviews/${review.id}/approve`, "POST", { version: review.version + 1 }, accountant.accessToken, 403);
    const beforeApproval = Date.now(); await api("payment", `/api/v1/payment-reviews/${review.id}/approve`, "POST", { version: review.version + 1 }, director.accessToken);
    const current = await reviewFor(p, "UNDERPAID"); assert.equal(current.status, "EXTENDED"); assert.equal(current.extended, true); assert(current.deadline_at.getTime() > beforeApproval); assert(current.deadline_at.getTime() <= Date.now() + 86400000);
    assert.equal((await one(classDb, "SELECT expires_at FROM holds WHERE enrollment_id=$1", [p.id])).expires_at.toISOString(), hold.expires_at.toISOString());
    assert.equal((await one(db.payment, "SELECT expires_at FROM payment_requests WHERE id=$1", [p.payment.id])).expires_at.toISOString(), hold.expires_at.toISOString());
    await reconcile(p);
    await request("payment", `/api/v1/payment-reviews/${review.id}/decision`, "POST", { version: current.version, decision: "EXTEND", reason: "DEMO disallowed second review extension" }, accountant.accessToken, 409);
    assert.equal(await integer(db.payment, "SELECT count(*)::int AS n FROM payment_review_decisions WHERE review_id=$1", [review.id]), 1);
    await expire(p); extended = { p, reviewId: review.id, ledgerId: received.data.ledgerId };
    const actual = await counts(p); assert.equal(actual.ledger, 1); assert.equal(actual.committed, 0); assert.equal(actual.confirmedEvents, 0);
    return { enrollmentId: p.id, reviewId: review.id, ledgerId: received.data.ledgerId, ownerId: current.owner_id, reviewDeadlineAt: current.deadline_at, originalHoldExpiresAt: hold.expires_at, holdExtended: false, approvedExtensions: 1, counts: actual };
  });
  await test("WF07-REFUND-PENDING-APPROVAL", "Owned refund proposal needs independent current approval; result remains REFUND_PENDING with ledger intact and no real refund", async () => {
    const { p, reviewId, ledgerId } = extended, current = await reviewFor(p, "UNDERPAID");
    await api("payment", `/api/v1/payment-reviews/${reviewId}/decision`, "POST", { version: current.version, decision: "REFUND_PENDING", reason: "DEMO unresolved payment requires approved refund proposal" }, accountant.accessToken);
    await request("payment", `/api/v1/payment-reviews/${reviewId}/approve`, "POST", { version: current.version }, director.accessToken, 409);
    await api("payment", `/api/v1/payment-reviews/${reviewId}/approve`, "POST", { version: current.version + 1 }, director.accessToken);
    const outcome = await reconcile(p); assert.equal(outcome.result.status, "REFUND_PENDING"); assert.equal((await reviewFor(p, "UNDERPAID")).status, "REFUND_PENDING");
    await request("payment", `/api/v1/payment-reviews/${reviewId}/decision`, "POST", { version: current.version + 2, decision: "EXTEND", reason: "DEMO disallowed change after refund proposal approval" }, accountant.accessToken, 409);
    const actual = await counts(p); assert.equal(actual.committed, 0); assert.equal(actual.ledger, 1); assert.equal(actual.confirmedEvents, 0);
    assert.equal(await integer(db.payment, "SELECT amount::int AS n FROM payment_ledger WHERE id=$1", [ledgerId]), 90000);
    return { enrollmentId: p.id, reviewId, ledgerId, ownerId: current.owner_id, enrollmentStatus: outcome.result.status, refundExecuted: false, transferredMoney: 0, reviewJob: outcome, counts: actual };
  });
  let cancelled;
  await test("WF07-CANCEL-IDEMPOTENCY", "Unpaid cancellation uses one command/event and closes QR/releases hold exactly once; changed operation payload rejected", async () => {
    const p = await purchase(await selection()), row = await api("enrollment", `/api/v1/enrollments/${p.id}`, "GET", undefined, staff.accessToken), key = randomUUID(), input = { version: row.version, reason: "DEMO confirmed cancellation before any payment" };
    const first = await api("enrollment", `/api/v1/enrollments/${p.id}/cancel`, "POST", input, staff.accessToken, 202, key), replay = await api("enrollment", `/api/v1/enrollments/${p.id}/cancel`, "POST", input, staff.accessToken, 202, key); assert.deepEqual(replay, first);
    await request("enrollment", `/api/v1/enrollments/${p.id}/cancel`, "POST", { ...input, reason: "DEMO different cancellation payload for same key" }, staff.accessToken, 409, key);
    const outcome = await reconcile(p, { reason: "CANCEL", action: "cancel" }); assert.equal(outcome.result.status, "CANCELLED");
    const pay = await api("payment", `/api/v1/payment-requests/${p.payment.id}`, "GET", undefined, staff.accessToken); assert.equal(pay.status, "CANCELLED");
    const hold = await one(classDb, "SELECT status FROM holds WHERE enrollment_id=$1", [p.id]); assert.equal(hold.status, "CANCELLED");
    assert.equal(await integer(db.enrollment, "SELECT count(*)::int AS n FROM enrollment_cancellations WHERE enrollment_id=$1", [p.id]), 1); cancelled = p;
    return { enrollmentId: p.id, cancellationId: key, paymentId: p.payment.id, paymentStatus: pay.status, holdStatus: hold.status, cancellationJob: outcome, counts: await counts(p) };
  });
  await test("WF07-MONEY-AFTER-CANCEL", "Money after completed cancellation is still ledgered and owned for review; no match, seat or customer confirmation is created", async () => {
    const p = cancelled, received = await webhook(p.payment); assert.equal(received.data.matchRef, undefined);
    const review = await reviewFor(p, "AFTER_CANCEL"), outcome = await reconcile(p), actual = await counts(p);
    assert.equal(actual.held, 0); assert.equal(actual.committed, 0); assert.equal(actual.ledger, 1); assert.equal(actual.confirmedEvents, 0); assert.equal(outcome.result.releaseAuthorized, true);
    assert.equal(await integer(db.payment, "SELECT count(*)::int AS n FROM payment_matches WHERE payment_id=$1", [p.payment.id]), 0);
    return { enrollmentId: p.id, ledgerId: received.data.ledgerId, reviewId: review.id, ownerId: review.owner_id, matchCount: 0, reviewJob: outcome, counts: actual };
  });
  await test("WF07-CANCEL-VS-MATCHED-MONEY", "Cancellation and money race rechecks durable match: paid confirmation wins safely without releasing committed entitlement", async () => {
    const p = await purchase(await selection()), row = await api("enrollment", `/api/v1/enrollments/${p.id}`, "GET", undefined, staff.accessToken);
    const [cancelRequest, received] = await Promise.all([api("enrollment", `/api/v1/enrollments/${p.id}/cancel`, "POST", { version: row.version, reason: "DEMO cancellation racing verified incoming money" }, staff.accessToken, 202, randomUUID()), webhook(p.payment)]);
    assert(received.data.matchRef); const cancelCtx = await claim("WF-07"), payCtx = await claim("WF-06"); assert.equal(cancelCtx.job.entity.id, p.id); assert.equal(payCtx.job.entity.id, p.id);
    await Promise.all([step(cancelCtx, "payment.execute", "payment", paymentRoute(p, "close"), { reason: "CANCEL" }), step(payCtx, "enrollment.execute", "enrollment", route(p, "confirming"))]);
    const cancellation = (await step(cancelCtx, "enrollment.execute", "enrollment", route(p, "cancel"))).data; assert.equal(cancellation.status, "CONFIRMING");
    await step(cancelCtx, "classes.enroll", "class-schedule", seatRoute(p, "release"), {}, 409);
    await step(payCtx, "classes.enroll", "class-schedule", seatRoute(p, "commit"), { matchRef: received.data.matchRef }); await step(payCtx, "enrollment.execute", "enrollment", route(p, "confirm"));
    await finish(payCtx); await finish(cancelCtx); const actual = await counts(p); assert.equal(actual.ledger, 1); assert.equal(actual.committed, 1); assert.equal(actual.confirmedEvents, 1);
    return { enrollmentId: p.id, cancellationId: cancelRequest.id, matchRef: received.data.matchRef, ledgerId: received.data.ledgerId, paymentJob: refs(payCtx), cancellationJob: refs(cancelCtx), counts: actual };
  });
  await test("AUTH-RESOURCE-AUDIENCE-AND-STRICT-MUTATIONS", "Job-scoped domain authorization rejects another customer, human token, wrong audience and forged body fields", async () => {
    const p = await pending(await selection()), token = await authorize(p.ctx, "enrollment.execute");
    await request("enrollment", `/internal/enrollment/enrollments/${h.firstPurchase.id}/confirm`, "POST", {}, token, 403);
    await request("enrollment", route(p, "held"), "POST", { actorId: staff.id, branchId: branch }, token, 400);
    await request("enrollment", route(p, "held"), "POST", {}, staff.accessToken, 401);
    await request("payment", paymentRoute(p, "create"), "POST", {}, token, 401);
    await request("enrollment", `/api/v1/enrollments/${p.id}`, "GET", undefined, second.accessToken, 403);
    await request("enrollment", `/api/v1/enrollments/${p.id}`, "GET", undefined, outsider.accessToken, 403);
    const actual = await counts(p); assert.equal(actual.holds, 0); assert.equal(actual.qr, 0); await abandon(p);
    return { enrollmentId: p.id, ...refs(p.ctx), crossCustomerTarget: h.firstPurchase.id, authorityDenials: 5, strictPayloadRejections: 1, countsBeforeCompensation: actual };
  });
  await test("AUTH-STALE-LEASE-DONE-OLD-VERSION-REDELIVERY", "Expired worker and DONE job cannot write; reclaim keeps operation identity and broker replay never creates a second job/version", async () => {
    const p = await pending(await selection()), token = await authorize(p.ctx, "enrollment.execute"), original = refs(p.ctx);
    await db["automation-bridge"].query("UPDATE automation_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [p.ctx.job.jobId]);
    await request("enrollment", route(p, "held"), "POST", {}, token, 409); assert.equal((await counts(p)).holds, 0);
    const reclaimed = await claim("WF-05"); assert.equal(reclaimed.job.jobId, p.ctx.job.jobId); assert.equal(reclaimed.job.attempt, p.ctx.job.attempt + 1); p.ctx = reclaimed;
    const fresh = await authorize(reclaimed, "enrollment.execute"); await abandon(p);
    await request("enrollment", route(p, "held"), "POST", {}, fresh, 409);
    const event = (await one(db.enrollment, "SELECT event FROM event_outbox WHERE id=$1", [p.source.event_id])).event;
    const broker = await connectBroker(h.runtime.RABBITMQ_URL, () => {}); try { await broker.publish(event); } finally { await broker.close(); }
    await h.eventually(async () => await integer(db["automation-bridge"], "SELECT count(*)::int AS n FROM event_inbox WHERE id=$1 AND status='DONE'", [event.id]) === 1, "Original event remains durably deduplicated");
    assert.equal(await integer(db["automation-bridge"], "SELECT count(*)::int AS n FROM automation_jobs WHERE event_id=$1", [event.id]), 1);
    const machine = await workflowToken("WF-05"); assert.equal(await api("automation-bridge", "/internal/automation/jobs/claim", "POST", { workflowId: "WF-05", workflowVersion: 2 }, machine), null); assert.equal(await api("automation-bridge", "/internal/automation/jobs/claim", "POST", { workflowId: "WF-05", workflowVersion: 1 }, machine), null);
    return { enrollmentId: p.id, sourceEventId: event.id, original, reclaimed: refs(reclaimed), jobsForSourceEvent: 1, workflowVersion2Claims: 0, counts: await counts(p) };
  });
  await test("AUTH-CONTEXT-REVOKED-AFTER-TOKEN", "Revocation after command token issuance prevents enrollment creation with no money/seat effects", async () => {
    const p = await preview(await selection()), source = await confirm(p), ctx = await claim("WF-05"); assert.equal(ctx.job.entity.id, source.enrollment_id);
    const token = await authorize(ctx, "enrollment.execute"); await h.iamCall(`/internal/iam/delegations/${source.context_id}/revoke`, {}, staff.accessToken);
    await request("enrollment", `/internal/enrollment/enrollments/${source.enrollment_id}/create`, "POST", {}, token, 403); const actual = await counts({ id: source.enrollment_id }); assert.equal(actual.orders, 0); assert.equal(actual.holds, 0); assert.equal(actual.qr, 0); await finish(ctx);
    return { confirmationId: p.id, enrollmentId: source.enrollment_id, contextRef: source.context_id, ...refs(ctx), counts: actual };
  });
  await test("AUTH-MACHINE-EXPIRY-ROTATE-REVOKE", "Fresh test principal expiry, rotation and revocation invalidate old credentials without touching the workflow worker", async () => {
    const id = randomUUID(), client = await h.iamCall("/internal/iam/principals", { id, grants: [{ audience: "automation-bridge", scopes: ["automation:authorize"] }], workflows: ["WF-05"] }, h.operator.accessToken);
    const issue = (clientSecret, ttlSeconds) => request("identity", "/internal/iam/machine/token", "POST", { clientId: id, clientSecret, audience: "automation-bridge", scopes: ["automation:authorize"], workflows: ["WF-05"], ttlSeconds }, "", null);
    const probe = token => request("identity", "/internal/iam/machine/introspect", "POST", { audience: "automation-bridge", scope: "automation:authorize" }, token, null);
    const expiring = await issue(client.clientSecret, 1); assert.equal(expiring.status, 200);
    await sleep(1200); assert.equal((await probe(expiring.data.accessToken)).status, 401);
    const old = await issue(client.clientSecret, 300), rotated = await h.iamCall(`/internal/iam/principals/${id}/rotate`, {}, h.operator.accessToken);
    assert.equal((await probe(old.data.accessToken)).status, 401); assert.equal((await issue(client.clientSecret, 300)).status, 401);
    const current = await issue(rotated.clientSecret, 300); assert.equal(current.status, 200); assert.equal((await probe(current.data.accessToken)).status, 200);
    await h.iamCall(`/internal/iam/principals/${id}/revoke`, {}, h.operator.accessToken); assert.equal((await probe(current.data.accessToken)).status, 401); assert.equal((await issue(rotated.clientSecret, 300)).status, 401);
    return { principalId: id, expiredTokenStatus: 401, preRotationTokenStatus: 401, preRotationSecretStatus: 401, newCredentialStatusBeforeRevoke: 200, revokedTokenStatus: 401, revokedSecretStatus: 401, mainWorkerUnchanged: true };
  });
  await test("RECOVERY-PAYMENT-SERVICE-OUTAGE-AFTER-QR-COMMIT", "Payment process outage after durable QR creation preserves hold/QR; recovery looks up same request before completing enrollment checkpoint", async () => {
    const p = await pending(await selection()); await step(p.ctx, "classes.enroll", "class-schedule", seatRoute(p, "hold")); await step(p.ctx, "enrollment.execute", "enrollment", route(p, "held"));
    p.payment = (await step(p.ctx, "payment.execute", "payment", paymentRoute(p, "create"))).data;
    const owned = h.services.get("payment"); assert(owned && owned.exitCode === null && owned.signalCode === null, "Only this runtime's Payment process may be stopped");
    const fixtures = JSON.parse(await readFile(path.join(h.directory, "fixture-credentials-private.json"), "utf8"));
    await new Promise((resolve, reject) => { owned.once("exit", resolve); owned.once("error", reject); owned.kill("SIGKILL"); });
    await step(p.ctx, "enrollment.execute", "enrollment", route(p, "payment"), {}, 503);
    const during = await counts(p); assert.equal(during.held, 1); assert.equal(during.qr, 1); const row = await one(db.enrollment, "SELECT status,payment_id FROM enrollments WHERE id=$1", [p.id]); assert.equal(row.status, "HELD"); assert.equal(row.payment_id, null);
    await h.startService("payment", { SOURCE_CLIENT_ID: fixtures.sourcePayment.id, SOURCE_CLIENT_SECRET: fixtures.sourcePayment.clientSecret, REVIEW_OWNER_ID: accountant.id });
    const paymentToken = await authorize(p.ctx, "payment.execute"), lookup = await api("payment", `/internal/payment/enrollments/${p.id}`, "GET", undefined, paymentToken); assert.equal(lookup.id, p.payment.id);
    await step(p.ctx, "enrollment.execute", "enrollment", route(p, "payment")); await finish(p.ctx); await cancel(p);
    return { enrollmentId: p.id, paymentRequestId: lookup.id, fault: "OWNED_PAYMENT_PROCESS_KILLED_AFTER_DURABLE_CREATE", ...refs(p.ctx), countsDuringOutage: during, lookupBeforeRetry: true, originalQrPreserved: true };
  });
}
