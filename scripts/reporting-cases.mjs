/* global document, innerWidth */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { connectBroker } from "@spacex/messaging";
import { reportDay } from "@spacex/contracts";
import { parseN8nOutput } from "./n8n-output.mjs";
import { chromium } from "playwright-core";
import { staffLogin } from "./n8n06-portal.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const metrics = row => [row.confirmed, row.received, row.refunded, row.unassignedReceived];
export async function reportingAcceptance({ h, api, request, confirmed, adjustment, offer, webhook, waitDone, director, otherDirector, staff, accountant, branch }) {
  const manifest = JSON.parse(await readFile("workflows/n8n/reporting-manifest.json", "utf8"));
  const canonicalBytes = await readFile(manifest.file, "utf8"), [canonical] = JSON.parse(canonicalBytes);
  assert.equal(sha(canonicalBytes), manifest.sha256);
  assert.equal(canonical.active, false);
  assert.equal(canonical.settings.timezone, "Asia/Saigon");
  const [copy] = JSON.parse(canonicalBytes.replace(/http:\/\/host\.docker\.internal:(4002|4006|4011)\//g, (_match, port) =>
    `http://${h.backendHost}:${{ 4002: h.iamPort, 4006: h.bridgePort, 4011: h.ports.reporting }[port]}/`));
  copy.versionId = randomUUID();
  Object.assign(copy.settings, { saveDataSuccessExecution: "all", saveDataErrorExecution: "all", saveManualExecutions: true });
  copy.nodes.find(n => n.name === "Daily close").parameters.rule.interval[0].expression = "*/10 * * * * *";
  assert.deepEqual(copy.connections, canonical.connections);
  const credentials = [{ id: manifest.credentialId, name: manifest.credential, type: "httpCustomAuth",
    data: { json: JSON.stringify({ body: { clientId: h.reportingWorker.id, clientSecret: h.reportingWorker.clientSecret } }) } }];
  const directory = "/home/node/.n8n/wf11";
  h.compose("exec", "-T", "n8n", "mkdir", "-p", directory);
  const save = (file, data) => writeFile(path.join(h.directory, file), data, { mode: 0o600, flag: "wx" });
  const binding = JSON.stringify([copy]);
  for (const [file, data, command] of [["wf11-bound-private.json", binding, "import:workflow"], ["wf11-credential-private.json", JSON.stringify(credentials), "import:credentials"]]) {
    await save(file, data);
    h.compose("cp", path.join(h.directory,file), "n8n:"+directory+"/"+file);
    await save("wf11-"+command.replace(":", "-")+".log", h.cli(command, "--input="+directory+"/"+file));
  }
  const active = () => h.sql("SELECT active::text FROM workflow_entity WHERE id='N8N07LocalWF11'");
  assert.equal(active(), "false");
  const day = reportDay(new Date()), previous = reportDay(new Date(Date.now() - 86_400_000));
  const period = `start=${previous}&end=${day}`;
  const current = `start=${day}&end=${day}`;
  const get = (query, actor) => api("reporting", "/api/v1/reports?" + query, "GET", undefined, actor?.accessToken);
  assert.equal((await get(current)).coveredDays, 0);
  const order = await confirmed(), target = await offer({ priceVnd: 80_000 }), transfer = await adjustment(order, { target });
  const waiting = await waitDone("WF-09", transfer.id, "WAITING");
  const refund = await api("payment", "/api/v1/refunds/"+transfer.id, "GET", undefined, accountant.accessToken);
  assert.equal(refund.status, "RESERVED"); assert.equal(refund.receiptRef, null);
  const outside = await webhook(order.payment, { amount: 7000, reference: "DEMO-REPORT-UNASSIGNED" });
  const cutoff = new Date(`${day}T00:00:00+07:00`);
  for (const [offset, amount] of [[-1, 3000], [0, 5000]]) {
    const id = randomUUID();
    await h.pools.payment.query(`INSERT INTO payment_ledger(id,provider,account,transaction_id,payload,amount,reference,received_at)
      VALUES($1,'SYNTHETIC','DEMO-WF11',$1::uuid::text,'{}',$2,'DEMO-BOUNDARY',$3)`, [id, amount, new Date(cutoff.getTime()+offset)]);
  }
  const token = (await h.iamCall("/internal/iam/machine/token", { clientId: h.reportingWorker.id, clientSecret: h.reportingWorker.clientSecret,
    audience: "reporting", scopes: ["reporting:project"], workflows: ["WF-11"], ttlSeconds: 300 })).accessToken;
  const rebuild = (start,end) => api("reporting", "/internal/reporting/rebuild", "POST", { start,end }, token);
  await rebuild(day,day);
  assert.deepEqual(metrics(await get(current)), ["1","100000","0","12000"]);
  await api("payment", "/api/v1/refunds/"+transfer.id+"/execute", "POST", { version: refund.version }, accountant.accessToken);
  const paid = await waitDone("WF-09", transfer.id);

  const jobs = async () => (await h.pool.query("SELECT id,status,event_id,result_ref FROM automation_jobs WHERE workflow_id='WF-11' ORDER BY created_at,id")).rows;
  await h.eventually(async () => (await jobs()).length === 4, "Login-free WF11 jobs from real Enrollment/Payment outboxes");
  const raw = h.cli("execute", "--id="+manifest.id, "--rawOutput");
  await save("wf11-manual-private.log", raw);
  assert.equal(parseN8nOutput(raw).data.resultData.error, undefined);
  assert.equal((await jobs()).filter(j => j.status === "DONE").length, 1);
  h.cli("publish:workflow", "--id="+manifest.id);
  h.compose("stop", "--timeout", "5", "n8n");
  h.compose("up", "-d", "--no-deps", "--pull", "never", "n8n");
  assert.equal(active(), "true");
  await h.eventually(async () => (await jobs()).every(j => j.status === "DONE"), "WF11 automatic poll finishes remaining jobs");
  await h.eventually(async () => (await get(period)).coveredDays === 2, "Local WF11 cron reconciles previous day");

  const full = await get(period), scoped = await get(current + "&branchId=" + branch, director);
  assert.deepEqual(metrics(full), ["1","100000","20000","15000"]);
  assert.deepEqual(metrics(scoped), ["1","100000","20000","0"]);
  assert.deepEqual(metrics(await get(`start=${previous}&end=${previous}`)), ["0","0","0","3000"]);
  assert.deepEqual(metrics(await get(current)), ["1","100000","20000","12000"]);
  const denied = await Promise.all([
    request("reporting", "/api/v1/reports?"+current+"&branchId="+branch, "GET", undefined, otherDirector.accessToken, 403),
    request("reporting", "/api/v1/reports?"+current+"&branchId=unassigned", "GET", undefined, director.accessToken, 403),
    request("reporting", "/api/v1/reports?"+current, "GET", undefined, staff.accessToken, 403),
    request("payment", "/internal/reporting/source?"+current, "GET", undefined, token, 401),
  ]);
  assert.deepEqual(metrics(await get(current, otherDirector)), ["0","0","0","0"]);
  const saved = await jobs();
  const event = (await h.pools.payment.query("SELECT event FROM event_outbox WHERE event->>'type'='reporting.refresh_requested' AND event->>'correlationId'=$1", [outside.data.ledgerId])).rows[0].event;
  const broker = await connectBroker(h.runtime.RABBITMQ_URL, () => {});
  try { await broker.publish(event); } finally { await broker.close(); }
  const duplicate = await api("reporting", "/internal/reporting/project", "POST", { day, eventId: event.id }, token);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(await jobs(), saved);
  assert.deepEqual(metrics(await get(period)), metrics(full));
  const checkpoints = (await h.pools.reporting.query("SELECT count(*)::int AS count FROM report_event_checkpoints")).rows[0].count;
  assert.equal(checkpoints, saved.length);
  await h.pools.reporting.query("DELETE FROM report_daily WHERE day=$1", [day]);
  assert.deepEqual(metrics(await get(current)), ["0","0","0","0"]);
  await rebuild(previous, day);
  assert.deepEqual(metrics(await get(period)), metrics(full));
  const [dbOrder] = (await h.pools.enrollment.query("SELECT status FROM enrollments WHERE id=$1", [order.id])).rows;
  const [dbMoney] = (await h.pools.payment.query("SELECT amount::int FROM payment_ledger WHERE payment_id=$1", [order.payment.id])).rows;
  const [dbRefund] = (await h.pools.payment.query("SELECT amount::int,direction FROM synthetic_payment_executions WHERE adjustment_id=$1", [transfer.id])).rows;
  assert.deepEqual([dbOrder.status,dbMoney.amount,dbRefund.amount,dbRefund.direction], ["CONFIRMED",100000,20000,"REFUND"]);
  assert.equal(sha(await readFile(manifest.file)), manifest.sha256);
  const executions = JSON.parse(h.sql("SELECT json_agg(json_build_object('id',id,'status',status) ORDER BY id) FROM execution_entity WHERE \"workflowId\"='N8N07LocalWF11'"));
  assert(executions.some(e=>e.status==="success"));
  return { period: full, scoped, sourceProof: { orderId:order.id, dbOrder, dbMoney, dbRefund, waiting, paid }, jobs: saved, checkpoints, duplicate, boundary: cutoff.toISOString(),
    denied: denied.map(r=>r.status), executions, cronObserved: true, binding: { canonicalSha256: manifest.sha256, sha256: sha(binding), initiallyInactive: true, project: h.project }, rebuilt: true };
}

