import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { createIdentityApp } from "../../identity/src/app.js";
import { hashPassword } from "../../identity/src/password.js";
import { createOrgApp } from "../../org/src/app.js";
import { createGatewayApp } from "../../gateway/src/app.js";
import { createClassApp, expireHolds, type ClassConfig } from "./app.js";
import { messagingSchema } from "@spacex/messaging";
import type { AuthConfig } from "@spacex/auth";

const databaseUrl = process.env.CLASS_TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error("CLASS_TEST_DATABASE_URL required; no skipped DB acceptance");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const names = ["identity", "org", "catalog", "classes"].map(
  (s) => `class_test_${randomUUID().replaceAll("-", "")}_${s}`,
);
const branch = "10000000-0000-4000-8000-000000000002",
  other = "10000000-0000-4000-8000-000000000003";
const password = "Class-fixture-password-2026",
  secret = "internal-enrollment-test-secret-at-least-32-bytes";
const auth: AuthConfig = {
  secret: "class-test-auth-secret-at-least-32-bytes",
  issuer: "class-tests",
  audience: "class-tests",
  identityUrl: "",
};
const config: ClassConfig = {
  orgUrl: "",
  catalogUrl: "",
  demo: true,
  ttlSeconds: 1200,
  enrollmentSecret: secret,
};
const pools: pg.Pool[] = [],
  servers: Server[] = [];
let admin: pg.Pool, classes: pg.Pool, iam: pg.Pool, org: pg.Pool;
let gateway: string,
  direct: string,
  center: string,
  director: string,
  staff: string,
  teacherToken: string,
  outsider: string;
let courseId: string, packageId: string, teacherId: string, roomId: string;
const learners = Array.from({ length: 12 }, () => ({
  learnerId: randomUUID(),
  enrollmentId: randomUUID(),
}));
let sequence = 0;
async function listen(app: ReturnType<typeof createClassApp>) {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  token = director,
  base = gateway,
  key?: string,
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
async function newClass(extra = {}, open = true) {
  sequence++;
  const start = new Date(Date.now() + (sequence + 3) * 86400000);
  const input = {
    code: `CLASS-${sequence}`,
    name: `Demo class ${sequence}`,
    courseId,
    packageId,
    branchId: branch,
    teacherId,
    mode: "online",
    roomId: null,
    onlineUrl: "https://example.test/class",
    capacity: 1,
    minimumSize: 0,
    registrationClosesAt: new Date(start.getTime() - 86400000).toISOString(),
    decisionAt: new Date(start.getTime() - 3600000).toISOString(),
    sessions: [
      {
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 3600000).toISOString(),
      },
    ],
    ...extra,
  };
  let result = await call("/api/v1/classes", "POST", input);
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  if (open)
    for (const status of ["PLANNED", "OPEN"]) {
      result = await call(
        `/api/v1/classes/${result.body.data.id}/status`,
        "POST",
        { status, version: result.body.data.version },
      );
      expect(result.status, JSON.stringify(result.body)).toBe(200);
    }
  return { ...result.body.data, input };
}
const hold = (
  cl: { id: string },
  learner = learners[0],
  key = randomUUID(),
  token = staff,
) =>
  call(
    "/api/v1/holds",
    "POST",
    { classId: cl.id, packageId, ...learner },
    token,
    gateway,
    key,
  );
const detail = (id: string) => call(`/api/v1/classes/${id}`);
const commit = (id: string) =>
  call(`/internal/holds/${id}/commit`, "POST", {}, secret, direct);
