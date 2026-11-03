// Run against a production Portal: node scripts/test-landing-browser.mjs http://localhost:3101
// Add --ui-only when IAM/Gateway are unavailable; authenticated integration is skipped.
// Uses the same installed Chrome/CDP helper as the class acceptance checks.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const skill =
  process.env.TASTE_SKILL_ROOT ??
  join(
    process.env.USERPROFILE ?? process.env.HOME,
    ".agents/skills/design-taste-frontend",
  );
const { Browser, sleep } = await import(
  pathToFileURL(join(skill, "scripts/lib/cdp.mjs")).href
);
const base = process.argv[2] ?? "http://localhost:3101";
const uiOnly = process.argv.includes("--ui-only");
const out = ".local/landing-v2";
await mkdir(out, { recursive: true });
const browser = await Browser.launch();
const checks = [];
const consoleErrors = [];
const attachConsole = (page) =>
  browser.on(page.sessionId, "Runtime.consoleAPICalled", (event) => {
    if (event.type === "error")
      consoleErrors.push(
        event.args.map((arg) => arg.value ?? arg.description ?? "").join(" "),
      );
  });

async function wait(page, fn) {
  for (let i = 0; i < 100; i++) {
    if (await page.eval(fn)) return;
    await sleep(100);
  }
  throw new Error("Browser condition timed out");
}
async function press(page, selector, key = "Enter") {
  await page.eval(
    (selector) => document.querySelector(selector).focus(),
    selector,
  );
  const code = key === "Enter" ? "Enter" : "Space";
  const virtual = key === "Enter" ? 13 : 32;
  await page.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode: virtual,
    text: key === "Enter" ? "\r" : " ",
  });
  await page.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode: virtual,
  });
  await sleep(100);
}
async function fill(page, id, value) {
  await page.eval(
    ({ id, value }) => {
      const input = document.getElementById(id);
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { id, value },
  );
}

try {
  for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920]) {
    const page = await browser.newPage({
      width,
      height: 900,
      mobile: width < 600,
    });
    attachConsole(page);
    await page.goto(base);
    assert.equal(
      await page.eval(
        () =>
          performance
            .getEntriesByType("resource")
            .filter((item) => item.name.includes("/api/session")).length,
      ),
      0,
      "Public landing never polls authentication",
    );
    assert.equal(
      await page.eval(() => location.pathname),
      "/",
      "Public root must not redirect to login",
    );
    assert.equal(
      await page.eval(() => document.querySelectorAll("h1").length),
      1,
    );
    assert(
      await page.eval(() =>
        [...document.querySelectorAll('a[href^="#"]')].every((a) =>
          document.querySelector(a.getAttribute("href")),
        ),
      ),
      "Anchor destinations exist",
    );
    assert(
      await page.eval(() => document.documentElement.scrollWidth <= innerWidth),
      `No horizontal overflow at ${width}`,
    );
    assert.equal(
      await page.eval(
        () =>
          document.querySelector(".lp-seat-count [data-current-count]")
            .textContent,
      ),
      "3",
    );
    await press(page, ".lp-hold");
    assert.equal(
      await page.eval(
        () =>
          document.querySelector(".lp-seat-count [data-current-count]")
            .textContent,
      ),
      "2",
    );
    assert.equal(
      await page.eval(
        () => document.querySelectorAll(".lp-seats .is-held").length,
      ),
      2,
    );
    assert(
      await page.eval(() =>
        document
          .querySelector('[role="status"]')
          .textContent.includes("Đã giữ 1 chỗ"),
      ),
    );
    await press(page, ".lp-hold", " ");
    assert.equal(
      await page.eval(
        () =>
          document.querySelector(".lp-seat-count [data-current-count]")
            .textContent,
      ),
      "3",
    );
    await press(page, ".lp-filters button:last-child");
    assert.equal(
      await page.eval(
        () => document.querySelector(".lp-seat-title").textContent,
      ),
      "Python cơ bản",
    );
    assert.equal(
      await page.eval(
        () =>
          document.querySelector(".lp-seat-count [data-current-count]")
            .textContent,
      ),
      "8",
    );
    await press(page, ".lp-hold");
    await press(page, ".lp-filters button:first-child");
    if (
      await page.eval(
        () =>
          getComputedStyle(document.querySelector(".lp-mobile-class"))
            .display !== "none",
      )
    ) {
      await page.eval(() => {
        const select = document.querySelector("#lp-class-select");
        select.value = "office";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    } else await press(page, ".lp-class:nth-child(2)");
    await wait(
      page,
      () =>
        document.querySelector(".lp-seat-title").textContent ===
        "Tin học văn phòng",
    );
    assert.equal(
      await page.eval(
        () =>
          document.querySelector(".lp-seat-count [data-current-count]")
            .textContent,
      ),
      "4",
    );
    assert(
      await page.eval(() =>
        document.querySelector('[role="status"]').textContent.includes("Tin học văn phòng"),
      ),
      "Changing class replaces the previous hold announcement",
    );
    await press(page, ".lp-filters button:last-child");
    assert(
      await page.eval(() =>
        document.querySelector('[role="status"]').textContent.includes("Bạn đang giữ 1 chỗ"),
      ),
      "Returning to a held class explains its existing hold",
    );
    assert.equal(
      await page.eval(() => document.querySelector(".lp-hold").getAttribute("aria-pressed")),
      "true",
    );
    await press(page, ".lp-questions details:nth-child(2) summary");
    assert(
      await page.eval(
        () => document.querySelector(".lp-questions details:nth-child(2)").open,
      ),
    );
    await page.goto(base);
    assert.equal(
      await page.eval(
        () =>
          document.querySelector(".lp-seat-count [data-current-count]")
            .textContent,
      ),
      "3",
      "Reload resets sample holds",
    );
    await press(page, ".lp-nav-action");
    await wait(page, () => location.pathname === "/login");
    assert(
      await page.eval(() => document.documentElement.scrollWidth <= innerWidth),
      `Login overflow at ${width}`,
    );
    await page.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });
    assert.equal(
      await page.eval(
        () => getComputedStyle(document.querySelector("#login-email")).color,
      ),
      "rgb(25, 27, 28)",
      "Dark preference keeps readable fields",
    );
    if (width !== 320)
      await page.screenshot({
        path: `${out}/login-${width}.jpg`,
        fullPage: true,
      });
    await fill(page, "login-password", "sample-only");
    await press(page, ".entry-password button");
    assert.equal(
      await page.eval(() => document.querySelector("#login-password").type),
      "text",
    );
    await press(page, ".entry-password button");
    assert.equal(
      await page.eval(() => document.querySelector("#login-password").type),
      "password",
    );
    assert.equal(page.consoleErrors.length, 0, "No browser exceptions");
    checks.push(
      `${width}px: root, anchors, hold/cancel, filter, class selection, FAQ, reset, login, dark contrast, password visibility`,
    );
    await page.close();
  }

  const reduced = await browser.newPage({
    width: 390,
    height: 844,
    reducedMotion: true,
  });
  await reduced.goto(base);
  await reduced.wheel(2000);
  assert.equal(await reduced.eval(() => document.getAnimations().length), 0);
  assert(
    await reduced.eval(() =>
      [...document.querySelectorAll("h1,h2,h3")].every(
        (el) => getComputedStyle(el).opacity === "1",
      ),
    ),
  );
  await reduced.close();
  checks.push("Reduced motion: no animations, all headings readable");

  const plain = await browser.newPage();
  await plain.send("Emulation.setScriptExecutionDisabled", { value: true });
  await plain.goto(base);
  await plain.screenshot({ path: `${out}/no-javascript.jpg` });
  await plain.send("Emulation.setScriptExecutionDisabled", { value: false });
  assert(
    await plain.eval(() =>
      document.querySelector("h1").textContent.includes("Rõ lớp"),
    ),
  );
  await plain.close();
  checks.push(
    "Without JavaScript: server-rendered page and demo fallback remain readable",
  );

  if (!uiOnly) {
    const login = await browser.newPage();
    attachConsole(login);
    await login.goto(`${base}/login`);
    await fill(login, "login-email", "landing-check@example.test");
    await fill(login, "login-password", "invalid-sample-password");
    await press(login, ".entry-submit");
    await wait(login, () => Boolean(document.querySelector('[role="alert"]')));
    assert(
      await login.eval(() =>
        document
          .querySelector('[role="alert"]')
          .textContent.includes("Email hoặc mật khẩu không đúng"),
      ),
    );
    checks.push("Real login rejects invalid credentials and announces the error");
    // Keep credentials in memory only; never print or photograph a populated login form.
    let demo;
    try {
      demo = JSON.parse(await readFile(".local/class-demo.json", "utf8"));
    } catch {
      /* optional isolated demo */
    }
    if (demo?.password) {
      await fill(login, "login-email", demo.accounts?.admissions?.email ?? "admissions@class-demo.test");
      await fill(login, "login-password", demo.password);
      await press(login, ".entry-submit");
      await wait(login, () => location.pathname.startsWith("/dashboard"));
      await login.eval(async () => {
        await fetch("/api/session/logout", { method: "POST" });
      });
      checks.push(
        "Real demo login reaches role-based dashboard; session logged out after check",
      );
    }
    assert.equal(login.consoleErrors.length, 0);
    await login.close();
  } else {
    checks.push("UI-only: IAM/Gateway credential integration was not run");
  }
  assert.deepEqual(
    consoleErrors,
    [],
    "No console.error including React hydration warnings",
  );
  checks.push(
    "React console.error and hydration warnings checked in addition to runtime exceptions",
  );
  await writeFile(
    `${out}/browser-check.json`,
    JSON.stringify({ passed: true, base, checks }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  await browser.close();
}
