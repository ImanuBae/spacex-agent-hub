import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const plans = "/api/v1/class-changes";
const day = 86400000,
  hour = 3600000;
const shifted = (time, amount) => new Date(Date.parse(time) + amount).toISOString();

export async function runN8n06ClassCases(t) {
  const {
    h,
    test,
    api,
    request,
    offer,
    staff,
    director,
    otherDirector,
    branch,
    waitDone,
    jobFor,
    confirmed,
    adjustment,
    customer,
    purchase,
    webhook,
    claim,
    step,
    finish,
    accountant,
    password,
  } = t;
  const db = h.pools["class-schedule"],
    admin = h.operator.accessToken;
  const cls = (id) => api("class-schedule", `/api/v1/classes/${id}`);
  const detail = (id) => api("class-schedule", `${plans}/${id}`);
  const create = (row, kind, input, extra = {}, actor = admin) =>
    api(
      "class-schedule",
      plans,
      "POST",
      {
        classId: row.id,
        classVersion: row.version,
        kind,
        reason: "DEMO approved schedule operation",
        ...(input ? { input } : {}),
        ...extra,
      },
      actor,
      201,
      randomUUID(),
    );
  const decide = (plan, actor = director.accessToken, expected = 200) =>
    request(
      "class-schedule",
      `${plans}/${plan.id}/decision`,
      "POST",
      {
        version: plan.version,
        status: "APPROVED",
        reason: "DEMO independent schedule decision",
      },
      actor,
      expected,
    );
  const decisions = (id) =>
    db.query("SELECT action,version FROM class_change_decisions WHERE change_id=$1 ORDER BY version", [id]);
  const wait = async (id) => {
    let job;
    await h.eventually(async () => {
      job = await jobFor("WF-08", id);
      return job.status === "WAITING";
    }, "Class plan waits for Enrollment");
    assert.equal((await detail(id)).result.status, "WAITING");
    return { jobId: job.id ?? job.jobId, eventId: job.event_id ?? job.eventId };
  };
  const scheduleEvents = async (id, type) =>
    (
      await db.query(
        "SELECT id,event FROM event_outbox WHERE event->>'type'=$1 AND event->>'entityId'=$2 ORDER BY created_at",
        [type, id],
      )
    ).rows;
  async function teacher() {
    const email = `teacher-${randomUUID()}@automation.test`;
    const account = await api(
      "identity",
      "/api/v1/accounts",
      "POST",
      { email, password, role: "teacher", name: "WF08 synthetic teacher" },
      admin,
      201,
    );
    await api(
      "identity",
      `/api/v1/accounts/${account.id}/access`,
      "PUT",
      { role: "teacher", branchIds: [branch] },
      admin,
      200,
      randomUUID(),
    );
    const employee = await api(
      "org",
      "/api/v1/employees",
      "POST",
      {
        accountId: account.id,
        branchId: branch,
        name: "WF08 synthetic teacher",
        teacherProfile: "Synthetic scheduling fixture",
      },
      admin,
      201,
    );
    return {
      ...employee,
      ...(await h.iamCall("/api/v1/auth/login", { email, password })),
    };
  }
  function schedule(row, teacherId, changes = {}) {
    const keys = [
      "code",
      "name",
      "courseId",
      "packageId",
      "branchId",
      "mode",
      "roomId",
      "onlineUrl",
      "capacity",
      "minimumSize",
      "registrationClosesAt",
      "decisionAt",
      "sessions",
    ];
    return {
      ...Object.fromEntries(keys.map((k) => [k, row[k]])),
      teacherId,
      ...changes,
    };
  }
  async function ownedClass(instructor, moveDays = 0) {
    const row = await cls((await offer()).classId);
    const input = schedule(row, instructor.id, {
      code: `WF08-${randomUUID()}`,
      sessions: row.sessions.map((s) => ({
        startsAt: shifted(s.startsAt, moveDays * day),
        endsAt: shifted(s.endsAt, moveDays * day),
      })),
    });
    return api("class-schedule", "/api/v1/classes", "POST", input, admin, 201);
  }

  await test(
    "WF08-APPROVAL-AND-HISTORY",
    "Only an independent same-branch director may approve a versioned cancellation; WF08 keeps old sessions and emits one versioned event",
    async () => {
      const row = await cls((await offer()).classId);
      const plan = await create(row, "CANCEL");
      assert.equal(plan.status, "REQUESTED");
      assert.equal((await decide(plan, admin, 403)).body.error.code, "FORBIDDEN");
      assert.equal((await decide(plan, otherDirector.accessToken, 403)).body.error.code, "FORBIDDEN");
      await request(
        "class-schedule",
        `${plans}/${plan.id}/decision`,
        "POST",
        {
          version: plan.version,
          status: "APPROVED",
          reason: "DEMO forged approver",
          approverId: director.id,
        },
        director.accessToken,
        400,
      );
      assert.equal((await decisions(plan.id)).rowCount, 0);
      const approval = await decide(plan);
      assert.equal(approval.data.status, "APPROVED");
      const execution = await waitDone("WF-08", plan.id),
        after = await cls(row.id);
      const history = (
        await db.query("SELECT id,active,retired_revision FROM sessions WHERE class_id=$1", [row.id])
      ).rows;
      const events = await scheduleEvents(row.id, "class.cancelled");
      assert.equal(after.status, "CANCELLED");
      assert.equal(after.version, row.version + 1);
      assert.deepEqual(after.sessions, row.sessions);
      assert.equal(history.length, row.sessions.length);
      assert(history.every((s) => !s.active && s.retired_revision === after.version));
      assert.equal(events.length, 1);
      assert.equal(events[0].event.entityVersion, after.version);
      assert.equal(events[0].event.causationId, execution.eventId);
      assert.equal(events[0].event.correlationId, plan.id);
      assert.deepEqual(
        (await decisions(plan.id)).rows.map((d) => d.action),
        ["APPROVED", "EXECUTED"],
      );
      return {
        planId: plan.id,
        classId: row.id,
        version: after.version,
        correlationId: approval.correlationId,
        businessEventId: events[0].id,
        sessionIds: history.map((s) => s.id),
        execution,
      };
    },
  );

  await test(
    "WF08-STALE-BEFORE-APPROVAL",
    "A class version change prevents approval of the old impact plan and emits no automation job",
    async () => {
      const row = await cls((await offer({ status: "DRAFT" })).classId),
        plan = await create(row, "CANCEL");
      await api(
        "class-schedule",
        `/api/v1/classes/${row.id}/status`,
        "POST",
        { version: row.version, status: "PLANNED" },
        director.accessToken,
      );
      const rejection = await decide(plan, director.accessToken, 409);
      assert.equal(rejection.body.error.code, "STALE_IMPACT");
      assert.equal(
        (
          await db.query(
            "SELECT 1 FROM event_outbox WHERE event->>'type'='class.change.approved' AND event->>'entityId'=$1",
            [plan.id],
          )
        ).rowCount,
        0,
      );
      assert.equal((await detail(plan.id)).status, "REQUESTED");
      return {
        planId: plan.id,
        classId: row.id,
        errorCode: rejection.body.error.code,
        traceparent: rejection.traceparent,
      };
    },
  );

  await test(
    "WF08-LEARNER-CHOICE",
    "A committed learner's verified choice permits a revised schedule. The same seat and immutable snapshot survive postponement, and the join link is unavailable until the class reopens",
    async () => {
      const registration = await confirmed(),
        instructor = await teacher(),
        row = await cls(registration.selection.classId);
      const sessions = row.sessions.map((s) => ({
        startsAt: shifted(s.startsAt, day),
        endsAt: shifted(s.endsAt, day),
      }));
      const plan = await create(row, "RESCHEDULE", schedule(row, instructor.id, { sessions }));
      assert.equal(plan.impact.holds.length, 1);
      assert.equal(plan.impact.enrollments[0].enrollmentId, registration.id);
      const { data: approved } = await decide(plan);
      const waiting = await wait(plan.id);
      const path = `/api/v1/student/class-changes/${plan.id}/choice`,
        token = registration.student.accessToken;
      const choice = {
        enrollmentId: registration.id,
        version: approved.version,
        accepted: true,
      };
      assert.equal((await cls(row.id)).version, row.version);
      await request("enrollment", path, "POST", choice, staff.accessToken, 403);
      await request("enrollment", path, "POST", { ...choice, version: plan.version }, token, 409);
      const accepted = await request("enrollment", path, "POST", choice, token);
      assert.equal(accepted.data.accepted, true);
      const execution = await waitDone("WF-08", plan.id),
        after = await cls(row.id);
      assert.equal(after.version, row.version + 1);
      assert.deepEqual(after.sessions, sessions);
      const beforeSnapshot = registration.record.snapshot;
      const enrollment = (
        await h.pools.enrollment.query("SELECT snapshot,status FROM enrollments WHERE id=$1", [
          registration.id,
        ])
      ).rows[0];
      assert.deepEqual(enrollment.snapshot, beforeSnapshot);
      assert.equal(enrollment.status, "CONFIRMED");
      const seat = (await db.query("SELECT id,status FROM holds WHERE enrollment_id=$1", [registration.id]))
        .rows[0];
      assert.equal(seat.status, "COMMITTED");
      const learner = await api(
        "class-schedule",
        `/api/v1/student/class-schedule/${registration.id}`,
        "GET",
        undefined,
        token,
      );
      assert.equal(learner.version, after.version);
      assert.deepEqual(learner.sessions, sessions);
      assert(learner.onlineUrl);
      const postponedSessions = sessions.map(s => ({ startsAt: shifted(s.startsAt, day), endsAt: shifted(s.endsAt, day) }));
      const postponed = await create(after, "POSTPONE", schedule(after, instructor.id, { sessions: postponedSessions }));
      const { data: postponedApproval } = await decide(postponed);
      await api("enrollment", `/api/v1/student/class-changes/${postponed.id}/choice`, "POST", { ...choice, version: postponedApproval.version }, token);
      const postponedExecution = await waitDone("WF-08", postponed.id);
      const postponedView = await api("class-schedule", `/api/v1/student/class-schedule/${registration.id}`, "GET", undefined, token);
      assert.equal(postponedView.status, "PLANNED");
      assert.equal(postponedView.onlineUrl, null);
      assert.deepEqual(postponedView.sessions, postponedSessions);
      return {
        planId: plan.id,
        enrollmentId: registration.id,
        holdId: seat.id,
        waiting,
        execution,
        postponedExecution,
        choiceTrace: accepted.traceparent,
        sourceVersion: after.version,
      };
    },
  );

  await test(
    "WF08-WF09-LINKED-CANCELLATION",
    "An approved class cancellation waits for an exact enrollment resolution. WF09 preserves the suspended entitlement and releases only its source seat before WF08 closes the class",
    async () => {
      const registration = await confirmed(),
        row = await cls(registration.selection.classId);
      const plan = await create(row, "CANCEL");
      const guarded = await request(
        "class-schedule",
        `/api/v1/classes/${row.id}/status`,
        "POST",
        {
          version: row.version,
          status: "CANCELLED",
          reason: "DEMO legacy denial",
        },
        director.accessToken,
        409,
      );
      assert.equal(guarded.body.error.code, "ENROLLMENT_REQUIRED");
      await decide(plan);
      const waiting = await wait(plan.id);
      const learnerToken = registration.student.accessToken;
      const studentEnrollment = await api(
        "enrollment",
        `/api/v1/student/enrollments/${registration.id}`,
        "GET",
        undefined,
        learnerToken,
      );
      const adjustment = await api(
        "enrollment",
        "/api/v1/adjustments",
        "POST",
        {
          enrollmentId: registration.id,
          type: "SUSPEND",
          version: studentEnrollment.currentEntitlement.version,
          classChangeId: plan.id,
          reason: "DEMO learner rights from linked class cancellation",
        },
        director.accessToken,
        201,
        randomUUID(),
      );
      const approved = await api(
        "enrollment",
        `/api/v1/adjustments/${adjustment.id}/approve`,
        "POST",
        { version: adjustment.version },
        admin,
      );
      await api(
        "enrollment",
        `/api/v1/adjustments/${adjustment.id}/choice`,
        "POST",
        { version: approved.version, accepted: true },
        learnerToken,
      );
      const adjustmentExecution = await waitDone("WF-09", adjustment.id),
        planExecution = await waitDone("WF-08", plan.id);
      const after = await cls(row.id),
        entitlement = (
          await h.pools.enrollment.query(
            "SELECT state,remaining_sessions,expires_at FROM enrollment_entitlements WHERE enrollment_id=$1",
            [registration.id],
          )
        ).rows[0];
      const seat = (await db.query("SELECT id,status FROM holds WHERE enrollment_id=$1", [registration.id]))
        .rows[0];
      assert.equal(after.status, "CANCELLED");
      assert.equal(seat.status, "CANCELLED");
      assert.equal(entitlement.state, "SUSPENDED");
      assert(entitlement.remaining_sessions > 0 && entitlement.expires_at > new Date());
      await request(
        "class-schedule",
        `/api/v1/student/class-schedule/${registration.id}`,
        "GET",
        undefined,
        learnerToken,
        403,
      );
      return {
        classId: row.id,
        planId: plan.id,
        adjustmentId: adjustment.id,
        enrollmentId: registration.id,
        holdId: seat.id,
        entitlement,
        waiting,
        adjustmentExecution,
        planExecution,
      };
    },
  );

  await test(
    "WF08-REGISTRATION-INTERLEAVING",
    "A new registration while an approved plan awaits learner choice invalidates that impact snapshot and preserves both committed seats",
    async () => {
      const first = await confirmed(),
        row = await cls(first.selection.classId),
        instructor = await teacher();
      const moved = row.sessions.map((s) => ({
        startsAt: shifted(s.startsAt, day),
        endsAt: shifted(s.endsAt, day),
      }));
      const plan = await create(row, "RESCHEDULE", schedule(row, instructor.id, { sessions: moved }));
      const { data: approved } = await decide(plan),
        waiting = await wait(plan.id);
      const added = await confirmed({ existingOffer: first.offer });
      assert.equal(added.selection.classId, row.id);
      assert.notEqual(added.id, first.id);
      await api(
        "enrollment",
        `/api/v1/student/class-changes/${plan.id}/choice`,
        "POST",
        { enrollmentId: first.id, version: approved.version, accepted: true },
        first.student.accessToken,
      );
      const execution = await waitDone("WF-08", plan.id, "DEAD"),
        failed = await detail(plan.id),
        current = await cls(row.id);
      assert.equal(failed.status, "FAILED");
      assert.equal(failed.result.errorCode, "STALE_IMPACT");
      assert.equal(current.version, row.version);
      assert.deepEqual(current.sessions, row.sessions);
      const seats = (await db.query("SELECT id,status FROM holds WHERE class_id=$1 ORDER BY id", [row.id]))
        .rows;
      assert.equal(seats.length, 2);
      assert(seats.every((s) => s.status === "COMMITTED"));
      assert.equal((await scheduleEvents(row.id, "class.schedule_changed")).length, 0);
      return {
        classId: row.id,
        planId: plan.id,
        priorEnrollmentId: first.id,
        newEnrollmentId: added.id,
        seats,
        waiting,
        execution,
        errorCode: failed.result.errorCode,
      };
    },
  );

  await test(
    "WF08-CANCEL-VS-REGISTRATION-COMMIT",
    "A purchase already HELD at cancellation can commit while the affected learner's refund is processed. The stale cancellation preserves the new registration.",
    async () => {
      const first = await confirmed(), row = await cls(first.selection.classId);
      const pending = await purchase({ ...await customer(), classId: row.id, packageId: first.selection.packageId });
      const plan = await create(row, "CANCEL");
      assert.deepEqual(plan.impact.holds.map(seat => seat.status).sort(), ["COMMITTED", "HELD"]);
      await decide(plan);
      const waiting = await wait(plan.id);
      const matched = await webhook(pending.payment), registration = await claim("WF-06");
      assert.equal(registration.job.entity.id, pending.id);
      await step(registration, "enrollment.execute", "enrollment", `/internal/enrollment/enrollments/${pending.id}/confirming`);
      await step(registration, "classes.enroll", "class-schedule", `/internal/classes/enrollments/${pending.id}/commit`, { matchRef: matched.data.matchRef });
      const [refund] = await Promise.all([
        adjustment(first, { type: "REFUND", amount: 100_000, refundMode: "CANCEL", classChangeId: plan.id }),
        (async () => {
          await step(registration, "enrollment.execute", "enrollment", `/internal/enrollment/enrollments/${pending.id}/confirm`);
          await finish(registration);
        })(),
      ]);
      const reserved = await waitDone("WF-09", refund.id, "WAITING");
      const rejected = await waitDone("WF-08", plan.id, "DEAD");
      assert.equal((await detail(plan.id)).result.errorCode, "STALE_IMPACT");
      const payment = await api("payment", `/api/v1/refunds/${refund.id}`, "GET", undefined, accountant.accessToken);
      assert.equal(payment.status, "RESERVED");
      await api("payment", `/api/v1/refunds/${refund.id}/execute`, "POST", { version: payment.version }, accountant.accessToken);
      const refunded = await waitDone("WF-09", refund.id);
      const seats = (await db.query("SELECT enrollment_id,status FROM holds WHERE class_id=$1 ORDER BY status", [row.id])).rows;
      assert.deepEqual(seats, [{ enrollment_id: first.id, status: "CANCELLED" }, { enrollment_id: pending.id, status: "COMMITTED" }]);
      assert.equal((await api("enrollment", `/api/v1/enrollments/${pending.id}`)).status, "CONFIRMED");
      assert.equal((await cls(row.id)).version, row.version);
      assert.equal((await cls(row.id)).status, "OPEN");
      assert.equal((await scheduleEvents(row.id, "class.cancelled")).length, 0);
      const money = (await h.pools.payment.query("SELECT id,amount::int,adapter FROM synthetic_payment_executions WHERE adjustment_id=$1 AND direction='REFUND'", [refund.id])).rows;
      assert.equal(money.length, 1);
      assert.equal(money[0].amount, 100_000);
      assert.equal(money[0].adapter, "SYNTHETIC");
      return { waiting, rejected, reserved, refunded, seats, registrationJobId: registration.job.jobId, refundReceipt: money[0].id };
    },
  );

  await test(
    "WF08-MINIMUM-AND-MAKEUP",
    "An approved minimum-size decision with elapsed server cutoff blocks opening. A new makeup plan moves future sessions and preserves history",
    async () => {
      const instructor = await teacher(),
        original = await ownedClass(instructor, 4);
      const planned = await api(
        "class-schedule",
        `/api/v1/classes/${original.id}/status`,
        "POST",
        { version: original.version, status: "PLANNED" },
        director.accessToken,
      );
      const past = new Date(Date.parse(planned.serverTime) - day).toISOString();
      const minimum = await create(
        planned,
        "MINIMUM_SIZE",
        schedule(planned, instructor.id, {
          minimumSize: 2,
          registrationClosesAt: past,
          decisionAt: past,
        }),
      );
      await decide(minimum);
      const minimumExecution = await waitDone("WF-08", minimum.id),
        current = await cls(planned.id);
      assert.equal(current.minimumSize, 2);
      assert(current.missingConditions.some((s) => s.includes("Sĩ số dưới mức tối thiểu")));
      const closed = await request(
        "class-schedule",
        `/api/v1/classes/${current.id}/status`,
        "POST",
        { version: current.version, status: "OPEN" },
        director.accessToken,
        409,
      );
      assert.equal(closed.body.error.code, "OPEN_CONDITIONS");
      const moved = current.sessions.map((s) => ({
        startsAt: shifted(s.startsAt, day),
        endsAt: shifted(s.endsAt, day),
      }));
      const makeup = await create(
        current,
        "MAKEUP",
        schedule(current, instructor.id, {
          sessions: moved,
          registrationClosesAt: planned.registrationClosesAt,
          decisionAt: planned.decisionAt,
        }),
        { targetStatus: "OPEN" },
      );
      await decide(makeup);
      const makeupExecution = await waitDone("WF-08", makeup.id),
        after = await cls(current.id);
      const revisions = (
        await db.query(
          "SELECT schedule_revision,retired_revision,active FROM sessions WHERE class_id=$1 ORDER BY schedule_revision",
          [current.id],
        )
      ).rows;
      assert.equal(after.status, "OPEN");
      assert.deepEqual(after.sessions, moved);
      assert.equal(revisions.filter((s) => s.active).length, moved.length);
      assert(revisions.some((s) => !s.active && s.retired_revision === after.version));
      return {
        classId: current.id,
        minimumPlanId: minimum.id,
        makeupPlanId: makeup.id,
        minimumExecution,
        makeupExecution,
        revisions,
      };
    },
  );

  await test(
    "WF08-LEAVE-SCHEDULE-RACE",
    "Teacher AVAILABLE is immediately effective and concurrent leave approval and class scheduling cannot create overlapping approved leave plus an active session",
    async () => {
      const instructor = await teacher(),
        fixture = await cls((await offer()).classId),
        slot = fixture.sessions[0];
      const avail = await api(
        "class-schedule",
        "/api/v1/teacher-time",
        "POST",
        {
          teacherId: instructor.id,
          kind: "AVAILABLE",
          startsAt: shifted(slot.startsAt, -hour),
          endsAt: shifted(slot.endsAt, hour),
        },
        instructor.accessToken,
        201,
        randomUUID(),
      );
      assert.equal(avail.status, "APPROVED");
      const leave = await api(
        "class-schedule",
        "/api/v1/teacher-time",
        "POST",
        {
          teacherId: instructor.id,
          kind: "LEAVE",
          ...slot,
          reason: "DEMO proposed leave",
        },
        instructor.accessToken,
        201,
        randomUUID(),
      );
      assert.equal(leave.status, "PENDING");
      const decision = {
        version: leave.version,
        status: "APPROVED",
        reason: "DEMO independent leave decision",
      };
      await request(
        "class-schedule",
        `/api/v1/teacher-time/${leave.id}/decision`,
        "POST",
        decision,
        instructor.accessToken,
        403,
      );
      const [approval, scheduled] = await Promise.all([
        request(
          "class-schedule",
          `/api/v1/teacher-time/${leave.id}/decision`,
          "POST",
          decision,
          director.accessToken,
          null,
        ),
        request(
          "class-schedule",
          "/api/v1/classes",
          "POST",
          schedule(fixture, instructor.id, { code: `WF08-${randomUUID()}` }),
          admin,
          null,
        ),
      ]);
      const active = (
        await db.query("SELECT count(*)::int AS n FROM sessions WHERE teacher_id=$1 AND active", [
          instructor.id,
        ])
      ).rows[0].n;
      const recorded = (await db.query("SELECT status FROM teacher_time WHERE id=$1", [leave.id])).rows[0]
        .status;
      assert(
        (approval.status === 200 && scheduled.status === 409) ||
          (approval.status === 409 && scheduled.status === 201),
      );
      assert.equal(recorded, approval.status === 200 ? "APPROVED" : "PENDING");
      assert.equal(active, scheduled.status === 201 ? 1 : 0);
      assert.equal((approval.status === 409 ? approval : scheduled).body.error.code, "TEACHER_TIME_CONFLICT");
      return {
        teacherId: instructor.id,
        leaveId: leave.id,
        approvedAvailabilityId: avail.id,
        approval: approval.status,
        scheduled: scheduled.status,
        active,
        recorded,
        traceparents: [approval.traceparent, scheduled.traceparent],
      };
    },
  );
}
