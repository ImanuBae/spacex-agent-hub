// Credentials stay in this process environment and browser memory, never artifacts.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const skill = process.env.TASTE_SKILL_ROOT ?? join(process.env.USERPROFILE ?? process.env.HOME, ".agents/skills/design-taste-frontend");
const { Browser } = await import(pathToFileURL(join(skill, "scripts/lib/cdp.mjs")).href);
if (!process.env.QA_PORTAL_ORIGIN || !process.env.QA_EMAIL || !process.env.QA_PASSWORD) throw new Error("QA_PORTAL_ORIGIN, QA_EMAIL and QA_PASSWORD required");
const launch = Browser.launch.bind(Browser);
Browser.launch = async (...args) => {
  const browser = await launch(...args), page = await browser.newPage();
  try {
    await page.goto(`${process.env.QA_PORTAL_ORIGIN}/login`);
    const status = await page.eval(async credentials => (await fetch("/api/session/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(credentials) })).status,
      { email: process.env.QA_EMAIL, password: process.env.QA_PASSWORD });
    if (status !== 200) throw new Error(`Inspector login failed (${status})`);
    await page.close(); return browser;
  } catch (error) { await browser.close(); throw error; }
};
await import(pathToFileURL(join(skill, "scripts/inspect.mjs")).href);