describe("Class/hold acceptance with real IAM, Org, Catalog, Gateway and PostgreSQL", () => {
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    for (const name of names) {
      await admin.query(`CREATE DATABASE ${name}`);
      const u = new URL(databaseUrl!);
      u.pathname = `/${name}`;
      pools.push(new pg.Pool({ connectionString: u.toString() }));
    }
    [iam, org, , classes] = pools;
    await iam.query(
      await readFile(`${root}/services/identity/migrations/0001.sql`, "utf8"),
    );
    await org.query(
      await readFile(`${root}/services/org/migrations/0001.sql`, "utf8"),
    );
    await classes.query(
      await readFile(
        `${root}/services/class-schedule/migrations/0001.sql`,
        "utf8",
      ),
    );
    await classes.query(await readFile(`${root}/services/class-schedule/migrations/0002_teacher_time.sql`, "utf8"));
    await classes.query(messagingSchema);
    await classes.query(await readFile(`${root}/services/class-schedule/migrations/0004_lifecycle.sql`, "utf8"));
    const catalogUrl = new URL(databaseUrl!);
    catalogUrl.pathname = `/${names[2]}`;
    process.env.DATABASE_URL = catalogUrl.toString();
    execFileSync(
      process.execPath,
      [`${root}/node_modules/tsx/dist/cli.mjs`, "src/db/migrate.ts"],
      { cwd: `${root}/services/catalog`, env: process.env, stdio: "pipe" },
    );
    const { createApp } = await import("../../catalog/src/app.js"),
      { registerCatalogRoutes } = await import("../../catalog/src/routes.js");
    config.catalogUrl = await listen(
      createApp("catalog", (app) => registerCatalogRoutes(app, auth)),
    );
    config.orgUrl = await listen(createOrgApp(org, auth));
    auth.identityUrl = await listen(
      createIdentityApp(iam, auth, config.orgUrl),
    );
    direct = await listen(createClassApp(classes, auth, config));
    gateway = await listen(
      createGatewayApp(auth, {
        catalog: config.catalogUrl,
        org: config.orgUrl,
        classes: direct,
      }),
    );
    await org.query(
      "INSERT INTO branches(id,code,name,kind) VALUES($1,'A','Demo A','branch'),($2,'B','Demo B','branch')",
      [branch, other],
    );
    const teacherAccount = randomUUID();
    teacherId = randomUUID();
    await org.query(
      "INSERT INTO employees(id,account_id,branch_id,name,teacher_profile) VALUES($1,$2,$3,'Demo teacher','Demo qualification')",
      [teacherId, teacherAccount, branch],
    );
    const hash = await hashPassword(password);
    const tokens: string[] = [];
    for (const [role, branches, id] of [
      ["center_director", [], randomUUID()],
      ["branch_director", [branch], randomUUID()],
      ["admissions", [branch], randomUUID()],
      ["teacher", [branch], teacherAccount],
      ["admissions", [other], randomUUID()],
    ] as const) {
      const email = `${role}-${id}@class.test`;
      await iam.query(
        "INSERT INTO accounts(id,email,name,password_hash,role,branch_ids) VALUES($1,$2,$3,$4,$5,$6)",
        [id, email, role, hash, role, branches],
      );
      tokens.push(
        (await call("/api/v1/auth/login", "POST", { email, password }, "")).body
          .data.accessToken,
      );
    }
    [center, director, staff, teacherToken, outsider] = tokens;
    courseId = (
      await call(
        "/api/v1/courses",
        "POST",
        {
          code: "DEMO",
          name: "Demo",
          goal: "Demo",
          level: "beginner",
          deliveryModes: ["online", "onsite"],
          priceVnd: 1200000,
          status: "active",
        },
        center,
      )
    ).body.data.id;
    packageId = (
      await call(
        "/api/v1/packages",
        "POST",
        {
          courseId,
          code: "DEMO-1",
          name: "Demo one session",
          sessionCount: 1,
          priceVnd: 1200000,
          status: "active",
        },
        center,
      )
    ).body.data.id;
    roomId = (
      await call("/api/v1/rooms", "POST", {
        name: "Demo room",
        branchId: branch,
        capacity: 10,
      })
    ).body.data.id;
    for (const [i, learner] of learners.entries())
      await classes.query("INSERT INTO demo_fixtures VALUES($1,$2,$3,$4,$5)", [
        randomUUID(),
        learner.learnerId,
        learner.enrollmentId,
        `Demo learner ${i + 1}`,
        branch,
      ]);
  }, 60000);
  afterAll(async () => {
    for (const server of servers.reverse())
      await new Promise<void>((resolve) => server.close(() => resolve()));
    if (servers.length)
      await (await import("../../catalog/src/db/client.js")).pool.end();
    for (const pool of pools) await pool.end();
    if (admin) {
      for (const name of names) {
        if (
          !/^class_test_[a-f0-9]{32}_(identity|org|catalog|classes)$/.test(name)
        )
          throw new Error("Unsafe test DB");
        await admin.query(`DROP DATABASE IF EXISTS ${name}`);
      }
      await admin.end();
    }
  });
  it("protects direct service, branch scope, actor ownership and internal commit", async () => {
    const cl = await newClass();
    expect(
      (await call("/api/v1/classes", "GET", undefined, "", direct)).status,
    ).toBe(401);
    expect(
      (await call("/api/v1/classes", "POST", cl.input, staff, direct)).status,
    ).toBe(403);
    expect(
      (
        await call(
          `/api/v1/classes/${cl.id}`,
          "GET",
          undefined,
          outsider,
          direct,
        )
      ).status,
    ).toBe(403);
    expect(
      (await call(`/api/v1/classes/${cl.id}`, "GET", undefined, teacherToken))
        .status,
    ).toBe(200);
    const hidden = await newClass({ teacherId: null }, false);
    expect(
      (
        await call(
          `/api/v1/classes/${hidden.id}`,
          "GET",
          undefined,
          teacherToken,
        )
      ).status,
    ).toBe(403);
    const h = await hold(cl);
    expect(h.status).toBe(201);
    expect(
      (
        await call(
          `/api/v1/holds/${h.body.data.id}`,
          "GET",
          undefined,
          director,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          `/internal/holds/${h.body.data.id}/commit`,
          "POST",
          {},
          staff,
          direct,
        )
      ).status,
    ).toBe(403);
    expect(
      (await call(`/api/v1/holds/${h.body.data.id}/commit`, "POST", {})).status,
    ).toBe(404);
    await call(`/api/v1/holds/${h.body.data.id}/cancel`, "POST", {}, staff);
  });
  it("rejects DRAFT/PLANNED, incomplete OPEN, unsupported transitions and center approval", async () => {
    const cl = await newClass(
      { teacherId: null, minimumSize: 2, capacity: 3 },
      false,
    );
    expect((await hold(cl)).body.error.code).toBe("NOT_OPEN");
    const plan = await call(`/api/v1/classes/${cl.id}/status`, "POST", {
      status: "PLANNED",
      version: 1,
    });
    expect((await hold(cl)).body.error.code).toBe("NOT_OPEN");
    expect(
      (
        await call(
          `/api/v1/classes/${cl.id}/status`,
          "POST",
          { status: "OPEN", version: plan.body.data.version },
          center,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(`/api/v1/classes/${cl.id}/status`, "POST", {
          status: "OPEN",
          version: 2,
        })
      ).body.error.code,
    ).toBe("OPEN_CONDITIONS");
    expect(
      (
        await call(`/api/v1/classes/${cl.id}/status`, "POST", {
          status: "CANCELLED",
          version: 2,
        })
      ).status,
    ).toBe(400);
  });
  it("locks the final seat against two truly concurrent requests", async () => {
    const cl = await newClass();
    const results = await Promise.all([
      hold(cl, learners[0]),
      hold(cl, learners[1], randomUUID(), director),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await detail(cl.id)).body.data).toMatchObject({
      committed: 0,
      held: 1,
      available: 0,
    });
    const winner = results.find((r) => r.status === 201)!;
    await call(
      `/api/v1/holds/${winner.body.data.id}/cancel`,
      "POST",
      {},
      results[1].status === 201 ? director : staff,
    );
  });
  it("deduplicates a learner across different keys and same-key concurrent retry", async () => {
    const cl = await newClass({ capacity: 3 });
    const same = await Promise.all([hold(cl), hold(cl, learners[0], randomUUID(), director)]);
    expect(same.map((r) => r.status).sort()).toEqual([201, 409]);
    const key = randomUUID();
    const retried = await Promise.all([
      hold(cl, learners[2], key),
      hold(cl, learners[2], key),
    ]);
    expect(retried.map((r) => r.status)).toEqual([201, 201]);
    expect(retried[0].body.data.id).toBe(retried[1].body.data.id);
    expect((await hold(cl, learners[3], key)).body.error.code).toBe(
      "IDEMPOTENCY_CONFLICT",
    );
    const winner = same.find((r) => r.status === 201)!;
    await call(`/api/v1/holds/${winner.body.data.id}/cancel`, "POST", {}, same[1].status === 201 ? director : staff);
    await call(`/api/v1/holds/${retried[0].body.data.id}/cancel`, "POST", {}, staff);
  });
  it("returns a cancelled hold on retry without reserving again; cancel is idempotent", async () => {
    const cl = await newClass(),
      key = randomUUID(),
      h = (await hold(cl, learners[0], key)).body.data;
    await Promise.all([
      call(`/api/v1/holds/${h.id}/cancel`, "POST", {}, staff),
      call(`/api/v1/holds/${h.id}/cancel`, "POST", {}, staff),
    ]);
    expect((await hold(cl, learners[0], key)).body.data).toMatchObject({
      id: h.id,
      status: "CANCELLED",
    });
    expect((await detail(cl.id)).body.data.available).toBe(1);
    expect((await commit(h.id)).status).toBe(409);
  });
  it("ignores expired holds before sweep; recovers persisted holds with a new service/pool", async () => {
    const cl = await newClass(),
      h = (await hold(cl)).body.data;
    const url = new URL(databaseUrl!);
    url.pathname = `/${names[3]}`;
    const recoveredPool = new pg.Pool({ connectionString: url.toString() });
    const recoveredServer = createClassApp(recoveredPool, auth, config).listen(
      0,
      "127.0.0.1",
    );
    await new Promise<void>((resolve) =>
      recoveredServer.once("listening", resolve),
    );
    const recoveredBase = `http://127.0.0.1:${(recoveredServer.address() as AddressInfo).port}`;
    try {
      expect(
        (
          await call(
            `/api/v1/holds/${h.id}`,
            "GET",
            undefined,
            staff,
            recoveredBase,
          )
        ).body.data.status,
      ).toBe("HELD");
      await classes.query(
        "UPDATE holds SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [h.id],
      );
      expect((await detail(cl.id)).body.data.available).toBe(1);
      expect((await commit(h.id)).status).toBe(409);
      expect(await expireHolds(recoveredPool)).toBeGreaterThanOrEqual(0);
      expect(await expireHolds(recoveredPool)).toBe(0);
      expect(
        (
          await call(
            `/api/v1/holds/${h.id}`,
            "GET",
            undefined,
            staff,
            recoveredBase,
          )
        ).body.data.status,
      ).toBe("EXPIRED");
      const replacement = await hold(cl, learners[1]);
      expect(replacement.status).toBe(201);
      await call(
        `/api/v1/holds/${replacement.body.data.id}/cancel`,
        "POST",
        {},
        staff,
      );
    } finally {
      await new Promise<void>((resolve) =>
        recoveredServer.close(() => resolve()),
      );
      await recoveredPool.end();
    }
  });
  it("makes commit idempotent and never revives an expired hold during an expiry race", async () => {
    const cl = await newClass(),
      h = (await hold(cl)).body.data;
    const results = await Promise.all([
      commit(h.id),
      commit(h.id),
      expireHolds(classes),
    ]);
    expect(
      results.slice(0, 2).map((r) => (typeof r === "number" ? r : r.status)),
    ).toEqual([200, 200]);
    expect((await detail(cl.id)).body.data).toMatchObject({
      committed: 1,
      held: 0,
      available: 0,
    });
    const expiredClass = await newClass(),
      expired = (await hold(expiredClass, learners[4])).body.data;
    await classes.query(
      "UPDATE holds SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [expired.id],
    );
    const race = await Promise.all([commit(expired.id), expireHolds(classes)]);
    expect((race[0] as { status: number }).status).toBe(409);
    expect((await detail(expiredClass.id)).body.data).toMatchObject({
      committed: 0,
      held: 0,
      available: 1,
    });
  });
  it("rejects reduced capacity, stale versions, cutoff and arbitrary fixtures", async () => {
    const cl = await newClass({ capacity: 2 });
    const a = await hold(cl, learners[5]),
      b = await hold(cl, learners[6]);
    expect(
      (
        await call(`/api/v1/classes/${cl.id}`, "PUT", {
          version: cl.version,
          input: { ...cl.input, capacity: 1 },
        })
      ).body.error.code,
    ).toBe("CAPACITY_CONFLICT");
    expect(
      (
        await call(`/api/v1/classes/${cl.id}`, "PUT", {
          version: 1,
          input: cl.input,
        })
      ).body.error.code,
    ).toBe("STALE_VERSION");
    await classes.query(
      "UPDATE classes SET registration_closes_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [cl.id],
    );
    expect((await hold(cl, learners[7])).body.error.code).toBe(
      "REGISTRATION_CLOSED",
    );
    expect(
      (await hold(cl, { learnerId: randomUUID(), enrollmentId: randomUUID() }))
        .status,
    ).toBe(403);
    for (const h of [a, b])
      await call(`/api/v1/holds/${h.body.data.id}/cancel`, "POST", {}, staff);
  });
  it("enforces room/teacher/session overlaps under simultaneous writes, allowing adjacent sessions", async () => {
    sequence++;
    const start = new Date(
        Date.now() + (sequence + 50) * 86400000,
      ).toISOString(),
      end = new Date(Date.parse(start) + 3600000).toISOString();
    const initial = await newClass(
      { mode: "onsite", onlineUrl: null, roomId, sessions: [] },
      false,
    );
    const input = {
      ...initial.input,
      sessions: [{ startsAt: start, endsAt: end }],
    };
    const attempts = await Promise.all([
      call(`/api/v1/classes/${initial.id}`, "PUT", { version: 1, input }),
      call("/api/v1/classes", "POST", { ...input, code: "SIMULTANEOUS" }),
    ]);
    expect(attempts.filter((r) => r.status < 300)).toHaveLength(1);
    expect(attempts.find((r) => r.status === 409)?.body.error.code).toBe(
      "SCHEDULE_CONFLICT",
    );
    const adjacent = await call("/api/v1/classes", "POST", {
      ...input,
      code: "ADJACENT",
      sessions: [
        {
          startsAt: end,
          endsAt: new Date(Date.parse(end) + 3600000).toISOString(),
        },
      ],
    });
    expect(adjacent.status).toBe(201);
    let onsite = adjacent.body.data;
    for (const status of ["PLANNED", "OPEN"]) {
      const changed = await call(
        `/api/v1/classes/${onsite.id}/status`,
        "POST",
        { status, version: onsite.version },
      );
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      onsite = changed.body.data;
    }
    const noRoom = await newClass(
      { mode: "onsite", onlineUrl: null, roomId: null },
      false,
    );
    await call(`/api/v1/classes/${noRoom.id}/status`, "POST", {
      status: "PLANNED",
      version: 1,
    });
    expect(
      (
        await call(`/api/v1/classes/${noRoom.id}/status`, "POST", {
          status: "OPEN",
          version: 2,
        })
      ).body.error.code,
    ).toBe("OPEN_CONDITIONS");
    expect(
      (
        await call(
          "/api/v1/classes",
          "POST",
          { ...input, code: "WRONG-BRANCH", branchId: other },
          director,
          direct,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call("/api/v1/classes", "POST", {
          ...input,
          code: "WRONG-ROOM",
          roomId: randomUUID(),
        })
      ).body.error.code,
    ).toBe("INVALID_ROOM");
  });
  it("persists a hold through a real process restart and sweeps overdue rows at startup", async () => {
    const cl = await newClass(),
      held = (await hold(cl, learners[9])).body.data;
    const listener = createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const port = (listener.address() as AddressInfo).port;
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    const url = new URL(databaseUrl!);
    url.pathname = `/${names[3]}`;
    const start = async () => {
      const child = spawn(
        process.execPath,
        [`${root}/services/class-schedule/dist/index.js`],
        {
          windowsHide: true,
          stdio: "ignore",
          env: {
            ...process.env,
            HOST: "127.0.0.1",
            PORT: String(port),
            DATABASE_URL: url.toString(),
            AUTH_SECRET: auth.secret,
            AUTH_ISSUER: auth.issuer,
            AUTH_AUDIENCE: auth.audience,
            IDENTITY_URL: auth.identityUrl,
            ORG_URL: config.orgUrl,
            CATALOG_URL: config.catalogUrl,
            APP_ENV: "demo",
            CLASS_DEMO_ENABLED: "true",
            ...(process.env.RABBITMQ_TEST_URL ? { RABBITMQ_URL: process.env.RABBITMQ_TEST_URL } : {}),
          },
        },
      );
      try {
        for (let i = 0; i < 100; i++) {
          if (child.exitCode !== null)
            throw new Error("Recovery service exited");
          try {
            if ((await fetch(`http://127.0.0.1:${port}/ready`)).ok)
              return child;
          } catch {
            /* Wait for the child to bind its port. */
          }
          await new Promise((r) => setTimeout(r, 40));
        }
        throw new Error("Recovery service timeout");
      } catch (e) {
        child.kill();
        throw e;
      }
    };
    let child = await start();
    try {
      expect(
        (
          await call(
            `/api/v1/holds/${held.id}`,
            "GET",
            undefined,
            staff,
            `http://127.0.0.1:${port}`,
          )
        ).body.data.status,
      ).toBe("HELD");
      child.kill();
      await once(child, "exit");
      await classes.query(
        "UPDATE holds SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [held.id],
      );
      child = await start();
      for (let i = 0; i < 100; i++) {
        if (
          (
            await classes.query("SELECT status FROM holds WHERE id=$1", [
              held.id,
            ])
          ).rows[0].status === "EXPIRED"
        )
          break;
        await new Promise((r) => setTimeout(r, 40));
      }
      expect(
        (await classes.query("SELECT status FROM holds WHERE id=$1", [held.id]))
          .rows[0].status,
      ).toBe("EXPIRED");
      expect((await detail(cl.id)).body.data.available).toBe(1);
      if (process.env.RABBITMQ_TEST_URL) {
        for (let i = 0; i < 150; i++) {
          if ((await classes.query("SELECT 1 FROM class_event_receipts LIMIT 1")).rowCount) break;
          await new Promise(resolve => setTimeout(resolve, 40));
        }
        expect((await classes.query("SELECT 1 FROM event_outbox WHERE status='SENT' LIMIT 1")).rowCount).toBe(1);
        expect((await classes.query("SELECT 1 FROM class_event_receipts LIMIT 1")).rowCount).toBe(1);
      }
    } finally {
      child.kill();
      await once(child, "exit");
    }
  });
  it("cancels uncommitted classes, releases timetable slots and retains immutable status history", async () => {
    const cl = await newClass(), held = (await hold(cl, learners[10])).body.data;
    const cancelled = await call(`/api/v1/classes/${cl.id}/status`, "POST", { version: cl.version, status: "CANCELLED", reason: "Không tổ chức lớp demo" });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body.data.status).toBe("CANCELLED");
    expect(cancelled.body.data.sessions).toHaveLength(1);
    expect((await call(`/api/v1/holds/${held.id}`, "GET", undefined, staff)).body.data.status).toBe("CANCELLED");
    expect((await hold(cl)).body.error.code).toBe("NOT_OPEN");
    expect((await call(`/api/v1/classes/${cl.id}`, "PUT", { version: cancelled.body.data.version, input: cl.input })).body.error.code).toBe("CLASS_LOCKED");
    expect((await call("/api/v1/classes", "POST", { ...cl.input, code: "REUSE-CANCELLED-SLOT" })).status).toBe(201);
    await expect(classes.query("DELETE FROM class_status_changes WHERE class_id=$1", [cl.id])).rejects.toThrow("Audit is append only");
  });
  it("serializes cancellation against seat commit and never cancels committed rights", async () => {
    const cl = await newClass(), held = (await hold(cl, learners[11])).body.data;
    const results = await Promise.all([
      call(`/api/v1/classes/${cl.id}/status`, "POST", { version: cl.version, status: "CANCELLED", reason: "Cancellation race" }),
      commit(held.id),
    ]);
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    const snapshot = (await detail(cl.id)).body.data;
    expect(snapshot.status === "CANCELLED" ? snapshot.committed === 0 : snapshot.committed === 1).toBe(true);
    if (snapshot.committed) expect(results[0].body.error.code).toBe("ENROLLMENT_REQUIRED");
  });
  it("checks lesson times before starting/completing and locks edits on terminal classes", async () => {
    const cl = await newClass();
    expect((await call(`/api/v1/classes/${cl.id}/status`, "POST", { version: cl.version, status: "IN_PROGRESS" })).body.error.code).toBe("START_CONDITIONS");
    await classes.query("UPDATE sessions SET starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '1 hour' WHERE class_id=$1", [cl.id]);
    const started = await call(`/api/v1/classes/${cl.id}/status`, "POST", { version: cl.version, status: "IN_PROGRESS" });
    expect(started.status).toBe(200);
    const completed = await call(`/api/v1/classes/${cl.id}/status`, "POST", { version: started.body.data.version, status: "COMPLETED" });
    expect(completed.status).toBe(200);
    expect((await call(`/api/v1/classes/${cl.id}/status`, "POST", { version: completed.body.data.version, status: "OPEN" })).body.error.code).toBe("INVALID_TRANSITION");
  });
  it("declares teacher availability with ownership, persistent configuration and idempotent retries", async () => {
    const input = { teacherId, kind: "AVAILABLE", startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 700 * 86400000).toISOString(), reason: "Test teaching availability" };
    const key = randomUUID();
    expect((await call("/api/v1/teacher-time", "POST", input, staff, gateway, key)).status).toBe(403);
    expect((await call("/api/v1/teacher-time", "POST", { ...input, teacherId: randomUUID() }, teacherToken, gateway, key)).status).toBe(403);
    const created = await call("/api/v1/teacher-time", "POST", input, teacherToken, gateway, key);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await call("/api/v1/teacher-time", "POST", input, teacherToken, gateway, key)).body.data.id).toBe(created.body.data.id);
    expect((await call("/api/v1/teacher-time", "POST", { ...input, reason: "changed" }, teacherToken, gateway, key)).body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect((await call(`/api/v1/teacher-time/${created.body.data.id}/decision`, "POST", { version: 1, status: "CANCELLED", reason: "withdraw" }, teacherToken)).body.error.code).toBe("TEACHER_TIME_CONFLICT");
    const list = await call("/api/v1/teacher-time", "GET", undefined, teacherToken);
    expect(list.body.data.some((r: { id: string }) => r.id === created.body.data.id)).toBe(true);
  });
  it("does not change the timetable for a pending leave or allow self-approval/stale decisions", async () => {
    const cl = await newClass();
    const leave = await call("/api/v1/teacher-time", "POST", { teacherId, kind: "LEAVE", ...cl.input.sessions[0], reason: "Appointment" }, teacherToken, gateway, randomUUID());
    expect(leave.status).toBe(201);
    const id = leave.body.data.id;
    expect((await call(`/api/v1/teacher-time/${id}/decision`, "POST", { version: 1, status: "APPROVED", reason: "self" }, teacherToken)).status).toBe(403);
    expect((await call(`/api/v1/teacher-time/${id}/decision`, "POST", { version: 1, status: "APPROVED", reason: "approve" }, director)).body.error.code).toBe("TEACHER_TIME_CONFLICT");
    expect((await detail(cl.id)).body.data.sessions).toHaveLength(1);
    expect((await call(`/api/v1/teacher-time/${id}/decision`, "POST", { version: 1, status: "REJECTED", reason: "Lịch chưa được xếp lại" }, director)).status).toBe(200);
    expect((await call(`/api/v1/teacher-time/${id}/decision`, "POST", { version: 1, status: "CANCELLED", reason: "stale" }, teacherToken)).body.error.code).toBe("STALE_VERSION");
  });
  it("serializes leave approval with scheduling and enforces declared availability", async () => {
    const cl = await newClass();
    const startsAt = new Date(Date.now() + 400 * 86400000).toISOString(), endsAt = new Date(Date.parse(startsAt) + 3600000).toISOString();
    const leave = await call("/api/v1/teacher-time", "POST", { teacherId, kind: "LEAVE", startsAt, endsAt, reason: "Concurrent leave" }, teacherToken, gateway, randomUUID());
    expect(leave.status).toBe(201);
    const race = await Promise.all([
      call(`/api/v1/teacher-time/${leave.body.data.id}/decision`, "POST", { version: 1, status: "APPROVED", reason: "approve" }, director),
      call("/api/v1/classes", "POST", { ...cl.input, code: "TEACHER-LEAVE-RACE", sessions: [{ startsAt, endsAt }] }),
    ]);
    expect(race.map(r => r.status).sort()).toEqual([race[0].status === 200 ? 200 : 201, 409].sort());
    expect(race.filter(r => r.status < 300)).toHaveLength(1);
    const outside = new Date(Date.now() + 800 * 86400000).toISOString();
    const failed = await call("/api/v1/classes", "POST", { ...cl.input, code: "OUTSIDE-AVAILABILITY", sessions: [{ startsAt: outside, endsAt: new Date(Date.parse(outside) + 3600000).toISOString() }] });
    expect(failed.body.error.code).toBe("TEACHER_TIME_CONFLICT");
    expect((await classes.query("SELECT 1 FROM classes WHERE code='OUTSIDE-AVAILABILITY'")).rowCount).toBe(0);
  });
  it("stores an event with each mutation and restricts operations/replay to the center", async () => {
    const cl = await newClass();
    expect(Number((await classes.query("SELECT count(*) FROM event_outbox WHERE event->'payload'->>'targetId'=$1", [cl.id])).rows[0].count)).toBe(3);
    expect((await call("/api/v1/operations", "GET", undefined, director)).status).toBe(403);
    expect((await call("/api/v1/operations", "GET", undefined, center)).status).toBe(200);
    const eventId = (await classes.query("SELECT id FROM event_outbox LIMIT 1")).rows[0].id;
    expect((await call(`/api/v1/operations/${eventId}/replay`, "POST", { reason: "operator retry" }, center)).body.error.code).toBe("NOT_DEAD");
  });
  it("filters sellable Catalog offers by goal, level, mode, branch and actual package budget; versions policy text", async () => {
    const course = await call("/api/v1/courses", "POST", { code: "FILTER-COURSE", name: "Goal filter course", goal: "IELTS speaking", level: "beginner", deliveryModes: ["online"], branchIds: [branch], priceVnd: 9999999, policyText: "Course policy v1", status: "active" }, center);
    const input = { courseId: course.body.data.id, code: "FILTER-PACKAGE", name: "Budget package", sessionCount: 1, priceVnd: 600000, policyText: "Package policy v1", status: "active" };
    const pack = await call("/api/v1/packages", "POST", input, center);
    expect(pack.status).toBe(201);
    const query = `sellable=true&goal=IELTS&level=beginner&mode=online&branchId=${branch}&minPriceVnd=550000&maxPriceVnd=650000`;
    const found = await call(`/api/v1/courses?${query}`, "GET", undefined, center);
    expect(found.body.data.map((r: { id: string }) => r.id)).toEqual([course.body.data.id]);
    const packages = await call(`/api/v1/packages?${query}`, "GET", undefined, center);
    expect(packages.body.data.map((r: { id: string }) => r.id)).toEqual([pack.body.data.id]);
    expect((await call(`/api/v1/packages?${query.replace(branch, other)}`, "GET", undefined, center)).body.data).toHaveLength(0);
    expect((await call(`/api/v1/packages?${query.replace("650000", "590000")}`, "GET", undefined, center)).body.data).toHaveLength(0);
    expect((await call("/api/v1/courses?minPriceVnd=100&maxPriceVnd=1", "GET", undefined, center)).status).toBe(400);
    expect((await call(`/api/v1/packages/${pack.body.data.id}`, "PUT", { ...input, policyText: "Package policy v2" }, center)).status).toBe(200);
    const quote = await call(`/api/v1/packages/${pack.body.data.id}/quote`, "GET", undefined, center);
    expect(quote.body.data).toMatchObject({ coursePolicy: "Course policy v1", packagePolicy: "Package policy v2", packageVersion: 2 });
    const history = await call(`/api/v1/packages/${pack.body.data.id}/history`, "GET", undefined, center);
    expect(history.body.data.map((r: { snapshot: { policy_text: string } }) => r.snapshot.policy_text)).toEqual(["Package policy v2", "Package policy v1"]);
    // Close this independent offer so the existing sellable regression remains isolated.
    await call(`/api/v1/packages/${pack.body.data.id}`, "PUT", { ...input, status: "closed" }, center);
  });
  it("keeps catalog versions and price snapshots, disallows stopped offers and fixture mode outside demo", async () => {
    const quote = await call(
      `/api/v1/packages/${packageId}/quote`,
      "GET",
      undefined,
      center,
    );
    expect(quote.body.data).toMatchObject({
      priceVnd: 1200000,
      currency: "VND",
      packageVersion: 1,
    });
    const cl = await newClass();
    await call(
      `/api/v1/packages/${packageId}`,
      "PUT",
      {
        courseId,
        code: "DEMO-1",
        name: "Demo stopped",
        sessionCount: 1,
        priceVnd: 1300000,
        status: "closed",
      },
      center,
    );
    expect((await hold(cl, learners[8])).body.error.code).toBe("NOT_SELLABLE");
    const sellable = await call("/api/v1/classes?sellable=true");
    expect(sellable.status).toBe(200);
    expect(sellable.body.data).toHaveLength(0);
    expect(sellable.body.pagination.total).toBe(0);
    const history = await call(
      `/api/v1/packages/${packageId}/history`,
      "GET",
      undefined,
      center,
    );
    expect(
      history.body.data.map((h: { version: number }) => h.version),
    ).toEqual([2, 1]);
    expect(Number(history.body.data[1].snapshot.price_vnd)).toBe(1200000);
    const disabled = await listen(
      createClassApp(classes, auth, { ...config, demo: false }),
    );
    expect(
      (await call("/api/v1/holds", "POST", {}, staff, disabled, randomUUID()))
        .body.error.code,
    ).toBe("DEMO_DISABLED");
    await expect(classes.query("DELETE FROM class_audit")).rejects.toThrow(
      "Audit is append only",
    );
  });
});
