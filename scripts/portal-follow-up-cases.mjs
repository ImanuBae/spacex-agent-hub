/* global document, innerWidth */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { chromium } from "playwright-core";
import { staffLogin, studentLogin } from "./n8n06-portal.mjs";

export async function reconciliationAcceptance({ h, request, api, purchase, customer, offer, webhook, accountant, director, otherDirector, staff, password }) {
  const buy = async () => {
    const { classId, packageId } = await offer();
    return purchase({ ...await customer(), classId, packageId });
  };
  const underpaid = await buy(), overpaid = await buy();
  const amounts = [await webhook(underpaid.payment, { amount: 70_000 }), await webhook(overpaid.payment, { amount: 120_000 }),
    await webhook(overpaid.payment, { reference: "DEMO-WRONG-REFERENCE" })];
  const { rows: reviews } = await h.pools.payment.query("SELECT id,reason,branch_id,version FROM payment_reviews WHERE ledger_id=ANY($1) ORDER BY reason", [amounts.map(x => x.data.ledgerId)]);
  assert.deepEqual(reviews.map(x => x.reason), ["OVERPAID", "UNALLOCATED_REFERENCE", "UNDERPAID"]);
  const [, wrong, under] = reviews;
  const endpoint = "/api/v1/payment-reviews/" + under.id;
  const denied = [
    await request("payment", endpoint, "GET", undefined, staff.accessToken, 403),
    await request("payment", endpoint, "GET", undefined, otherDirector.accessToken, 403),
    await request("payment", endpoint + "/decision", "POST", { version: 1, decision: "EXTEND", reason: "DEMO wrong role" }, director.accessToken, 403),
  ].map(x => x.status);
  assert.equal((await api("payment", "/api/v1/payment-reviews", "GET", undefined, otherDirector.accessToken)).length, 0);
  const origin = await h.startPortal(), browser = await chromium.launch({ channel: "msedge", headless: true });
  const screenshots = [];
  let activePage;
  const shot = async (page, name, width) => {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const file = `reconciliation-${name}-${width}.png`;
    const bytes = await page.screenshot({ path: path.join(h.directory, file), animations: "disabled", fullPage: true });
    screenshots.push({ file, width, sha256: createHash("sha256").update(bytes).digest("hex") });
  };
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    activePage = page;
    await staffLogin(page, origin, accountant, password, "reconciliation");
    const queueRow = (p, id) => p.locator(`[data-review-id="${id}"]`);
    const open = (p, id) => queueRow(p, id).getByRole("button", { name: "Xem chứng từ" }).press("Enter");
    await page.getByText("Chuyển thừa", { exact: true }).waitFor();
    await open(page, wrong.id);
    await page.getByText("Chưa gán chi nhánh", { exact: true }).waitFor();
    const reason = page.getByLabel("Lý do đề xuất");
    await reason.fill("DEMO bản nháp giao dịch sai mã");
    await page.context().clearCookies();
    await page.reload();
    await page.getByText(/Đăng nhập lại bằng tài khoản vừa dùng/).waitFor();
    await page.getByLabel("Email nhân viên", { exact: true }).fill(accountant.email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
    await page.getByRole("button", { name: /^Đăng nhập/ }).click();
    await page.waitForURL("**/dashboard/reconciliation?review=" + wrong.id);
    await reason.waitFor();
    assert.equal(await reason.inputValue(), "DEMO bản nháp giao dịch sai mã");

    await open(page, under.id);
    await page.getByText("70.000 ₫", { exact: true }).waitFor();
    await reason.fill("ngắn");
    await page.getByRole("button", { name: "Gửi đề xuất" }).click();
    await page.getByRole("alert").filter({ hasText: "ít nhất 10 ký tự" }).waitFor();
    const draft = "DEMO kế toán kiểm tra số tiền thiếu và đề xuất gia hạn";
    await reason.fill(draft);
    await page.getByLabel("Phương án").selectOption("EXTEND");
    await api("payment", endpoint + "/decision", "POST", { version: 1, decision: "EXTEND", reason: "DEMO update by another session" }, accountant.accessToken);
    const stale = page.waitForResponse(r => r.url().endsWith(endpoint + "/decision") && r.status() === 409);
    await page.getByRole("button", { name: "Gửi đề xuất" }).click();
    assert.equal((await stale).status(), 409);
    await page.getByRole("alert").filter({ hasText: "Bản nháp vẫn có thể dùng lại" }).waitFor();
    assert.equal(await reason.inputValue(), draft);
    await page.getByRole("button", { name: "Tải lại chứng từ" }).click();
    await page.getByRole("button", { name: "Cập nhật đề xuất" }).click();
    await page.getByText("Đã gửi đề xuất để duyệt.", { exact: true }).waitFor();
    const pending = await api("payment", endpoint, "GET", undefined, director.accessToken);
    assert.equal(pending.decision.reason, draft);
    denied.push((await request("payment", endpoint + "/approve", "POST", { version: pending.version }, otherDirector.accessToken, 403)).status);
    denied.push((await request("payment", endpoint + "/approve", "POST", { version: pending.version }, accountant.accessToken, 403)).status);
    assert.equal((await request("payment", endpoint + "/approve", "POST", { version: 1 }, director.accessToken, 409)).status, 409);

    const approval = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    activePage = approval;
    await staffLogin(approval, origin, director, password, "overview");
    await approval.getByRole("link", { name: "Đối soát", exact: true }).click();
    await open(approval, under.id);
    await approval.getByRole("button", { name: "Duyệt đề xuất" }).press("Enter");
    await approval.getByText("Đã lưu quyết định duyệt.", { exact: true }).waitFor();
    for (const p of [approval, page]) {
      await p.reload();
      await p.getByRole("strong").filter({ hasText: "Đã duyệt · Gia hạn thêm 24 giờ" }).waitFor();
    }
    await open(page, reviews[0].id);
    await reason.fill("DEMO đề xuất chờ hoàn giao dịch chuyển thừa");
    await page.getByLabel("Phương án").selectOption("REFUND_PENDING");
    await page.getByRole("button", { name: "Gửi đề xuất" }).click();
    await page.getByText("Đã gửi đề xuất để duyệt.", { exact: true }).waitFor();
    await open(approval, reviews[0].id);
    await approval.getByRole("button", { name: "Duyệt đề xuất" }).click();
    await approval.getByText("Đã lưu quyết định duyệt.", { exact: true }).waitFor();
    await approval.reload();
    await approval.getByText("Chờ hoàn", { exact: true }).first().waitFor();
    for (const width of [1440, 768, 390]) await shot(approval, "director", width);
    const { rows: persisted } = await h.pools.payment.query("SELECT v.id,v.status,v.version,count(DISTINCT p.id)::int AS proposals,count(DISTINCT d.id)::int AS approvals FROM payment_reviews v LEFT JOIN payment_review_proposals p ON p.review_id=v.id LEFT JOIN payment_review_decisions d ON d.review_id=v.id WHERE v.id=ANY($1) GROUP BY v.id ORDER BY v.status", [[under.id, reviews[0].id]]);
    assert.deepEqual(persisted.map(x => [x.status, x.proposals, x.approvals]), [["EXTENDED", 2, 1], ["REFUND_PENDING", 1, 1]]);
    return { denied, stale: [409, 409], draftSurvived: ["reload after logout", "stale version"], persisted, screenshots };
  } catch (error) {
    if (activePage) await shot(activePage, "failure", 1440);
    throw error;
  } finally { await browser.close(); }
}

