// Acceptance against the running isolated demo. Uses real forms, BFF cookies and DB APIs.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { unlink } from "node:fs/promises";
const skill =
  process.env.TASTE_SKILL_ROOT ??
  join(
    process.env.USERPROFILE ?? process.env.HOME,
    ".agents/skills/design-taste-frontend",
  );
const { Browser, sleep } = await import(
  pathToFileURL(join(skill, "scripts/lib/cdp.mjs")).href
);
const local = JSON.parse(await readFile(".local/class-demo.json", "utf8"));
const browser = await Browser.launch(),
  page = await browser.newPage({ width: 1440, height: 900 });
const out = ".local/class-browser";
await mkdir(out, { recursive: true });
const suffix = Date.now().toString(36),
  courseName = `DEMO · Browser ${suffix}`,
  className = `DEMO · Lớp browser ${suffix}`;
let frames = 0;
const pendingFrames = [];
const off = browser.on(page.sessionId, "Page.screencastFrame", (event) => {
  pendingFrames.push(
    writeFile(
      `${out}/frame-${String(++frames).padStart(5, "0")}.jpg`,
      Buffer.from(event.data, "base64"),
    ),
  );
  void page.send("Page.screencastFrameAck", { sessionId: event.sessionId });
});
async function wait(fn, arg) {
  for (let i = 0; i < 100; i++) {
    if (await page.eval(fn, arg)) return;
    await sleep(100);
  }
  throw new Error(`Browser condition timed out: ${fn}`);
}
async function click(text) {
  await wait(text => [...document.querySelectorAll("button")].some(b => b.textContent.trim().replace(/^\+\s*/, "") === text && !b.disabled), text);
  const found = await page.eval((text) => {
    const b = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim().replace(/^\+\s*/, "") === text,
    );
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }, text);
  assert(found, `Button unavailable: ${text}`);
  await sleep(100);
}
async function fill(id, value) {
  await page.eval(
    ({ id, value }) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`Missing field ${id}`);
      const proto =
        el.tagName === "SELECT"
          ? HTMLSelectElement.prototype
          : el.tagName === "TEXTAREA"
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(
        el,
        String(value),
      );
      el.dispatchEvent(
        new Event(el.tagName === "SELECT" ? "change" : "input", {
          bubbles: true,
        }),
      );
    },
    { id, value },
  );
  await sleep(80);
}
async function pick(id, text) {
  const value = await page.eval(
    ({ id, text }) =>
      [...document.getElementById(id).options].find((o) =>
        o.textContent.includes(text),
      )?.value,
    { id, text },
  );
  assert(value, `Missing option ${text}`);
  await fill(id, value);
  return value;
}
async function submit() {
  const valid = await page.eval(() => {
    const f = document.querySelector("dialog[open] form");
    if (!f.reportValidity()) return false;
    f.requestSubmit();
    return true;
  });
  assert(valid, "Native form validation failed");
  await wait(() => !document.querySelector("dialog[open]"));
}
async function login(email) {
  await page.goto("http://localhost:3000/login");
  const status = await page.eval(
    async ({ email, password }) =>
      (
        await fetch("/api/session/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        })
      ).status,
    { email, password: local.password },
  );
  assert.equal(status, 200);
}
const localTime = (date) =>
  new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 16);