export async function overviewAcceptance({ h, director, otherDirector, branch, password }, proof) {
  const origin = await h.startPortal(), browser = await chromium.launch({ channel: "msedge", headless: true });
  const screenshots = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await staffLogin(page, origin, director, password, "overview");
    await page.getByText("Dữ liệu tổng hợp mô phỏng · Asia/Saigon", { exact: true }).waitFor();
    await page.getByLabel("Chi nhánh", { exact: true }).selectOption(branch);
    const summary = page.getByRole("region", { name: "Báo cáo đăng ký và thanh toán" });
    const metric = (label, amount) => summary.getByRole("article").filter({ has: page.getByRole("heading", { name: label }) }).getByText(amount, { exact: true });
    await metric("Đơn đã xác nhận", "1").waitFor();
    await metric("Tiền đã nhận", "100.000 ₫").waitFor();
    await metric("Tiền đã hoàn", "20.000 ₫").waitFor();
    await summary.getByText(/Kỳ \d{2}\/\d{2}\/\d{4}/).waitFor();
    await summary.getByRole("status").filter({ hasText: /Đã tổng hợp \d+\/\d+ ngày/ }).waitFor();
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const file = `overview-${width}.png`;
      const bytes = await page.screenshot({ path: path.join(h.directory, file), fullPage: true, animations: "disabled" });
      screenshots.push({ width, file, sha256: sha(bytes) });
    }
    const reports = /\/api\/v1\/reports\?/;
    await page.route(reports, route => route.fulfill({ status: 503, json: { error: { code: "UPSTREAM_UNAVAILABLE" } } }));
    await page.reload();
    await summary.getByRole("alert").filter({ hasText: "Không tải được báo cáo" }).waitFor();
    assert.equal(await summary.getByRole("article").count(), 0);
    await page.unroute(reports);
    await summary.getByRole("button", { name: "Thử lại" }).press("Enter");
    await metric("Tiền đã hoàn", "20.000 ₫").waitFor();
    await page.reload();
    await metric("Tiền đã nhận", "100.000 ₫").waitFor();
    const outside = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await staffLogin(outside, origin, otherDirector, password, "overview");
    const { start, end } = proof.period;
    const denied = await outside.request.get(origin + `/api/v1/reports?start=${start}&end=${end}&branchId=${branch}`);
    assert.equal(denied.status(), 403);
    return { screenshots, scopeDeniedThroughBff: denied.status(), fetchErrorShown: true, keyboardRetryAndReload: true };
  } finally { await browser.close(); }
}
