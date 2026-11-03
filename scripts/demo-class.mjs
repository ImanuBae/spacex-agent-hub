// Isolated local demo. Configuration lives only in ignored .local; never rewrites .env.
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, open } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import pg from "pg";
const root = process.cwd(),
  branch = "10000000-0000-4000-8000-000000000002";
await mkdir(".local", { recursive: true });
let local;
try {
  local = JSON.parse(await readFile(".local/class-demo.json", "utf8"));
} catch {
  local = {
    password: `Demo-${randomBytes(16).toString("hex")}`,
    authSecret: randomBytes(48).toString("base64url"),
    email: "director@class-demo.test",
  };
  await writeFile(".local/class-demo.json", JSON.stringify(local));
}
const dbBase =
  process.env.DEMO_DATABASE_URL ??
  "postgresql://postgres:space_agent_local_dev@127.0.0.1:55432/postgres";
const baseEnv = {
  ...process.env,
  AUTH_SECRET: local.authSecret,
  HOST: "127.0.0.1",
  IDENTITY_URL: "http://127.0.0.1:4002",
  ORG_URL: "http://127.0.0.1:4003",
  CATALOG_URL: "http://127.0.0.1:4001",
  CLASS_URL: "http://127.0.0.1:4004",
  GATEWAY_URL: "http://127.0.0.1:4000",
  PORTAL_ORIGIN: "http://localhost:3000",
  APP_ENV: "demo",
  CLASS_DEMO_ENABLED: "true",
  CLASS_DEMO_HOLD_TTL_SECONDS:
    process.env.CLASS_DEMO_HOLD_TTL_SECONDS ?? "1200",
  ...(process.env.RABBITMQ_URL || local.brokerUrl ? { RABBITMQ_URL: process.env.RABBITMQ_URL ?? local.brokerUrl } : {}),
};
const children = [];
async function available(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(new Error(`Port ${port} is occupied; stop its owner before demo`)),
    );
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
for (const port of [3000, 4000, 4001, 4002, 4003, 4004]) await available(port);
const admin = new pg.Pool({ connectionString: dbBase });
const databases = {
  identity: "identity_access",
  org: "org",
  catalog: "catalog",
  "class-schedule": "class_schedule",
};
function command(service, script, env) {
  execFileSync(
    process.execPath,
    [`${root}/node_modules/tsx/dist/cli.mjs`, script],
    { cwd: `${root}/services/${service}`, env, stdio: "inherit" },
  );
}
const environments = {};
try {
  for (const [service, db] of Object.entries(databases)) {
    // Fixed service-owned identifiers; only this dedicated demo server is configured by default.
    const exists = (
      await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [db])
    ).rowCount;
    if (!exists)
      await admin.query(`CREATE USER ${db} WITH PASSWORD '${db}_dev'`);
    if (
      !(await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [db]))
        .rowCount
    )
      await admin.query(`CREATE DATABASE ${db} OWNER ${db}`);
    const u = new URL(dbBase);
    u.pathname = `/${db}`;
    u.username = db;
    u.password = `${db}_dev`;
    const env = { ...baseEnv, DATABASE_URL: u.toString() };
    environments[service] = env;
    command(
      service,
      service === "catalog" ? "src/db/migrate.ts" : "src/migrate.ts",
      env,
    );
    if (service === "identity")
      command(service, "src/seed.ts", {
        ...env,
        SEED_ADMIN_EMAIL: local.email,
        SEED_ADMIN_PASSWORD: local.password,
      });
    if (service === "org" || service === "class-schedule")
      command(service, "src/seed.ts", env);
  }
} finally {
  await admin.end();
}
async function start(name, args, cwd, env) {
  const log = await open(`.local/class-demo-${name}.log`, "a");
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: ["ignore", log.fd, log.fd],
    windowsHide: true,
  });
  children.push(child);
  await log.close();
  child.once("exit", (code) => {
    if (code)
      console.error(
        `${name} exited (${code}); see .local/class-demo-${name}.log`,
      );
  });
}
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Service not ready: ${url}`);
}
async function api(path, method = "GET", body, token, key) {
  const r = await fetch(`http://127.0.0.1:4000/api/v1/${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(`${method} ${path}: ${r.status} ${data.error?.message}`);
  return data.data;
}
async function seedDemo() {
  const center = (
    await api("auth/login", "POST", {
      email: local.email,
      password: local.password,
    })
  ).accessToken;
  const accounts = await api("accounts", "GET", undefined, center),
    employees = await api("employees", "GET", undefined, center);
  const users = {};
  for (const [role, name] of [
    ["branch_director", "DEMO · Giám đốc Quận 1"],
    ["admissions", "DEMO · Tuyển sinh"],
    ["accountant", "DEMO · Kế toán"],
    ["teacher", "DEMO · Giảng viên"],
  ]) {
    const email = local.accounts?.[role]?.email ?? `${role}@class-demo.test`;
    const account =
      accounts.find((a) => a.email === email) ??
      (await api(
        "accounts",
        "POST",
        { email, name, password: local.password, role },
        center,
      ));
    const employee =
      employees.find((e) => e.accountId === account.id) ??
      (await api(
        "employees",
        "POST",
        {
          accountId: account.id,
          branchId: branch,
          name,
          teacherProfile:
            role === "teacher" ? "DEMO · Giảng viên thử nghiệm" : null,
        },
        center,
      ));
    if (account.role !== role || !account.branchIds?.includes(branch))
      await api(
        `employees/${employee.id}/access`,
        "PUT",
        { role, branchIds: [branch] },
        center,
        randomUUID(),
      );
    users[role] = {
      employee,
      token: (
        await api("auth/login", "POST", { email, password: local.password })
      ).accessToken,
    };
  }
  const courses = await api("courses?pageSize=100", "GET", undefined, center);
  const course =
    courses.find((c) => c.code === "DEMO-CLASS") ??
    (await api(
      "courses",
      "POST",
      {
        code: "DEMO-CLASS",
        name: "DEMO · Tin học ứng dụng",
        goal: "Thử luồng lớp và giữ chỗ",
        level: "beginner",
        deliveryModes: ["online", "onsite"],
        priceVnd: 1500000,
        status: "active",
        branchIds: [branch],
      },
      center,
    ));
  const packages = await api("packages?pageSize=100", "GET", undefined, center);
  const pack =
    packages.find((p) => p.code === "DEMO-CLASS-1") ??
    (await api(
      "packages",
      "POST",
      {
        courseId: course.id,
        code: "DEMO-CLASS-1",
        name: "DEMO · Gói một buổi",
        sessionCount: 1,
        priceVnd: 1500000,
        status: "active",
      },
      center,
    ));
  const rooms = await api("rooms", "GET", undefined, center);
  if (!rooms.some((r) => r.name === "DEMO · Phòng thực hành"))
    await api(
      "rooms",
      "POST",
      { name: "DEMO · Phòng thực hành", branchId: branch, capacity: 20 },
      center,
    );
  const existing = await api("classes?pageSize=100", "GET", undefined, center);
  for (const [i, code] of [
    "DEMO-LAST-SEAT",
    "DEMO-PLANNED",
    "DEMO-FULL",
  ].entries()) {
    if (existing.some((c) => c.code === code)) continue;
    const start = new Date(Date.now() + (i + 14) * 86400000);
    let cl = await api(
      "classes",
      "POST",
      {
        code,
        name: `DEMO · ${["Còn một chỗ", "Chờ mở bán", "Đã hết chỗ"][i]}`,
        courseId: course.id,
        packageId: pack.id,
        branchId: branch,
        teacherId: users.teacher.employee.id,
        mode: "online",
        roomId: null,
        onlineUrl: "https://example.test/demo-class",
        capacity: 1,
        minimumSize: 0,
        registrationClosesAt: new Date(
          start.getTime() - 86400000,
        ).toISOString(),
        decisionAt: new Date(start.getTime() - 3600000).toISOString(),
        sessions: [
          {
            startsAt: start.toISOString(),
            endsAt: new Date(start.getTime() + 3600000).toISOString(),
          },
        ],
      },
      center,
    );
    cl = await api(
      `classes/${cl.id}/status`,
      "POST",
      { status: "PLANNED", version: cl.version },
      users.branch_director.token,
    );
    if (i !== 1)
      cl = await api(
        `classes/${cl.id}/status`,
        "POST",
        { status: "OPEN", version: cl.version },
        users.branch_director.token,
      );
    if (i === 2) {
      // Seed a committed technical fixture, not a fabricated counter or payment.
      const pool = new pg.Pool({
        connectionString: environments["class-schedule"].DATABASE_URL,
      });
      try {
        await pool.query(
          "INSERT INTO holds(id,class_id,package_id,learner_id,enrollment_id,actor_id,status,expires_at,operation_key,request_payload) VALUES($1,$2,$3,$4,$5,$6,'COMMITTED',now(),$7,$8)",
          [
            randomUUID(),
            cl.id,
            pack.id,
            "d1000000-0000-4000-8000-000000000006",
            "d2000000-0000-4000-8000-000000000006",
            users.branch_director.employee.accountId,
            randomUUID(),
            {},
          ],
        );
      } finally {
        await pool.end();
      }
    }
  }
}
try {
  for (const [name, port] of [
    ["identity", 4002],
    ["org", 4003],
    ["catalog", 4001],
    ["class-schedule", 4004],
    ["gateway", 4000],
  ]) {
    await start(name, ["dist/index.js"], `${root}/services/${name}`, {
      ...(environments[name] ?? baseEnv),
      PORT: String(port),
      SERVICE_NAME: name,
    });
    await ready(`http://127.0.0.1:${port}/health`);
  }
  await seedDemo();
  const production = process.argv.includes("--production");
  await start(
    "portal",
    [
      `${root}/node_modules/next/dist/bin/next`,
      production ? "start" : "dev",
      "--port",
      "3000",
    ],
    `${root}/apps/admin-portal`,
    baseEnv,
  );
  await ready("http://127.0.0.1:3000/login");
  console.log(
    "Demo ready: http://localhost:3000 — role accounts and credentials in ignored .local/class-demo.json. Ctrl+C stops services.",
  );
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
} finally {
  for (const child of children) child.kill();
}