try {
  await page.send("Page.startScreencast", {
    format: "jpeg",
    quality: 70,
    maxWidth: 1440,
    maxHeight: 900,
    everyNthFrame: 2,
  });
  await login(local.email);
  await page.goto("http://localhost:3000/dashboard/courses");
  await wait(() => document.body.textContent.includes("Thêm gói học"));
  await click("Thêm khóa học mới");
  await fill("course-code", `DEMO-BROWSER-${suffix}`);
  await fill("course-name", courseName);
  await fill("course-goal", "Kiểm chứng luồng thật từ trình duyệt");
  await fill("course-price", 1500000);
  await fill("course-status", "active");
  await submit();
  await click("Thêm gói học");
  const courseId = await pick("courseId", courseName);
  await fill("code", `DEMO-PACK-${suffix}`);
  await fill("name", `DEMO · Gói browser ${suffix}`);
  await fill("sessionCount", 1);
  await fill("priceVnd", 1500000);
  await fill("status", "active");
  await submit();
  await page.goto("http://localhost:3000/dashboard/courses");
  await wait((name) => document.body.textContent.includes(name), courseName);
  await login(local.accounts?.branch_director?.email ?? "branch_director@class-demo.test");
  await page.goto("http://localhost:3000/dashboard/schedule");
  await wait(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent === "Tạo lớp" && !b.disabled,
    ),
  );
  await click("Tạo lớp");
  await fill("code", `DEMO-CLASS-${suffix}`);
  await fill("name", className);
  await fill("courseId", courseId);
  const packageId = await pick("packageId", `Gói browser ${suffix}`);
  await pick("branchId", "Quận 1");
  await pick("teacherId", "Giảng viên");
  await fill("onlineUrl", "https://example.test/demo-browser");
  await fill("capacity", 1);
  await fill("minimumSize", 0);
  const start = new Date(Date.now() + 30 * 86400000);
  start.setUTCSeconds(0, 0);
  const intervals = await page.eval(async () =>
    (await (await fetch("/api/v1/classes?pageSize=100")).json()).data.flatMap(
      (c) => c.sessions,
    ),
  );
  while (
    intervals.some(
      (s) =>
        Date.parse(s.startsAt) < start.getTime() + 3600000 &&
        Date.parse(s.endsAt) > start.getTime(),
    )
  )
    start.setUTCDate(start.getUTCDate() + 1);
  await fill(
    "registrationClosesAt",
    localTime(new Date(start.getTime() - 86400000)),
  );
  await fill("decisionAt", localTime(new Date(start.getTime() - 3600000)));
  await fill("sessions.0.startsAt", localTime(start));
  await fill(
    "sessions.0.endsAt",
    localTime(new Date(start.getTime() + 3600000)),
  );
  await submit();
  await wait(
    (name) =>
      [...document.querySelectorAll("tbody tr")].some((r) =>
        r.textContent.includes(name),
      ),
    className,
  );
  const selectClass = async () => {
    const found = await page.eval((name) => {
      const row = [...document.querySelectorAll("tbody tr")].find((r) =>
        r.textContent.includes(name),
      );
      row?.querySelector("button")?.click();
      return !!row;
    }, className);
    assert(found);
    await sleep(150);
  };
  await selectClass();
  await click("Chuyển PLANNED");
  await wait(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent === "Duyệt OPEN",
    ),
  );
  await click("Duyệt OPEN");
  await wait(
    (name) =>
      [...document.querySelectorAll("tbody tr")].some(
        (r) => r.textContent.includes(name) && r.textContent.includes("OPEN"),
      ),
    className,
  );
  await page.goto("http://localhost:3000/dashboard/schedule");
  await wait((name) => document.body.textContent.includes(name), className);
  await selectClass();
  const classId = await page.eval(async (name) => {
    const body = await (await fetch("/api/v1/classes?pageSize=100")).json();
    return body.data.find((c) => c.name === name)?.id;
  }, className);
  assert(classId);
  await login(local.accounts?.admissions?.email ?? "admissions@class-demo.test");
  await page.goto("http://localhost:3000/dashboard/schedule");
  await wait((name) => document.body.textContent.includes(name), className);
  await selectClass();
  await pick("fixture", "Học viên thử 1");
  await click("Giữ chỗ");
  await wait(() => document.body.textContent.includes("HELD"));
  await page.goto("http://localhost:3000/dashboard/schedule");
  await wait(() => document.body.textContent.includes("HELD"));
  await page.screenshot({ path: `${out}/hold-reload.jpg`, fullPage: true });
  const own = await page.eval(async (classId) => {
    const r = await (await fetch("/api/v1/holds")).json();
    return r.data.find((h) => h.classId === classId);
  }, classId);
  assert.equal(own.status, "HELD");
  // Scope cancellation to this run's hold rather than any previously created demo hold.
  await page.eval((id) => {
    const row = [...document.querySelectorAll("tbody tr")].find((r) =>
      r.textContent.includes(id.slice(0, 8)),
    );
    row.querySelector("button").click();
  }, own.id);
  await sleep(100);
  await click("Xác nhận hủy giữ chỗ");
  await wait(() => !document.querySelector("dialog[open]"));
  await selectClass();
  await pick("fixture", "Học viên thử 1");
  await click("Giữ chỗ");
  await wait(() => document.body.textContent.includes("HELD"));
  const holdData = await page.eval(async (classId) => {
    const holds = await (await fetch("/api/v1/holds")).json();
    const live = holds.data.find(
      (h) => h.classId === classId && h.status === "HELD",
    );
    await fetch(`/api/v1/holds/${live.id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return { id: live.id };
  }, classId);
  assert(holdData.id);
  // Concurrent browser requests pass through the authenticated BFF and Gateway.
  const race = await page.eval(
    async ({ classId, packageId }) => {
      const fixtures = (await (await fetch("/api/v1/hold-fixtures")).json())
        .data.fixtures;
      return Promise.all(
        fixtures.slice(1, 3).map(async (f) => {
          const r = await fetch("/api/v1/holds", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": crypto.randomUUID(),
            },
            body: JSON.stringify({
              classId,
              packageId,
              learnerId: f.learnerId,
              enrollmentId: f.enrollmentId,
            }),
          });
          const body = await r.json();
          return { status: r.status, id: body.data?.id };
        }),
      );
    },
    { classId, packageId },
  );
  assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
  for (const result of race)
    if (result.id)
      await page.eval(
        async (id) =>
          fetch(`/api/v1/holds/${id}/cancel`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          }).then((r) => r.status),
        result.id,
      );
  await page.goto("http://localhost:3000/dashboard/schedule");
  await wait((name) => document.body.textContent.includes(name), className);
  // A timed-out mutation keeps its intent key when retried, with no fabricated success.
  await selectClass();
  await pick("fixture", "Học viên thử 1");
  await page.send("Fetch.enable", {
    patterns: [{ urlPattern: "*/api/v1/holds", requestStage: "Request" }],
  });
  const intercept = browser.on(
    page.sessionId,
    "Fetch.requestPaused",
    (event) => {
      void page.send(
        event.request.method === "POST"
          ? "Fetch.failRequest"
          : "Fetch.continueRequest",
        event.request.method === "POST"
          ? { requestId: event.requestId, errorReason: "TimedOut" }
          : { requestId: event.requestId },
      );
    },
  );
  await click("Giữ chỗ");
  await wait(() =>
    document.body.textContent.includes("Không xác minh được kết quả"),
  );
  const failedKey = await page.eval(
    () =>
      JSON.parse(
        sessionStorage.getItem(
          Object.keys(sessionStorage).find((k) =>
            k.startsWith("class-hold-intent:"),
          ),
        ),
      ).key,
  );
  await page.screenshot({ path: `${out}/network-unknown.jpg`, fullPage: true });
  intercept();
  await page.send("Fetch.disable");
  await click("Giữ chỗ");
  await wait(() => document.body.textContent.includes("HELD"));
  assert.equal(
    await page.eval(
      () =>
        JSON.parse(
          sessionStorage.getItem(
            Object.keys(sessionStorage).find((k) =>
              k.startsWith("class-hold-intent:"),
            ),
          ),
        ).key,
    ),
    failedKey,
  );
  await page.eval(async (classId) => {
    const holds = (await (await fetch("/api/v1/holds")).json()).data;
    for (const h of holds.filter(
      (h) => h.classId === classId && h.status === "HELD",
    ))
      await fetch(`/api/v1/holds/${h.id}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
  }, classId);
  await page.goto("http://localhost:3000/dashboard/schedule");
  await wait((name) => document.body.textContent.includes(name), className);
  for (const width of [1440, 768, 390]) {
    await page.setViewport({ width, height: 900, mobile: width < 600 });
    await page.screenshot({
      path: `${out}/schedule-${width}.jpg`,
      fullPage: true,
    });
    assert(
      await page.eval(() => document.documentElement.scrollWidth <= innerWidth),
      `Page overflow at ${width}`,
    );
  }
  // A failed initial load must not report a verified zero or an empty hold list.
  await page.send("Network.enable");
  await page.send("Network.setBlockedURLs", { urls:["*/api/v1/classes*","*/api/v1/rooms*","*/api/v1/holds*"] });
  try {
    await page.goto("http://localhost:3000/dashboard/schedule");
    await wait(()=>document.body.textContent.includes("Chưa xác minh số lớp") && document.body.textContent.includes("Trạng thái chưa xác định"));
    assert(await page.eval(()=>!["0 lớp theo bộ lọc","Chưa có giữ chỗ","Chưa có lớp phù hợp"].some(text=>document.body.textContent.includes(text))));
    await page.screenshot({path:`${out}/outage-initial.jpg`,fullPage:true});
  } finally { await page.send("Network.setBlockedURLs",{urls:[]}); }
  // Keyboard focus stays in the native dialog, Escape closes it and restores the opener.
  await login(local.accounts?.branch_director?.email ?? "branch_director@class-demo.test");
  await page.goto("http://localhost:3000/dashboard/schedule");
  await wait(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent === "Tạo lớp" && !b.disabled,
    ),
  );
  await page.eval(() => {
    const b = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Tạo lớp",
    );
    b.focus();
    b.click();
  });
  await sleep(150);
  assert(
    await page.eval(() =>
      document.querySelector("dialog[open]").contains(document.activeElement),
    ),
  );
  await page.screenshot({ path: `${out}/class-form-390.jpg`, fullPage: true });
  await page.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await page.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await wait(() => !document.querySelector("dialog[open]"));
  assert.equal(
    await page.eval(() => document.activeElement.textContent),
    "Tạo lớp",
  );
  assert.deepEqual(page.consoleErrors, []);
  const logout = await page.eval(
    async () => (await fetch("/api/session/logout", { method: "POST" })).status,
  );
  assert.equal(logout, 204);
  await click("Làm mới");
  await wait(() => location.pathname === "/login");
  console.log(
    JSON.stringify({
      passed: true,
      courseId,
      packageId,
      classId,
      checks: [
        "Portal course/package/class forms",
        "PLANNED to OPEN",
        "reload persistence",
        "hold/reload/cancel/rehold",
        "BFF concurrent last-seat race",
        "1440/768/390 overflow",
        "keyboard dialog and focus",
        "no JS exceptions",
        "timeout retry preserves idempotency key",
        "expired session redirects to login",
        "failed initial load never reports empty data or zero classes",
      ],
    }),
  );
} finally {
  await page.send("Page.stopScreencast");
  off();
  await Promise.all(pendingFrames);
  await browser.close();
  if (frames) {
    const result = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-framerate",
        "5",
        "-i",
        `${out}/frame-%05d.jpg`,
        "-frames:v",
        String(frames),
        "-vf",
        "scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        `${out}/demo.mp4`,
      ],
      { stdio: "pipe", windowsHide: true },
    );
    if (result.status !== 0)
      console.error("Video encoding failed; screenshots retained");
    else console.log(`Video: ${out}/demo.mp4 (${frames} frames)`);
    if(result.status===0) await Promise.all(Array.from({length:frames},(_,i)=>unlink(`${out}/frame-${String(i+1).padStart(5,"0")}.jpg`).catch(()=>{})));
  }
  if(process.env.KEEP_BROWSER_TEST_DATA!=="true") {
    const cleanup=spawnSync(process.execPath,["scripts/clean-demo-test-data.mjs"],{stdio:"inherit",windowsHide:true});
    if(cleanup.status!==0) throw new Error("Browser data cleanup failed");
  }
}