export async function contextualPortalAcceptance({ h, request, api, confirmed, offer, staff, director, accountant, password, waitDone }) {
  const origin = await h.startPortal();
  const source = await confirmed(), target = await offer({ priceVnd: 80_000 });
  const learner = (await api("crm", "/api/v1/crm/people/" + source.selection.learnerId, "GET", undefined, staff.accessToken)).person;
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const screenshots = [];
  const write = async (page, name, width) => {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const file = `context-${name}-${width}.png`;
    const bytes = await page.screenshot({ path: path.join(h.directory, file), animations: "disabled", fullPage: true });
    screenshots.push({ file, width, sha256: createHash("sha256").update(bytes).digest("hex") });
  };
  let activePage;
  try {
    const staffPage = await browser.newPage({ viewport: { width: 390, height: 900 } });
    activePage = staffPage;
    staffPage.setDefaultTimeout(12_000);
    await staffLogin(staffPage, origin, staff, password, "leads");
    await staffPage.getByRole("tab", { name: "Hồ sơ khách hàng" }).press("Enter");
    await staffPage.getByRole("button", { name: learner.fullName, exact: true }).press("Enter");
    await staffPage.getByRole("link", { name: "Đăng ký của học viên" }).press("Enter");
    const card = staffPage.locator(`[data-enrollment-id="${source.id}"]`);
    const view = card.getByRole("button", { name: "Xem trạng thái" });
    await view.waitFor();
    await card.scrollIntoViewIfNeeded();
    for (const item of [view, card.getByText(learner.fullName, { exact: true }), card.getByText("Đã xác nhận chỗ học", { exact: true }).filter({ visible: true })]) {
      const b = await item.boundingBox();
      assert(b && b.x >= 0 && b.x + b.width <= 390 && b.y >= 0 && b.y + b.height <= 900);
    }
    await write(staffPage, "registrations", 390);
    assert(await view.isEnabled());
    await view.focus();
    assert(await view.evaluate(el => el === document.activeElement), "Registration button receives keyboard focus");
    await staffPage.keyboard.press("Enter");
    await staffPage.getByRole("link", { name: "Bảo lưu", exact: true }).press("Enter");
    await staffPage.getByRole("heading", { name: "Lập yêu cầu" }).waitFor();
    assert.equal(await staffPage.getByLabel("Nghiệp vụ").inputValue(), "SUSPEND");
    assert.equal(await staffPage.getByLabel("Mã đăng ký").inputValue(), source.id);
    await staffPage.goBack();
    await view.click();
    await staffPage.getByRole("link", { name: "Chuyển lớp", exact: true }).press("Enter");
    const targetSelect = staffPage.getByLabel("Lớp đích");
    await targetSelect.selectOption(target.classId);
    const reason = "DEMO chuyển sang lớp chi phí thấp hơn";
    await staffPage.getByLabel("Lý do", { exact: true }).fill(reason);
    assert.equal(await staffPage.getByLabel("Phiên bản quyền lợi").count(), 0);
    const created = staffPage.waitForResponse(r => r.url().endsWith("/api/v1/adjustments") && r.request().method() === "POST" && r.status() === 201);
    await staffPage.getByRole("button", { name: "Gửi yêu cầu" }).press("Enter");
    const { data: adjustment } = await (await created).json();
    assert.equal(adjustment.enrollmentId, source.id);
    assert.equal(adjustment.amountDelta, -20_000);
    const approved = await api("enrollment", `/api/v1/adjustments/${adjustment.id}/approve`, "POST", { version: adjustment.version }, director.accessToken);

    const student = await browser.newPage({ viewport: { width: 390, height: 900 } });
    activePage = student;
    await studentLogin(student, origin, h, source.student);
    await student.getByRole("button", { name: "Đồng ý phương án" }).press("Enter");
    const waiting = await waitDone("WF-09", adjustment.id, "WAITING");
    const movement = student.locator(`[data-adjustment-id="${adjustment.id}"]`);
    await student.reload();
    await movement.getByText("Chờ hoàn", { exact: true }).waitFor();
    const pending = await api("payment", `/api/v1/refunds/${adjustment.id}`, "GET", undefined, accountant.accessToken);
    assert.equal(pending.receiptRef, null);
    await api("payment", `/api/v1/refunds/${adjustment.id}/execute`, "POST", { version: pending.version }, accountant.accessToken);
    const done = await waitDone("WF-09", adjustment.id);
    await student.reload();
    await movement.getByText("Đã hoàn", { exact: true }).waitFor();
    await movement.getByText("20.000 ₫", { exact: true }).waitFor();
    const studentRow = student.locator(`[data-enrollment-id="${source.id}"]`);
    await studentRow.getByText("100.000 ₫", { exact: true }).waitFor();
    await studentRow.getByText("80.000 ₫", { exact: true }).waitFor();
    const [receipt] = (await h.pools.payment.query("SELECT id,direction,amount::int FROM synthetic_payment_executions WHERE adjustment_id=$1", [adjustment.id])).rows;
    assert.equal(receipt.direction, "REFUND"); assert.equal(receipt.amount, 20_000);
    await movement.getByText(receipt.id, { exact: false }).waitFor();
    for (const width of [390, 768, 1440]) await write(student, "student", width);

    activePage = staffPage;
    await staffPage.goto(origin + "/dashboard/enrollments#registrations");
    await view.click();
    await staffPage.getByRole("link", { name: "Nhắc lịch", exact: true }).press("Enter");
    const currentClassName = staffPage.getByRole("definition").filter({ hasText: target.course.name });
    await currentClassName.waitFor();
    const reminder = "/api/v1/notifications";
    const currentClass = await api("class-schedule", "/api/v1/classes/" + target.classId, "GET", undefined, director.accessToken);
    const stale = await request("notification", reminder, "POST", { enrollmentId: source.id, classId: source.selection.classId, template: "REMINDER", sourceVersion: currentClass.version }, staff.accessToken, 409);
    const due = staffPage.getByLabel("Giờ gửi (giờ Việt Nam)");
    await due.fill(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 16));
    const save = staffPage.getByRole("button", { name: "Lưu thông báo" });
    await save.press("Enter");
    await staffPage.getByRole("alert").filter({ hasText: "Giờ gửi phải trước buổi học" }).waitFor();
    await due.fill("");
    const saved = staffPage.waitForResponse(r => r.url().endsWith(reminder) && r.request().method() === "POST" && r.status() === 201);
    await save.press("Enter");
    const savedBody = (await saved).request().postDataJSON();
    assert.equal(savedBody.classId, target.classId);
    assert.equal(savedBody.sourceVersion, currentClass.version);
    await staffPage.reload();
    await currentClassName.waitFor();
    for (const width of [390, 768, 1440]) await write(staffPage, "reminder", width);
    return { enrollmentId: source.id, approvalVersion: approved.version, waiting, done, receipt, staleSchedule: stale.status, reminderVersion: savedBody.sourceVersion, screenshots };
  } catch (error) {
    if (activePage) await write(activePage, "failure", 390);
    throw error;
  } finally { await browser.close(); }
}
