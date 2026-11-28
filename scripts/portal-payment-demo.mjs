import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { chromium } from "playwright-core";
import { staffLogin, studentLogin } from "./n8n06-portal.mjs";

const base = "/api/v1";
const transactions = base + "/payment-transactions";
const demoCourses = [
  ["DEMO-PYTHON", "DEMO-PYTHON-8", 8, 1_800_000],
  ["DEMO-SQL", "DEMO-SQL-10", 10, 2_100_000],
  ["DEMO-POWER-BI", "DEMO-POWER-BI-12", 12, 2_800_000],
  ["DEMO-FIGMA", "DEMO-FIGMA-10", 10, 2_400_000],
];

export async function paymentDemoAcceptance(t) {
  const { h, api, request, customer, offer, preparePayment, webhook, claim, step, finish,
    staff, accountant, director, otherDirector, otherAccountant, branch, otherBranch, password } = t;
  const fixture = await offer();
  const people = await customer();
  async function seed(pass) {
    await h.runNode([path.join(h.root, "node_modules/tsx/dist/cli.mjs"), "src/db/seed.ts"],
      { ...h.hostEnv, DATABASE_URL: h.domainUrls.catalog }, path.join(h.root, "services/catalog"), `catalog-seed-${pass}.log`);
    const [courses, packages] = await Promise.all(["courses", "packages"].map(resource => request("catalog", `${base}/${resource}?pageSize=100`)));
    return {
      courses: courses.data.sort((a, b) => a.code.localeCompare(b.code)),
      packages: packages.data.sort((a, b) => a.code.localeCompare(b.code)),
      totalCourses: courses.body.pagination.total,
      totalPackages: packages.body.pagination.total,
    };
  }
  const seeded = await seed(1);
  assert.deepEqual(await seed(2), seeded);
  assert.deepEqual([seeded.totalCourses, seeded.totalPackages], [9, 8]);
  for (const [courseCode, packageCode, sessions, price] of demoCourses) {
    const course = seeded.courses.find(row => row.code === courseCode);
    assert(course?.description && course.goal && course.level && course.deliveryModes.length);
    assert.equal(course.priceVnd, price);
    const pkg = seeded.packages.find(row => row.code === packageCode);
    assert.deepEqual([pkg.courseId, pkg.sessionCount, pkg.priceVnd], [course.id, sessions, price]);
  }
  assert(seeded.packages.some(row => row.id === fixture.packageId));
  await h.runNode([path.join(h.root, "node_modules/vitest/vitest.mjs"), "run"],
    { ...h.hostEnv, CATALOG_TEST_DATABASE_URL: h.domainUrls.catalog },
    path.join(h.root, "services/catalog"), "catalog-test-db.log");

  const origin = await h.startPortal();
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const screenshots = [];
  async function capture(page, name) {
    for (const [width, height] of [[1440, 900], [768, 1024], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), name + " overflows");
      if (name === "enrollment-qr" && width === 390) {
        const facts = await page.locator(".enrollment-payment-facts").boundingBox();
        assert(facts && facts.y >= 0 && facts.y + facts.height < height, "Payment amount, reference and states fit the first mobile screen");
      }
      const file = `demo-${name}-${width}.png`;
      await page.screenshot({ path: path.join(h.directory, file), fullPage: true, animations: "disabled" });
      screenshots.push(file);
    }
  }
  async function open(actor, route) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await staffLogin(page, origin, actor, password, route);
    return page;
  }
  try {
    const enroll = await open(staff, "courses");
    const catalog = enroll.getByRole("region", { name: "Danh sách khóa học" });
    const search = catalog.getByRole("searchbox", { name: "Tên hoặc mã khóa học" });
    await search.fill("phan tich du lieu voi power bi");
    await enroll.getByRole("heading", { name: "Phân tích dữ liệu với Power BI" }).waitFor();
    await catalog.getByLabel("Trình độ", { exact: true }).selectOption("advanced");
    await enroll.getByText("Không tìm thấy khóa học phù hợp.").waitFor();
    await catalog.getByLabel("Trình độ", { exact: true }).selectOption("intermediate");
    await catalog.getByLabel("Trạng thái", { exact: true }).selectOption("active");
    await enroll.getByRole("heading", { name: "Phân tích dữ liệu với Power BI" }).waitFor();
    await enroll.getByRole("button", { name: /Xem lịch sử của Phân tích/ }).press("Enter");
    await enroll.getByRole("button", { name: "Tải lịch sử" }).press("Enter");
    await enroll.getByRole("heading", { name: /Phiên bản 1/ }).waitFor();
    await enroll.keyboard.press("Escape");
    await capture(enroll, "catalog");
    await enroll.getByRole("link", { name: /Tìm lớp Phân tích/ }).press("Enter");
    await enroll.getByText("Chưa có lớp mở cho gói này.").waitFor();
    await enroll.goto(origin + "/dashboard/courses");
    await search.fill(fixture.course.code);
    await enroll.getByRole("link", { name: new RegExp("Tìm lớp " + fixture.course.code) }).press("Enter");

    for (const [label, id] of [["Người liên hệ", people.contactId], ["Học viên", people.learnerId], ["Người trả tiền", people.payerId], ["Lớp học", fixture.classId]]) {
      await enroll.getByLabel(label, { exact: true }).selectOption(id);
    }
    assert.equal(await enroll.getByLabel("Gói học", { exact: true }).inputValue(), fixture.packageId);
    const [quote] = await Promise.all([
      enroll.waitForResponse(response => response.url().endsWith("/enrollment-confirmations/preview") && response.request().method() === "POST"),
      enroll.getByRole("button", { name: "Xem báo giá và điều khoản" }).press("Enter"),
    ]);
    assert.equal(quote.status(), 201);
    const { data: confirmation } = await quote.json();
    await enroll.getByRole("checkbox", { name: /Tôi xác nhận/ }).press("Space");
    const [write] = await Promise.all([
      enroll.waitForResponse(response => response.url().endsWith("/confirm") && response.request().method() === "POST"),
      enroll.getByRole("button", { name: "Xác nhận mua" }).press("Enter"),
    ]);
    assert(write.ok());
    const source = (await h.pools.enrollment.query("SELECT * FROM confirmations WHERE id=$1", [confirmation.id])).rows[0];
    const registration = await preparePayment(confirmation, source);
    const qr = enroll.getByRole("img", { name: "QR DEMO thanh toán" });
    await qr.waitFor();
    assert.match(await qr.getAttribute("src"), /^data:image\/png/);
    await enroll.getByText("Chưa ghi nhận tiền", { exact: true }).waitFor();
    await enroll.getByText("Đang giữ chỗ", { exact: true }).waitFor();
    await capture(enroll, "enrollment-qr");

    const paid = await webhook(registration.payment, { transactionId: "DEMO-PORTAL-EXACT" });
    const job = await claim("WF-06");
    const route = "/internal/enrollment/enrollments/" + registration.id;
    await step(job, "enrollment.execute", "enrollment", route + "/confirming");
    await step(job, "classes.enroll", "class-schedule", "/internal/classes/enrollments/" + registration.id + "/commit", { matchRef: paid.data.matchRef });
    await step(job, "enrollment.execute", "enrollment", route + "/confirm");
    await finish(job);
    await qr.waitFor({ state: "hidden" });
    await enroll.getByText("Đã đối soát đủ tiền", { exact: true }).waitFor();
    await webhook(registration.payment, { transactionId: "DEMO-PORTAL-EXCESS", amount: 30_000 });
    const unassigned = await webhook(registration.payment, { transactionId: "DEMO-PORTAL-UNASSIGNED", reference: "DEMO-UNKNOWN" });

    // Isolate branch visibility and pagination with immutable, labelled ledger fixtures.
    const pay = h.pools.payment;
    const foreignPayment = randomUUID(), foreignLedger = randomUUID();
    await pay.query(`INSERT INTO payment_requests(id,enrollment_id,branch_id,snapshot,amount_due,reference,expires_at,operation_key)
      VALUES($1,$2,$3,'{}',100000,'DEMO-OTHER-BRANCH',now()+interval '1 hour',$4)`, [foreignPayment, randomUUID(), otherBranch, randomUUID()]);
    await pay.query(`INSERT INTO payment_ledger(id,provider,account,transaction_id,payload,amount,reference,payment_id)
      VALUES($1,'SYNTHETIC','DEMO-N8N05','DEMO-FOREIGN-LEDGER','{}',100000,'DEMO-OTHER-BRANCH',$2)`, [foreignLedger, foreignPayment]);
    await pay.query(`INSERT INTO payment_ledger(id,provider,account,transaction_id,payload,amount,reference,payment_id)
      SELECT gen_random_uuid(),'SYNTHETIC','DEMO-N8N05','DEMO-PAGE-'||number,'{}',1000,$1,$2 FROM generate_series(1,19) AS number`,
    [registration.payment.reference, registration.payment.id]);

    const exactUrl = `${transactions}?id=${paid.data.ledgerId}`, foreignUrl = `${transactions}?id=${foreignLedger}`;
    const other = await otherAccountant();
    for (const actor of [accountant, director]) {
      assert.equal((await api("payment", exactUrl, "GET", undefined, actor.accessToken))[0].status, "ALLOCATED");
      assert.deepEqual(await api("payment", foreignUrl, "GET", undefined, actor.accessToken), []);
    }
    for (const actor of [other, otherDirector]) {
      assert.deepEqual(await api("payment", exactUrl, "GET", undefined, actor.accessToken), []);
      assert.equal((await api("payment", foreignUrl, "GET", undefined, actor.accessToken))[0].status, "RECEIVED");
    }
    assert.equal((await api("payment", foreignUrl)).length, 1);
    const unassignedUrl = `${transactions}?id=${unassigned.data.ledgerId}`;
    const [owned] = await api("payment", unassignedUrl, "GET", undefined, accountant.accessToken);
    assert(owned.reviewId);
    assert.deepEqual(await api("payment", unassignedUrl, "GET", undefined, director.accessToken), []);
    const reviewRoute = base + "/payment-reviews/" + owned.reviewId;
    const review = await api("payment", reviewRoute, "GET", undefined, accountant.accessToken);
    await api("payment", reviewRoute + "/decision", "POST", { version: review.version, decision: "REFUND_PENDING", reason: "DEMO sai mã chuyển khoản" }, accountant.accessToken);
    await request("payment", reviewRoute + "/approve", "POST", { version: review.version + 1 }, director.accessToken, 403);
    await request("payment", transactions, "GET", undefined, staff.accessToken, 403);
    await request("payment", transactions + "?pageSize=101", "GET", undefined, accountant.accessToken, 400);

    const finance = await open(accountant, "finance");
    await finance.getByRole("link", { name: "Hoàn tiền", exact: true }).last().waitFor();
    await finance.getByRole("button", { name: "Trang sau" }).press("Enter");
    await finance.getByText("Trang 2 / 2").waitFor();
    await finance.getByRole("button", { name: "Trang trước" }).press("Enter");
    const code = finance.getByRole("searchbox");
    const find = finance.getByRole("button", { name: "Tìm giao dịch" });
    await code.fill("demo-portal-exact");
    await find.press("Enter");
    const exact = finance.locator("li.finance-transaction").filter({ hasText: "DEMO-PORTAL-EXACT" });
    await exact.getByText("Đã phân bổ", { exact: true }).waitFor();
    const time = new Date(await exact.locator("time").getAttribute("datetime"));
    assert.equal(await exact.locator("time").textContent(), new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(time));
    await exact.getByRole("link", { name: "Xem chứng từ" }).press("Enter");
    await finance.getByRole("region", { name: "Chứng từ giao dịch" }).getByText("DEMO-PORTAL-EXACT").waitFor();
    await finance.getByRole("link", { name: "Đóng chứng từ" }).press("Enter");
    await code.fill("NO-DEMO-MATCH");
    await find.press("Enter");
    await finance.getByText("Không có giao dịch phù hợp.").waitFor();
    await code.fill(registration.payment.reference);
    await finance.getByLabel("Trạng thái", { exact: true }).selectOption("REVIEW");
    await finance.route("**/api/v1/payment-transactions?*", route => route.fulfill({
      status: 503, json: { error: { code: "TEST_UNAVAILABLE", message: "Không thể tải giao dịch thử nghiệm." } },
    }));
    await find.press("Enter");
    await finance.getByRole("alert").getByText("Không thể tải giao dịch thử nghiệm.").waitFor();
    await finance.unroute("**/api/v1/payment-transactions?*");
    await finance.getByRole("button", { name: "Thử lại" }).press("Enter");
    const excess = finance.locator("li.finance-transaction").filter({ hasText: "DEMO-PORTAL-EXCESS" });
    await excess.getByText("Cần đối soát", { exact: true }).waitFor();
    assert.equal(await finance.locator("li.finance-transaction").count(), 1);
    await capture(finance, "finance");
    await excess.getByRole("link", { name: "Mở ca đối soát" }).press("Enter");
    await finance.waitForURL(/\/dashboard\/reconciliation\?review=/);
    await finance.getByRole("region", { name: "Chi tiết đối soát" }).getByText("DEMO-PORTAL-EXCESS", { exact: true }).waitFor();
    await capture(finance, "reconciliation");

    const scope = await open(otherDirector, "finance");
    await scope.getByText("DEMO-FOREIGN-LEDGER", { exact: true }).waitFor();
    assert.equal(await scope.getByRole("link", { name: "Hoàn tiền", exact: true }).count(), 0);
    assert.deepEqual((await (await scope.request.get(origin + exactUrl)).json()).data, []);

    const personDetail = await api("crm", `${base}/crm/people/${people.learnerId}`);
    const person = personDetail.person ?? personDetail;
    const email = `demo-learner-${randomUUID()}@automation.test`;
    await api("crm", `${base}/crm/people/${people.learnerId}`, "PUT",
      { version: person.version, input: { branchId: branch, kind: person.kind, fullName: person.fullName, phone: person.phone, email, notes: person.notes } });
    const learner = await api("identity", base + "/learner-identities", "POST",
      { learnerId: people.learnerId, branchId: branch, email, name: "DEMO Học viên" }, undefined, 201);
    const student = await browser.newPage();
    let unavailableNotifications = 0;
    await student.route("**/api/v1/notifications", route => {
      unavailableNotifications++;
      return route.fulfill({ status: 503, json: { error: { code: "TEST_UNAVAILABLE" } } });
    });
    await studentLogin(student, origin, h, { email, id: learner.accountId });
    const noticePanel = student.locator("section").filter({ has: student.getByRole("heading", { name: "Thông báo", exact: true }) });
    const noticeError = noticePanel.getByRole("alert");
    const retryNotice = noticeError.getByRole("button", { name: "Thử lại" });
    await retryNotice.waitFor();
    assert.match(await noticeError.textContent(), /Không thể tải thông báo\./);
    assert(unavailableNotifications > 0);
    const entitlement = student.locator(`[data-enrollment-id="${registration.id}"]`);
    await entitlement.getByRole("button", { name: "Xem lịch và link lớp" }).press("Enter");
    await student.getByRole("link", { name: "Vào lớp", exact: true }).waitFor();
    const label = await student.getByLabel("Đăng ký", { exact: true }).locator(`option[value="${registration.id}"]`).textContent();
    assert.match(label, /^ĐK [A-F0-9]{8}/);
    await capture(student, "student-notifications-503");
    await student.unroute("**/api/v1/notifications");
    const [retry] = await Promise.all([
      student.waitForResponse(response => response.url().endsWith("/api/v1/notifications")),
      retryNotice.press("Enter"),
    ]);
    assert.equal(retry.status(), 200);
    await student.getByText("Bạn chưa có thông báo.").waitFor();
    assert(await entitlement.isVisible());
    assert(await student.getByRole("link", { name: "Vào lớp", exact: true }).isVisible());
    await student.getByLabel("Đăng ký", { exact: true }).selectOption(registration.id);
    await student.getByLabel("Tên người nhận").fill("DEMO Người nhận");
    await student.getByLabel("Địa chỉ").fill("DEMO địa chỉ");
    await student.getByRole("button", { name: "Tạo hóa đơn mô phỏng" }).press("Enter");
    const file = student.getByRole("link", { name: "Tải hóa đơn" });
    await file.waitFor();
    const invoice = await student.request.get(origin + await file.getAttribute("href"));
    assert.equal(invoice.status(), 200);
    assert.match(await invoice.text(), /DEMO · MÔ PHỎNG — KHÔNG CÓ GIÁ TRỊ PHÁP LÝ/);
    return { screenshots, fixtureClassId: fixture.classId, enrollmentId: registration.id, seeded: { courses: 8, packages: 7, rerunUnchanged: true },
      branches: "accountants/directors scoped both ways; central director sees both; unassigned visible to owner", notificationRetry: 200 };
  } finally { await browser.close(); }
}
