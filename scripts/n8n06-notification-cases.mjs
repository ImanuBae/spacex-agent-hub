/* global fetch, AbortSignal */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { connectBroker } from "@spacex/messaging";

export async function runN8n06NotificationCases(t) {
  const { h, test, api, request, customer, offer, purchase, webhook, claim, step, finish, staff, director, outsider,
    branch, student, confirmed, adjustment, waitDone } = t;
  const database = h.pools.notification;
  async function intent(enrollmentId, template, newerThan = 0) {
    let row;
    await h.eventually(async () => {
      row = (await database.query(`SELECT * FROM notification_intents WHERE enrollment_id=$1 AND template=$2
        AND source_version>$3 ORDER BY source_version DESC,due_at LIMIT 1`, [enrollmentId, template, newerThan])).rows[0];
      return !!row;
    }, `${template} intent for owned fixture`);
    return row;
  }
  const current = async id => (await database.query("SELECT * FROM notification_intents WHERE id=$1", [id])).rows[0];
  async function mailCounts(id) {
    return (await database.query(`SELECT (SELECT count(*)::int FROM notification_mailbox WHERE intent_id=$1) AS mail,
      (SELECT count(*)::int FROM notification_portal_messages WHERE intent_id=$1) AS portal`, [id])).rows[0];
  }
  async function requestOtp(email) {
    const challengeSessionId = randomUUID(), purpose = "STUDENT_LOGIN";
    const { data, correlationId } = await request("identity", "/api/v1/auth/otp/request", "POST", { email, challengeSessionId, purpose }, "", 201);
    assert.equal(Object.hasOwn(data, "code"), false);
    const mail = (await database.query(`SELECT m.id,m.adapter,m.body,m.recipient FROM notification_mailbox m
      JOIN notification_intents i ON i.id=m.intent_id WHERE i.id=$1 AND i.template='OTP'`, [data.deliveryRef])).rows[0];
    assert(mail?.adapter === "SYNTHETIC_LOCAL_MAILBOX" && mail.recipient === email, "OTP receipt was written for the verified synthetic recipient");
    const code = /\b(\d{6})\b/.exec(mail.body)?.[1];
    assert(!!code, "Private local mailbox contains a six digit code");
    assert.deepEqual(await mailCounts(data.deliveryRef), { mail: 1, portal: 0 });
    return { input: { challengeId: data.challengeId, challengeSessionId, purpose, code }, deliveryRef: data.deliveryRef, receiptId: mail.id, correlationId };
  }
  const verifyOtp = (input, expected) => request("identity", "/api/v1/auth/otp/verify", "POST", input, "", expected);
  const challenge = async id => (await h.pools.identity.query("SELECT code_hash,failures,consumed_at FROM otp_challenges WHERE id=$1", [id])).rows[0];
  const consent = (learnerId, status) => api("crm", `/api/v1/crm/people/${learnerId}/consents`, "POST", {
    purpose: "COURSE_NOTICES", status, statementVersion: "DEMO-WF10-v1", statementText: "Synthetic fixture consent for class notices", method: "WRITTEN",
  }, staff.accessToken, 201, randomUUID());
  await test("WF10-MATCH-NOT-CONFIRMED", "Payment match creates no learner confirmation intent while the authoritative seat is still HELD", async () => {
    const people = await customer(), selected = await offer();
    const p = await purchase({ ...people, classId: selected.classId, packageId: selected.packageId });
    const matched = await webhook(p.payment);
    const ctx = await claim("WF-06"); assert.equal(ctx.job.entity.id, p.id);
    const hold = (await h.pools["class-schedule"].query("SELECT status FROM holds WHERE enrollment_id=$1", [p.id])).rows[0];
    assert.equal(hold.status, "HELD");
    const matchEvent = (await h.pools.payment.query("SELECT id FROM event_outbox WHERE event->>'type'='payment.matched' AND event->>'entityId'=$1", [p.id])).rows[0];
    assert(matchEvent?.id, "Payment match producer recorded a durable match event");
    assert.equal(ctx.job.eventId, matchEvent.id);
    const count = Number((await database.query("SELECT count(*) FROM notification_intents WHERE enrollment_id=$1", [p.id])).rows[0].count);
    assert.equal(count, 0);
    await step(ctx, "enrollment.execute", "enrollment", `/internal/enrollment/enrollments/${p.id}/confirming`);
    await step(ctx, "classes.enroll", "class-schedule", `/internal/classes/enrollments/${p.id}/commit`, { matchRef: matched.data.matchRef });
    await step(ctx, "enrollment.execute", "enrollment", `/internal/enrollment/enrollments/${p.id}/confirm`);
    await finish(ctx);
    return { enrollmentId: p.id, paymentId: p.payment.id, holdStatus: hold.status, notificationCount: count, eventId: matchEvent.id, trace: matched.traceparent };
  });

  await test("WF10-CONFIRMED-MAIL-PORTAL", "One confirmed enrollment and committed seat produce one scoped Portal message and one durable local mail receipt", async () => {
    const enrolled = await confirmed();
    const id = enrolled.id, row = await intent(id, "ENROLLMENT_CONFIRMED"), job = await waitDone("WF-10", row.id);
    const saved = await current(row.id), confirmations = (await h.pools.enrollment.query(`SELECT id,event FROM event_outbox
      WHERE event->>'type'='enrollment.confirmed' AND event->>'entityId'=$1`, [id])).rows;
    assert.equal(saved.status, "SENT"); assert(saved.receipt_id);
    assert.equal(confirmations.length, 1); assert.equal(saved.source_event_id, confirmations[0].id);
    const seat = (await h.pools["class-schedule"].query("SELECT status,class_id FROM holds WHERE id=$1", [confirmations[0].event.payload.holdId])).rows[0];
    assert.equal(seat.status, "COMMITTED"); assert.equal(seat.class_id, enrolled.selection.classId);
    const own = await api("notification", "/api/v1/notifications", "GET", undefined, enrolled.student.accessToken);
    assert(own.some(message => message.intentId === row.id && message.subject === "Xác nhận đăng ký học"));
    assert.equal(own.some(message => message.subject === "Mã đăng nhập học viên"), false);
    await request("notification", "/api/v1/notifications", "GET", undefined, "", 401);
    const outside = await api("notification", "/api/v1/notifications", "GET", undefined, outsider.accessToken);
    assert.equal(outside.some(message => message.id === row.id), false);
    const counts = await mailCounts(row.id); assert.deepEqual(counts, { mail: 1, portal: 1 });
    return { enrollmentId: id, classId: seat.class_id, intentId: row.id, receiptId: saved.receipt_id, sourceVersion: saved.source_version,
      sourceEventId: confirmations[0].id, trace: job, counts };
  });

  await test("WF10-OTP-RATE-RACE-REPLAY", "OTP scope rejects the wrong browser, locks after five failures, consumes once under concurrency, and limits issuance", async () => {
    const people = await customer(), otherLearner = await student(people.learnerId);
    const locked = await requestOtp(otherLearner.email), forcedWrong = locked.input.code === "000000" ? "000001" : "000000";
    await verifyOtp({ ...locked.input, challengeSessionId: randomUUID() }, 401);
    assert.equal((await challenge(locked.input.challengeId)).failures, 0);
    for (let i = 0; i < 5; i++) await verifyOtp({ ...locked.input, code: forcedWrong }, 401);
    await verifyOtp(locked.input, 401);
    const lockedRow = await challenge(locked.input.challengeId);
    assert.equal(lockedRow.failures, 5); assert.equal(lockedRow.consumed_at, null);
    assert(lockedRow.code_hash.length === 64 && lockedRow.code_hash !== locked.input.code, "IAM persisted a keyed verifier, not the code");
    const race = await requestOtp(otherLearner.email);
    const outcomes = await Promise.all([verifyOtp(race.input, null), verifyOtp(race.input, null)]);
    assert.deepEqual(outcomes.map(outcome => outcome.status).sort(), [200, 401]);
    const successful = outcomes.find(outcome => outcome.status === 200);
    assert.equal(successful.data.user.id, otherLearner.id);
    assert.equal(successful.data.user.role, "student");
    assert((await challenge(race.input.challengeId)).consumed_at);
    await verifyOtp(race.input, 401);
    await request("identity", "/api/v1/auth/otp/request", "POST", { email: otherLearner.email, purpose: "STUDENT_LOGIN", challengeSessionId: randomUUID() }, "", 429);
    return { learnerId: people.learnerId, lockedChallengeId: locked.input.challengeId, consumedChallengeId: race.input.challengeId,
      receiptIds: [locked.receiptId, race.receiptId], correlationIds: [locked.correlationId, race.correlationId], failures: lockedRow.failures, outcomes: outcomes.map(o => o.status) };
  });

  await test("WF10-OTP-EXPIRY-OWNERSHIP", "Expired OTP fails at IAM and a different authenticated learner cannot read enrollment, schedule, or invoice by ID", async () => {
    const enrolled = await confirmed(), otherLearner = await student((await customer()).learnerId);
    const expired = await requestOtp(enrolled.student.email);
    // Advance this challenge's server-side deadline as synthetic input. No delivery or consume result is inserted by the assertion.
    await h.pools.identity.query("UPDATE otp_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [expired.input.challengeId]);
    await verifyOtp(expired.input, 401);
    assert.equal((await challenge(expired.input.challengeId)).consumed_at, null);
    const id = enrolled.id, ownToken = enrolled.student.accessToken, otherToken = otherLearner.accessToken;
    assert.equal((await api("enrollment", `/api/v1/student/enrollments/${id}`, "GET", undefined, ownToken)).id, id);
    const other = await request("enrollment", `/api/v1/student/enrollments/${id}`, "GET", undefined, otherToken, null);
    assert([403, 404].includes(other.status));
    const schedulePath = `/api/v1/student/class-schedule/${id}`;
    const schedule = await api("class-schedule", schedulePath, "GET", undefined, ownToken);
    assert.equal(schedule.classId, enrolled.selection.classId); assert(schedule.onlineUrl?.startsWith("https://"));
    const guessed = await request("class-schedule", schedulePath, "GET", undefined, otherToken, null);
    assert([403, 404].includes(guessed.status)); assert.equal(guessed.data, undefined);
    const invoice = await api("payment", "/api/v1/student/invoices", "POST", { enrollmentId: id, recipientName: "Học viên <DEMO>", address: "Địa chỉ tổng hợp" }, ownToken, 201, randomUUID());
    const download = token => fetch(`${h.urls.payment}/api/v1/student/invoices/${invoice.id}/download`, { headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(5000) });
    const file = await download(ownToken), bytes = await file.text();
    assert.equal(file.status, 200);
    assert(file.headers.get("content-disposition")?.startsWith("attachment;"));
    assert(bytes.includes("MÔ PHỎNG — KHÔNG CÓ GIÁ TRỊ PHÁP LÝ") && bytes.includes("&lt;DEMO&gt;"));
    assert.equal((await download(otherToken)).status, 404);
    const portal = await api("notification", "/api/v1/notifications", "GET", undefined, otherToken);
    const confirmation = await intent(id, "ENROLLMENT_CONFIRMED");
    assert.equal(portal.some(message => message.intentId === confirmation.id), false);
    return { enrollmentId: id, classId: schedule.classId, invoiceId: invoice.id, fileHash: createHash("sha256").update(bytes).digest("hex"),
      challengeId: expired.input.challengeId, deliveryRef: expired.deliveryRef, crossLearner: { enrollment: other.status, schedule: guessed.status, invoice: 404 } };
  });

  async function prepareManualReminder() {
    const fixture = await confirmed({ mapped: false }), p = await intent(fixture.id, "ENROLLMENT_CONFIRMED");
    await h.eventually(async () => (await current(p.id)).status === "FAILED", "Unmapped enrollment delivery gets an owned failure");
    assert.equal((await current(p.id)).error_code, "RECIPIENT_UNVERIFIED");
    const owner = await student(fixture.selection.learnerId);
    const schedule = await api("class-schedule", `/api/v1/classes/${fixture.selection.classId}`, "GET", undefined, staff.accessToken);
    const input = { enrollmentId: fixture.id, template: "REMINDER", sourceVersion: schedule.version, dueAt: new Date(Date.now() + 7000).toISOString() };
    const row = await api("notification", "/api/v1/notifications", "POST", input, staff.accessToken, 201);
    return { fixture, owner, input, row };
  }

  await test("WF10-CONSENT-DEDUP-REMINDER", "Duplicate reminder keeps one intent and later consent withdrawal blocks both deliveries", async () => {
    const { fixture, input, row } = await prepareManualReminder();
    const repeated = await api("notification", "/api/v1/notifications", "POST", input, staff.accessToken, 201);
    assert.equal(repeated.id, row.id);
    await request("notification", "/api/v1/notifications", "POST", { ...input, dueAt: new Date(Date.parse(input.dueAt) + 1000).toISOString() }, staff.accessToken, 409);
    const revoked = await consent(fixture.selection.learnerId, "REVOKED"), job = await waitDone("WF-10", row.id);
    const saved = await current(row.id);
    assert.equal(saved.status, "SUPERSEDED"); assert.equal(saved.error_code, "CONSENT_WITHDRAWN");
    const counts = await mailCounts(row.id); assert.deepEqual(counts, { mail: 0, portal: 0 });
    return { enrollmentId: fixture.id, intentId: row.id, consentId: revoked.id, trace: job, counts, status: saved.status, attempts: saved.attempts };
  });

  for (const expected of [
    { mode: "REJECT", status: "FAILED", attempts: 1, delivery: 0, error: "ADAPTER_REJECTED" },
    { mode: "TIMEOUT_BEFORE", status: "SENT", attempts: 2, delivery: 1, error: null },
    { mode: "TIMEOUT_AFTER", status: "SENT", attempts: 1, delivery: 1, error: null },
    { mode: "UNKNOWN_NO_LOOKUP", status: "UNKNOWN", attempts: 1, delivery: 0, error: "ADAPTER_UNCERTAIN" },
  ]) {
    await test(`WF10-ADAPTER-${expected.mode}`, `Real n8n and the synthetic mailbox preserve ${expected.status} and ${expected.delivery} receipts after ${expected.mode}`, async () => {
      const { fixture, row } = await prepareManualReminder();
      await api("notification", `/internal/notification/intents/${row.id}/test-fault`, "POST", { mode: expected.mode }, undefined, 200);
      const job = await waitDone("WF-10", row.id, expected.mode === "UNKNOWN_NO_LOOKUP" ? "DEAD" : "DONE");
      const saved = await current(row.id), counts = await mailCounts(row.id), attempts = (await database.query(`SELECT number,outcome,job_id AS "jobId"
        FROM notification_attempts WHERE intent_id=$1 ORDER BY number`, [row.id])).rows;
      assert.equal(saved.status, expected.status); assert.equal(saved.attempts, expected.attempts); assert.equal(saved.error_code, expected.error);
      assert(saved.owner_id); assert.equal(!!saved.receipt_id, !!expected.delivery);
      assert.deepEqual(counts, { mail: expected.delivery, portal: expected.delivery });
      assert.equal(attempts.length, expected.attempts);
      if (expected.mode === "TIMEOUT_BEFORE") assert.deepEqual(attempts.map(a => a.outcome), ["ADAPTER_TIMEOUT_BEFORE", "SENT"]);
      if (expected.mode === "TIMEOUT_AFTER") assert.equal(attempts[0].outcome, "ADAPTER_RESPONSE_LOST");
      return { enrollmentId: fixture.id, intentId: row.id, receiptId: saved.receipt_id, ownerId: saved.owner_id,
        attempts, status: saved.status, trace: job, counts };
    });
  }

  await test("WF10-CLASS-VERSION-ORDER", "WF08 apply supersedes old reminder, delivers one correction, and an old schedule event cannot recreate the old version", async () => {
    const enrolled = await confirmed();
    const classId = enrolled.selection.classId, oldReminder = await intent(enrolled.id, "REMINDER");
    const course = await api("class-schedule", `/api/v1/classes/${classId}`, "GET", undefined, director.accessToken);
    const teacherAccount = await api("identity", "/api/v1/accounts", "POST", { email: `${randomUUID()}@automation.test`, password: randomBytes(32).toString("hex"), name: "WF10 synthetic teacher", role: "teacher" }, undefined, 201);
    const teacher = await api("org", "/api/v1/employees", "POST", { accountId: teacherAccount.id, branchId: branch, name: "WF10 synthetic teacher", teacherProfile: "Course notices fixture" }, undefined, 201);
    const { code, name, courseId, packageId, branchId, mode, roomId, onlineUrl, capacity, minimumSize, registrationClosesAt, decisionAt } = course;
    const sessions = course.sessions.map(s => ({ startsAt: new Date(Date.parse(s.startsAt) + 3600000).toISOString(), endsAt: new Date(Date.parse(s.endsAt) + 3600000).toISOString() }));
    const plan = await api("class-schedule", "/api/v1/class-changes", "POST", { classId, classVersion: course.version, kind: "RESCHEDULE", reason: "WF10 synthetic later start",
      input: { code, name, courseId, packageId, branchId, teacherId: teacher.id, mode, roomId, onlineUrl, capacity, minimumSize, registrationClosesAt, decisionAt, sessions } }, director.accessToken, 201, randomUUID());
    const approved = await api("class-schedule", `/api/v1/class-changes/${plan.id}/decision`, "POST", { version: plan.version, status: "APPROVED", reason: "Independent WF10 schedule approval" });
    await api("enrollment", `/api/v1/student/class-changes/${plan.id}/choice`, "POST", { enrollmentId: enrolled.id, version: approved.version, accepted: true }, enrolled.student.accessToken);
    const scheduleTrace = await waitDone("WF-08", plan.id), saved = await current(oldReminder.id);
    const correction = await intent(enrolled.id, "CLASS_CHANGED", oldReminder.source_version);
    const deliveryTrace = await waitDone("WF-10", correction.id);
    assert.equal((await current(oldReminder.id)).status, "SUPERSEDED");
    assert.equal((await current(correction.id)).status, "SENT");
    assert.deepEqual(await mailCounts(oldReminder.id), { mail: 0, portal: 0 });
    assert.deepEqual(await mailCounts(correction.id), { mail: 1, portal: 1 });
    const broker = await connectBroker(h.runtime.RABBITMQ_URL, () => {});
    const eventId = randomUUID(), previousVersion = saved.source_version;
    try {
      await broker.publish({ id: eventId, type: "class.schedule_changed", version: 1, occurredAt: new Date().toISOString(), correlationId: plan.id,
        entityId: classId, entityVersion: previousVersion, payload: { targetId: classId, classId, branchId: branch, sourceVersion: previousVersion, status: "OPEN" } });
    } finally { await broker.close(); }
    await h.eventually(async () => (await database.query("SELECT status FROM event_inbox WHERE id=$1 AND consumer='notification.course.v1'", [eventId])).rows[0]?.status === "DONE", "Notification consumes stale scheduled event through broker");
    const count = Number((await database.query("SELECT count(*) FROM notification_intents WHERE enrollment_id=$1 AND template='CLASS_CHANGED'", [enrolled.id])).rows[0].count);
    assert.equal(count, 1);
    return { classId, enrollmentId: enrolled.id, planId: plan.id, previousVersion, sourceVersion: correction.source_version, oldReminderId: oldReminder.id,
      correctionId: correction.id, staleEventId: eventId, correctionCount: count, scheduleTrace, deliveryTrace };
  });

  await test("WF10-TRANSFER-MEMBERSHIP", "A committed target entitlement moves reminders to the new class and preserves original sent receipts", async () => {
    const enrolled = await confirmed();
    const oldClassId = enrolled.selection.classId, target = await offer(), original = await intent(enrolled.id, "ENROLLMENT_CONFIRMED");
    await waitDone("WF-10", original.id);
    const plan = await adjustment(enrolled, { target });
    const transferTrace = await waitDone("WF-09", plan.id), notice = await intent(enrolled.id, "ENTITLEMENT_CHANGED");
    const deliveryTrace = await waitDone("WF-10", notice.id);
    const membership = (await database.query("SELECT class_id,entitlement_version,state FROM notification_memberships WHERE enrollment_id=$1", [enrolled.id])).rows[0];
    assert.equal(membership.class_id, target.classId); assert.equal(membership.state, "ACTIVE");
    assert.equal(membership.entitlement_version, notice.source_version);
    const reminders = (await database.query("SELECT id,class_id,status FROM notification_intents WHERE enrollment_id=$1 AND template='REMINDER'", [enrolled.id])).rows;
    assert(reminders.some(row => row.class_id === target.classId && row.status === "WAITING"));
    assert(reminders.every(row => row.class_id !== oldClassId || row.status === "SUPERSEDED"));
    assert.equal((await current(original.id)).status, "SENT");
    assert.deepEqual(await mailCounts(original.id), { mail: 1, portal: 1 });
    assert.deepEqual(await mailCounts(notice.id), { mail: 1, portal: 1 });
    return { enrollmentId: enrolled.id, adjustmentId: plan.id, noticeId: notice.id, originalIntentId: original.id,
      sourceEventId: notice.source_event_id, transferTrace, deliveryTrace, oldClassId, targetClassId: target.classId, membership, reminders };
  });
}
