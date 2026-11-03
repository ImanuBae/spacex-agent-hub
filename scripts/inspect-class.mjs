// Runs the installed taste inspector with a real HttpOnly Portal session.
// Credentials are read from ignored demo state, cookies remain in browser memory.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const skill =
  process.env.TASTE_SKILL_ROOT ??
  join(
    process.env.USERPROFILE ?? process.env.HOME,
    ".agents/skills/design-taste-frontend",
  );
const { Browser } = await import(
  pathToFileURL(join(skill, "scripts/lib/cdp.mjs")).href
);
const local = JSON.parse(await readFile(".local/class-demo.json", "utf8"));
const launch = Browser.launch.bind(Browser);
Browser.launch = async (...args) => {
  const browser = await launch(...args),
    page = await browser.newPage();
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
    {
      email: process.env.DEMO_INSPECT_EMAIL ?? local.accounts?.admissions?.email ?? "admissions@class-demo.test",
      password: local.password,
    },
  );
  if (status !== 200) {
    await browser.close();
    throw new Error(`Portal login failed (${status})`);
  }
  await page.close();
  return browser;
};
await import(pathToFileURL(join(skill, "scripts/inspect.mjs")).href);
