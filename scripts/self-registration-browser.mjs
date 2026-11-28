import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, devices } from "playwright-core";
import QRCode from "qrcode";
import { staffLogin, studentLogin } from "./n8n06-portal.mjs";
import { parseN8nOutput } from "./n8n-output.mjs";

const wait = async (probe, label, timeout = 35000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const result = await probe();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  throw new Error(label + " timed out");
};

async function workflows(h, registrationWorker, notificationWorker) {
  const records = [];
  for (const name of ["registration", "adjustment"]) {
    const manifest = JSON.parse(await readFile(`workflows/n8n/${name}-manifest.json`, "utf8"));
    records.push(...manifest.workflows.filter(row => ["WF-05", "WF-06", "WF-07", "WF-10"].includes(row.workflowId)));
  }
  const collection = "/home/node/.n8n/self-registration";
  h.compose("exec", "-T", "n8n", "mkdir", "-p", collection);
  async function copy(name, bytes) {
    const file = path.join(h.directory, name);
    await writeFile(file, bytes, { mode: 0o600 });
    const remote = collection + "/" + name;
    h.compose("cp", file, "n8n:" + remote);
    return remote;
  }
  const credentials = records.map(record => {
    const worker = record.workflowId === "WF-10" ? notificationWorker : registrationWorker;
    return { id: record.credentialId, name: record.credential, type: "httpCustomAuth",
      data: { json: JSON.stringify({ body: { clientId: worker.id, clientSecret: worker.clientSecret } }) } };
  });
  h.cli("import:credentials", "--input=" + await copy("checkout-credentials-private.json", JSON.stringify(credentials)));
  const mapping = { 4002: h.iamPort, 4004: h.classesPort, 4005: h.crmPort, 4006: h.bridgePort, 4008: h.enrollmentPort, 4009: h.paymentPort, 4010: h.ports.notification };
  const bindings = [];
  for (const record of records) {
    const canonical = await readFile(record.file, "utf8");
    assert.equal(createHash("sha256").update(canonical).digest("hex"), record.sha256);
    const binding = canonical.replace(/http:\/\/host\.docker\.internal:(\d+)\//g, (_, port) => {
      assert(mapping[port], "Workflow host port mapped");
      return `http://${h.backendHost}:${mapping[port]}/`;
    });
    bindings.push(...JSON.parse(binding));
  }
  h.cli("import:workflow", "--input=" + await copy("checkout-workflow-bindings.json", JSON.stringify(bindings)));
  let executions = 0;
  return async (wf, entityId) => {
    const job = await wait(async () => (await h.pool.query(`SELECT id,status FROM automation_jobs
      WHERE workflow_id=$1 AND entity->>'id'=$2 AND status<>'DONE' ORDER BY created_at DESC LIMIT 1`, [wf, entityId])).rows[0], wf + " broker job");
    let result = job;
    for (let run = 0; run < 4; run++) {
      await wait(async () => {
        const { rows } = await h.pool.query(`SELECT COALESCE(lease_expires_at,next_attempt_at,clock_timestamp())<=clock_timestamp() AS ready
          FROM automation_jobs WHERE id=$1`, [job.id]);
        return rows[0]?.ready;
      }, wf + " original job lease or retry deadline", 75000);
      const output = h.cli("execute", "--id=" + records.find(record => record.workflowId === wf).id, "--rawOutput");
      await writeFile(path.join(h.directory, `checkout-${wf}-${++executions}-execution-private.log`), output, { mode: 0o600 });
      assert(!parseN8nOutput(output).data.resultData.error, wf + " returned a workflow error");
      result = (await h.pool.query("SELECT status,error_code FROM automation_jobs WHERE id=$1", [job.id])).rows[0];
      if (result.status === "DONE" || result.status === "DEAD") break;
    }
    assert.equal(result.status, "DONE", wf + " did not complete: " + result.error_code);
  };
}

