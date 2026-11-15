// Receives a fresh real N8N-05 runtime; never replaces its business APIs or starts another stack.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

export async function enrollmentBrowser({ origin, directory, email, password, selection, expectedStatus = "HELD", timeoutMs = 30000 }) {
  assert(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin), "Synthetic loopback Portal required");
  assert(email && password && directory && selection, "Owned runtime, synthetic account and offer IDs required");
  const dir = path.resolve(directory);
  assert(dir.startsWith(path.resolve(".local/automation") + path.sep), "Parent-owned private automation artifact directory required");
  await mkdir(dir, { recursive: true });
  const receipt = { status: "FAIL", startedAt: new Date().toISOString(), checks: [], requests: [], screenshots: [] };
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(timeoutMs);
    const exceptions = [];
    page.on("pageerror", error => exceptions.push(error.name));
    page.on("response", response => {
      const url = new URL(response.url());
      if (url.origin === origin && /^\/api\/v1\/enrollment/.test(url.pathname)) receipt.requests.push({ path: url.pathname, method: response.request().method(), status: response.status(), correlationId: response.headers()["x-correlation-id"] });
    });
    await page.goto(`${origin}/login`);
    await page.getByLabel("Email nhân viên", { exact: true }).fill(email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
    await page.getByRole("button", { name: /^Đăng nhập/ }).click();
    await page.waitForURL(/\/dashboard\//);
    receipt.checks.push("real IAM login through Portal form");
    await page.goto(`${origin}/dashboard/enrollments`);
    await page.getByLabel("Người liên hệ", { exact: true }).selectOption(selection.contactId);
    await page.getByLabel("Học viên", { exact: true }).selectOption(selection.learnerId);
    await page.getByLabel("Người trả tiền", { exact: true }).selectOption(selection.payerId);
    await page.getByLabel("Lớp học", { exact: true }).selectOption(selection.classId);
    await page.getByLabel("Gói học", { exact: true }).selectOption(selection.packageId);
    const previewResponse = page.waitForResponse(r => r.url() === `${origin}/api/v1/enrollment-confirmations/preview` && r.request().method() === "POST");
    await page.getByRole("button", { name: "Xem báo giá và điều khoản", exact: true }).click();
    const previewHttp = await previewResponse;
    assert(previewHttp.ok(), "Real backend accepted offer preview");
    const preview = (await previewHttp.json()).data;
    assert(preview.id && preview.snapshot && preview.expiresAt, "Durable preview ID, snapshot and server expiry returned");
    receipt.confirmationId = preview.id;
    const confirmButton = page.getByRole("button", { name: "Xác nhận mua", exact: true });
    await confirmButton.waitFor();
    assert(await confirmButton.isDisabled(), "Explicit agreement required before purchase confirmation");
    assert.equal(receipt.requests.filter(r => /\/confirm$/.test(r.path) && r.method === "POST").length, 0);
    assert.equal(await page.locator(".enrollment-result").getByText("Đã xác nhận chỗ học", { exact: true }).count(), 0);
    receipt.checks.push("preview is not enrollment confirmation and requires explicit checkbox");
    await page.getByRole("checkbox").check();
    const confirmedResponse = page.waitForResponse(r => r.url() === `${origin}/api/v1/enrollment-confirmations/${preview.id}/confirm` && r.request().method() === "POST");
    await confirmButton.click();
    assert((await confirmedResponse).ok(), "Explicit confirmation accepted by backend");
    let current;
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const response = await page.request.get(`${origin}/api/v1/enrollment-confirmations/${preview.id}`);
      assert(response.ok(), "Authorized confirmation lookup remains available");
      current = (await response.json()).data;
      if (current.enrollment?.status === expectedStatus && (expectedStatus !== "HELD" || current.enrollment.paymentRequest)) break;
      await delay(1000);
    }
    assert.equal(current.enrollment?.status, expectedStatus, "n8n/backend converged to expected durable state");
    assert.equal(current.enrollment.snapshot.learnerId, selection.learnerId);
    assert.equal(current.enrollment.snapshot.classId, selection.classId);
    assert.equal(current.enrollment.snapshot.packageId, selection.packageId);
    receipt.enrollmentId = current.enrollment.id;
    receipt.actualStatus = current.enrollment.status;
    if (expectedStatus === "HELD") {
      assert(current.enrollment.holdId && current.enrollment.paymentRequest, "QR follows a real durable Class hold");
      assert.equal(current.enrollment.paymentRequest.adapter, "SYNTHETIC");
      await page.getByRole("button", { name: "Tra cứu trạng thái", exact: true }).click();
      await page.getByRole("heading", { name: "Tiền và chỗ học", exact: true }).waitFor();
      assert.equal(await page.locator(".enrollment-result").getByText("Đã xác nhận chỗ học", { exact: true }).count(), 0, "Current enrollment cannot be displayed as confirmed early");
      await page.getByText("tổng hợp — không dùng chuyển tiền thật", { exact: false }).waitFor();
      const qrImage=page.getByRole("img",{name:"QR DEMO tổng hợp — không chuyển tiền thật",exact:true});await qrImage.scrollIntoViewIfNeeded();await qrImage.evaluate(img=>img.decode());
      assert(await qrImage.evaluate(img=>img.complete&&img.naturalWidth===256),"Synthetic QR image loads from the real Payment request");
      receipt.checks.push("real hold and synthetic QR rendered with no early paid/seat claim");
    }
    await page.reload();
    await page.locator(`tr[data-enrollment-id="${current.enrollment.id}"]`).getByRole("button", { name: "Xem trạng thái", exact: true }).click();
    await page.getByText(`Mã xác nhận:`, { exact: false }).waitFor();
    assert((await page.locator(".enrollment-result").innerText()).includes(preview.id), "Reload resolves the same durable confirmation");
    receipt.checks.push("reload and record lookup recover the same backend enrollment");
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1), `No document overflow at ${width}`);
      const name = `enrollments-${width}.png`, file = path.join(dir, name);
      await page.screenshot({ path: file, fullPage: true });
      receipt.screenshots.push({ file: name, sha256: createHash("sha256").update(await readFile(file)).digest("hex") });
    }
    assert.equal(exceptions.length, 0, "No uncaught browser JavaScript exceptions");
    receipt.checks.push("1440/768/390px screenshots, no document overflow or page errors");
    receipt.status = "PASS";
    return receipt;
  } catch (error) {
    receipt.errorClass = error.name;
    receipt.failure = String(error.message).replaceAll(password, "[REDACTED]").replaceAll(email, "[REDACTED]");
    // eslint-disable-next-line preserve-caught-error -- Playwright's original cause can expose login credentials; retain the redacted failure privately.
    throw new Error("N8N-05 browser acceptance failed; inspect private enrollment-browser-receipt.json");
  } finally {
    receipt.completedAt = new Date().toISOString();
    await writeFile(path.join(dir, "enrollment-browser-receipt.json"), JSON.stringify(receipt, null, 2), { mode: 0o600 });
    await browser.close();
  }
}