export async function selfRegistrationAcceptance({ h, api, offer, customer, staff, password, worker, adjustmentWorker, edgesOnly }) {
  const selections = await Promise.all([offer(), offer(), offer(), offer(), offer({ status: "PLANNED" })]);
  const staffPeople = await customer();
  const origin = await h.startPortal();
  const execute = await workflows(h, worker, adjustmentWorker);
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const checks = [];
  const screen = (page, name) => page.screenshot({ path: path.join(h.directory, `checkout-${name}.png`) });
  const fit = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const email = "nguoi-hoc-moi@automation.test";
  const learnerRow = async id => (await h.pools.enrollment.query("SELECT * FROM enrollments WHERE confirmation_id=$1", [id])).rows[0];
  const checkoutHeading = (p, title) => p.getByRole("heading", { name: title, exact: true }).waitFor();
  async function openClass(page) {
    const url = "https://example.test/demo";
    await page.context().route(url, route => route.fulfill({ body: "DEMO online class", contentType: "text/plain" }));
    const nextClass = page.locator(".student-next");
    await nextClass.getByText("Buổi tiếp theo", { exact: false }).waitFor();
    const link = nextClass.getByRole("link", { name: "Vào lớp", exact: true });
    assert.equal(await link.getAttribute("href"), url);
    const popup = page.waitForEvent("popup");
    await link.press("Enter");
    const tab = await popup;
    await tab.waitForURL(url);
    await tab.getByText("DEMO online class", { exact: true }).waitFor();
    await tab.close();
    await page.context().unroute(url);
  }
  let transactionId = 260000000;
  async function receipt(reference, amount, replay = false) {
    const timestamp = String(Math.floor(Date.now()/1000)), body = JSON.stringify({
      id: ++transactionId, accountNumber: h.checkout.account, transferType: "in", transferAmount: amount, code: reference,
    });
    const headers = { "content-type": "application/json", "x-sepay-timestamp": timestamp,
      "x-sepay-signature": "sha256=" + createHmac("sha256", h.checkout.sePaySecret).update(timestamp + ".").update(body).digest("hex") };
    for (let i = 0; i < (replay ? 2 : 1); i++) {
      const response = await fetch(h.urls.payment + "/webhooks/sepay", { method: "POST", headers, body });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { success: true });
    }
    assert.equal((await h.pools.payment.query("SELECT count(*)::int AS n FROM payment_ledger WHERE transaction_id=$1", [String(transactionId)])).rows[0].n, 1);
  }
  async function otpCode(address) {
    return wait(async () => {
      const { rows } = await h.pools.notification.query(`SELECT m.body FROM notification_mailbox m JOIN notification_intents i ON i.id=m.intent_id
        WHERE m.recipient=$1 AND i.template='OTP' ORDER BY m.created_at DESC LIMIT 1`, [address]);
      return rows[0]?.body.match(/\b\d{6}\b/)?.[0];
    }, "isolated OTP mailbox");
  }
  async function deadline(service, wf, principal, route) {
    const { accessToken } = await h.iamCall("/internal/iam/machine/token", {
      clientId: principal.id, clientSecret: principal.clientSecret, audience: "automation-bridge",
      scopes: [wf === "WF-07" ? "automation:authorize" : "automation:claim"], workflows: [wf], ttlSeconds: 60,
    });
    return api(service, route, "POST", {}, accessToken);
  }
  async function paymentPage(page, selection, address, pathFromList = false) {
    const route = "/khoa-hoc/" + selection.packageId;
    if (pathFromList) {
      await page.getByRole("banner").getByRole("link", { name: "Xem khóa học", exact: true }).click();
      await page.getByRole("link", { name: "Xem chi tiết " + selection.package.name, exact: true }).click();
      await page.waitForURL(origin + route);
    } else await page.goto(origin + route);
    await checkoutHeading(page, selection.package.name);
    await checkoutHeading(page, "Mục tiêu học");
    await page.getByText("DEMO local acceptance", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Đăng ký học", exact: true }).click();
    await page.getByLabel("Họ và tên").fill("Học viên kiểm thử");
    const emailInput = page.getByRole("textbox", { name: /^Email\b/ });
    await emailInput.fill("email-sai");
    await page.getByLabel("Số điện thoại").fill("0901234567");
    await page.getByLabel("Năm sinh").fill("2001");
    await page.getByLabel("Địa chỉ").fill("Địa chỉ kiểm thử");
    await page.getByLabel("Ghi chú").fill("Học vào cuối tuần");
    await page.getByRole("button", { name: "Kiểm tra đăng ký" }).click();
    await page.getByText("Nhập email hợp lệ.").waitFor();
    assert.equal(await page.getByLabel("Họ và tên").inputValue(), "Học viên kiểm thử");
    await emailInput.fill(address);
    await page.getByRole("button", { name: "Kiểm tra đăng ký" }).click();
    await checkoutHeading(page, "Kiểm tra đăng ký");
    await page.getByText(address, { exact: true }).waitFor();
    const confirm = page.getByRole("button", { name: "Xác nhận và thanh toán" });
    assert(await confirm.isDisabled());
    await page.getByRole("checkbox").check();
    const confirmed = page.waitForResponse(response => /\/public-checkouts\/[^/]+\/confirm$/.test(response.url()));
    await confirm.dblclick();
    const response = await confirmed;
    assert.equal(response.status(), 202);
    const { id } = (await response.json()).data;
    const body = response.request().postDataJSON(), headers = { "x-checkout-key": response.request().headers()["x-checkout-key"], origin };
    assert.equal((await page.request.post(response.url(), { headers, data: body })).status(), 202);
    assert.equal((await page.request.get(`${origin}/api/v1/public-checkouts/${id}`)).status(), 400);
    const { enrollment_id: enrollmentId } = (await h.pools.enrollment.query("SELECT enrollment_id FROM self_registrations WHERE id=$1", [id])).rows[0];
    await execute("WF-05", enrollmentId);
    await checkoutHeading(page, "Chờ thanh toán");
    const qr = page.getByRole("img", { name: "VietQR thanh toán qua SePay" });
    await qr.waitFor();
    const src = new URL(await qr.getAttribute("src"));
    assert.equal(src.host, "vietqr.app");
    assert.equal(src.searchParams.get("bank"), "MB");
    assert.equal(src.searchParams.get("acc"), h.checkout.account);
    const amount = Number(src.searchParams.get("amount")), reference = src.searchParams.get("des");
    assert.equal(amount, selection.package.priceVnd);
    assert.match(reference, /^SX[A-F0-9]{12}$/);
    await page.getByText("Hạn giữ chỗ", { exact: true }).waitFor();
    await page.reload();
    await checkoutHeading(page, "Chờ thanh toán");
    assert.equal(await qr.getAttribute("src"), src.href);
    assert(await fit(page));
    assert.equal((await h.pools.payment.query("SELECT count(*)::int AS n FROM payment_requests WHERE enrollment_id=$1", [enrollmentId])).rows[0].n, 1);
    return { id, enrollmentId, reference, amount };
  }
  try {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const mobile = await browser.newPage({ ...devices["Pixel 7"], defaultBrowserType: "chromium" });
    const exceptions = [];
    for (const page of [desktop, mobile]) {
      page.setDefaultTimeout(25000);
      page.on("pageerror", error => exceptions.push(error.name));
      await page.route(/^https:\/\/vietqr\.app\/img\?/, async route => {
        const png = await QRCode.toBuffer("ISOLATED BROWSER FIXTURE " + new URL(route.request().url()).searchParams.get("des"), { width: 220 });
        await route.fulfill({ body: png, contentType: "image/png" });
      });
      if (edgesOnly) continue;
      await page.goto(origin);
      const open = page.getByRole("button", { name: "Tư vấn", exact: true });
      await open.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Tư vấn khóa học" });
      await dialog.waitFor();
      await dialog.getByRole("button", { name: "Bắt đầu tư vấn" }).click();
      const editor = dialog.getByRole("textbox", { name: "Tin nhắn" });
      await editor.fill("Tôi muốn hỏi lịch học.");
      await editor.press("Enter");
      await dialog.getByText("Tôi muốn hỏi lịch học.", { exact: true }).waitFor();
      if (page === mobile) {
        await editor.focus();
        await page.setViewportSize({ width: 390, height: 450 });
        await wait(() => editor.evaluate(element => {
          const viewport = window.visualViewport, box = element.getBoundingClientRect();
          return !!viewport && viewport.height <= 451 && box.top >= viewport.offsetTop - 1 && box.bottom <= viewport.offsetTop + viewport.height + 1;
        }), "Composer remains visible in a shortened viewport", 10000);
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await screen(page, page === desktop ? "desktop-chat" : "mobile-chat");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert(await open.evaluate(button => button === document.activeElement));
      await open.click();
      await dialog.getByText("Tôi muốn hỏi lịch học.", { exact: true }).waitFor();
      await dialog.getByRole("button", { name: "Đóng tư vấn" }).click();
      assert(await fit(page));
    }
    if (!edgesOnly) {
      checks.push("Desktop/mobile chat, keyboard, close/reopen and shortened mobile viewport");
      console.log("PASS Sandbox desktop and mobile");

      for (const [index, page] of [desktop, mobile].entries()) {
        const order = await paymentPage(page, selections[index], email, index === 0);
        await screen(page, index === 0 ? "desktop-payment" : "mobile-payment");
        await receipt(order.reference, order.amount, true);
        await checkoutHeading(page, "Đang xác nhận chỗ");
        assert.equal(await page.getByRole("button", { name: "Gửi mã xác minh email" }).count(), 0);
        await execute("WF-06", order.enrollmentId);
        await checkoutHeading(page, "Đăng ký thành công");
        await screen(page, index === 0 ? "desktop-success" : "mobile-success");
        const enrollment = await learnerRow(order.id);
        assert.equal(enrollment.status, "CONFIRMED");
        const intentId = await wait(async () => (await h.pools.notification.query("SELECT id FROM notification_intents WHERE enrollment_id=$1 AND template='ENROLLMENT_CONFIRMED'", [order.enrollmentId])).rows[0]?.id, "confirmed notification intent");
        await deadline("notification", "WF-10", adjustmentWorker, "/internal/notification/deadlines");
        await execute("WF-10", intentId);
        const currentIntent = async () => (await h.pools.notification.query("SELECT status,error_code FROM notification_intents WHERE id=$1", [intentId])).rows[0];
        assert.equal((await currentIntent()).error_code, "AWAITING_VERIFIED_EMAIL");
        assert.equal((await h.pools.identity.query("SELECT count(*)::int AS n FROM accounts WHERE email=$1", [email])).rows[0].n, index);
        assert.equal((await h.pools.identity.query("SELECT count(*)::int AS n FROM learner_identities WHERE enrollment_id=$1", [order.enrollmentId])).rows[0].n, 0);
        await page.getByRole("button", { name: "Gửi mã xác minh email" }).click();
        const input = page.getByLabel("Mã xác minh");
        await input.waitFor();
        if (index === 0) {
          const firstCode = await otpCode(email);
          await input.fill(firstCode === "000000" ? "000001" : "000000");
          await page.getByRole("button", { name: "Xác minh và đăng nhập" }).click();
          await page.getByText("Mã xác minh sai hoặc đã hết hạn.").waitFor();
          const sent = page.waitForResponse(response => response.url().endsWith("/checkout-request") && response.ok());
          await page.getByRole("button", { name: "Gửi lại mã" }).click();
          await sent;
          await page.reload();
          await input.waitFor();
        }
        await input.fill(await otpCode(email));
        await page.getByRole("button", { name: "Xác minh và đăng nhập" }).click();
        await page.waitForURL(origin + "/student");
        const card = page.locator(`[data-enrollment-id="${order.enrollmentId}"]`);
        await card.getByText(selections[index].package.name, { exact: true }).waitFor();
        await card.getByRole("button", { name: "Xem lịch và link lớp" }).click();
        await card.getByRole("heading", { name: selections[index].package.name, exact: true }).waitFor();
        await openClass(page);
        await wait(async () => (await h.pools.notification.query("SELECT due_at<=clock_timestamp() AS due FROM notification_intents WHERE id=$1", [intentId])).rows[0].due, "deferred notification due");
        await deadline("notification", "WF-10", adjustmentWorker, "/internal/notification/deadlines");
        await execute("WF-10", intentId);
        assert.equal((await currentIntent()).status, "SENT");
        await page.getByText("Xác nhận đăng ký học", { exact: true }).nth(index).waitFor();
        assert.equal(await page.locator("[data-enrollment-id]").count(), index + 1);
        assert.equal(await page.getByText("Xác nhận đăng ký học", { exact: true }).count(), index + 1);
        assert(await fit(page));
        await page.evaluate(() => window.scrollTo(0, 0));
        await screen(page, index === 0 ? "desktop-student" : "mobile-student");
        assert.equal((await h.pools.identity.query("SELECT count(*)::int AS n FROM accounts WHERE email=$1", [email])).rows[0].n, 1);
        assert.equal((await h.pools.identity.query("SELECT count(*)::int AS n FROM learner_identities WHERE enrollment_id=$1", [order.enrollmentId])).rows[0].n, 1);
        console.log(index === 0 ? "PASS Desktop new learner, SePay, mailbox OTP and WF-10" : "PASS Mobile existing learner and both enrollments");
      }
      checks.push("Real WF-05/WF-06, signed SePay webhook replay, UI readback and same QR after reload");
      checks.push("Mailbox OTP, wrong code, resend/reload, one account for two orders, WF-10 verification race, student schedule and portal notices");

      const student = (await h.pools.identity.query("SELECT id,email FROM accounts WHERE email=$1", [email])).rows[0];
      await desktop.getByRole("button", { name: "Đăng xuất", exact: true }).click();
      await studentLogin(desktop, origin, h, student);
      await desktop.locator("[data-enrollment-id]").nth(1).waitFor();
      assert.equal(await desktop.locator("[data-enrollment-id]").count(), 2);
      await openClass(desktop);
      await mobile.getByRole("button", { name: "Đăng xuất", exact: true }).click();
      await studentLogin(mobile, origin, h, student);
      await mobile.locator("[data-enrollment-id]").nth(1).waitFor();
      await openClass(mobile);
      checks.push("Returning student OTP login, next schedule and class link opens a new tab on desktop and mobile");
    }

    const expired = await paymentPage(desktop, selections[2], "het-han@automation.test");
    await h.pools["class-schedule"].query("UPDATE holds SET expires_at=clock_timestamp()-interval '1 second' WHERE enrollment_id=$1", [expired.enrollmentId]);
    await h.pools.enrollment.query("UPDATE enrollments SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [expired.enrollmentId]);
    await h.pools.payment.query("UPDATE payment_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE enrollment_id=$1", [expired.enrollmentId]);
    await checkoutHeading(desktop, "Hết hạn");
    await screen(desktop, "desktop-expired");
    assert.equal(await desktop.getByRole("img", { name: "VietQR thanh toán qua SePay" }).count(), 0);
    await deadline("enrollment", "WF-07", worker, "/internal/enrollment/deadlines");
    await execute("WF-07", expired.enrollmentId);
    assert.equal((await learnerRow(expired.id)).status, "EXPIRED");
    await receipt(expired.reference, expired.amount - 1);
    await checkoutHeading(desktop, "Cần đối soát");
    await screen(desktop, "desktop-review");
    checks.push("Server-driven hold expiry, WF-07 closure and late mismatched transfer review");

    await mobile.goto(origin + "/khoa-hoc/" + selections[4].packageId);
    await mobile.getByText("Hiện chưa có lớp đang mở phù hợp với gói này.").waitFor();
    await mobile.getByRole("button", { name: "Hỏi tư vấn" }).click();
    await mobile.getByRole("dialog", { name: "Tư vấn khóa học" }).waitFor();
    checks.push("Unavailable class explains the reason and opens Sandbox in place");

    const staffPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await staffPage.route(/^https:\/\/vietqr\.app\/img\?/, route => route.abort());
    await staffLogin(staffPage, origin, staff, password, "enrollments");
    for (const [label, value] of [["Người liên hệ", staffPeople.contactId], ["Học viên", staffPeople.learnerId], ["Người trả tiền", staffPeople.payerId],
      ["Lớp học", selections[3].classId], ["Gói học", selections[3].packageId]]) await staffPage.getByLabel(label, { exact: true }).selectOption(value);
    await staffPage.getByRole("button", { name: "Xem báo giá và điều khoản" }).click();
    await staffPage.getByRole("checkbox").check();
    const confirmed = staffPage.waitForResponse(response => /\/enrollment-confirmations\/[^/]+\/confirm$/.test(response.url()));
    await staffPage.getByRole("button", { name: "Xác nhận mua" }).click();
    const response = await confirmed;
    assert(response.ok());
    const { id } = (await response.json()).data;
    const { enrollment_id: staffOrderId } = (await h.pools.enrollment.query("SELECT enrollment_id FROM confirmations WHERE id=$1", [id])).rows[0];
    await execute("WF-05", staffOrderId);
    const payment = (await h.pools.payment.query("SELECT reference,amount_due FROM payment_requests WHERE enrollment_id=$1", [staffOrderId])).rows[0];
    assert.match(payment.reference, /^SX[A-F0-9]{12}$/);
    await receipt(payment.reference, Number(payment.amount_due));
    await execute("WF-06", staffOrderId);
    await staffPage.getByRole("button", { name: "Tra cứu trạng thái", exact: true }).click();
    await staffPage.locator(".enrollment-result").getByRole("definition").filter({ hasText: "Đã xác nhận chỗ học" }).waitFor();
    checks.push("Staff Portal purchase and confirmed seat through the same SePay workflow");
    assert.deepEqual(exceptions, []);
    return { checks, desktop: true, mobile: true, externalQrImage: "intercepted for fictitious account", moneyMoved: false };
  } finally { await browser.close(); }
}
