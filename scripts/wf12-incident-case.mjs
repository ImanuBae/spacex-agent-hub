/* global Buffer, document, innerWidth */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { connectBroker } from "@spacex/messaging";
import { chromium } from "playwright-core";
import { parseN8nOutput } from "./n8n-output.mjs";
import { staffLogin } from "./n8n06-portal.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");

export async function replayIncident({ h, request, director, password }, unknown) {
  const jobId = unknown.jobId;
  const endpoint = "/api/v1/automation/incidents", detail = endpoint + "/" + jobId;
  const replay = "/api/v1/automation/jobs/" + jobId + "/replay";
  const reason = "DEMO đối chiếu chứng từ đã ghi và tiếp tục cùng job";
  const manifest = JSON.parse(await readFile("workflows/n8n/incident-manifest.json", "utf8"));
  const canonical = await readFile(manifest.file, "utf8");
  assert.equal(sha(canonical), manifest.sha256);
  const [workflow] = JSON.parse(canonical.replace(/http:\/\/host\.docker\.internal:(4002|4006)\//g, (_, port) =>
    `http://${h.backendHost}:${port === "4002" ? h.iamPort : h.bridgePort}/`));
  assert.equal(workflow.active, false);
  workflow.versionId = randomUUID();
  const folder = "/home/node/.n8n/wf12-incidents";
  h.compose("exec", "-T", "n8n", "mkdir", "-p", folder);
  const credentials = [{ id: manifest.credentialId, name: manifest.credential, type: "httpCustomAuth", data: {
    json: JSON.stringify({ body: { clientId: h.incidentWorker.id, clientSecret: h.incidentWorker.clientSecret } }),
  } }];
  for (const [file, data, command] of [["wf12-bound.json", [workflow], "import:workflow"], ["wf12-credential-private.json", credentials, "import:credentials"]]) {
    const localFile = path.join(h.directory, file);
    await writeFile(localFile, JSON.stringify(data), { mode: 0o600, flag: "wx" });
    h.compose("cp", localFile, "n8n:" + folder + "/" + file);
    h.cli(command, "--input=" + folder + "/" + file);
  }
  assert.equal(h.sql("SELECT active::text FROM workflow_entity WHERE id='" + manifest.id + "'"), "false");
  const records = [];
  const alert = () => {
    const result = parseN8nOutput(h.cli("execute", "--id=" + manifest.id, "--rawOutput")).data.resultData;
    assert(!result.error, "WF-12 alert execution failed");
    const receipt = result.runData["Record incident alerts"][0].data.main[0][0].json.data;
    records.push(receipt);
    return receipt.alertsRecorded;
  };
  const dlqCount = () => {
    const row = h.compose("exec", "-T", "rabbitmq", "rabbitmqctl", "-q", "list_queues", "name", "messages_ready")
      .split(/\r?\n/).find(line => line.startsWith("spacex.automation.bridge.v1.dead\t"));
    return Number(row?.split("\t")[1]);
  };
  const before = dlqCount(), poison = randomUUID();
  const broker = await connectBroker(h.runtime.RABBITMQ_URL, () => {});
  try { await broker.publish({ id:poison, type:"adjustment.ready", version:1, correlationId:poison, occurredAt:new Date().toISOString(), payload:{ syntheticInvalidInput:true } }); }
  finally { await broker.close(); }
  await h.eventually(() => dlqCount() === before + 1, "Rejected synthetic delivery stays in the broker DLQ");
  assert.equal((await h.pool.query("SELECT 1 FROM automation_jobs WHERE event_id=$1", [poison])).rowCount, 0);
  assert.equal(alert(), 1);
  assert.equal(alert(), 0);
  const current = (await request("automation-bridge", detail)).data;
  assert.equal(current.workflowId,"WF-09");
  assert.equal(current.kind,"BRIDGE_DEAD");
  assert.equal(current.status,"DEAD");
  assert.equal(current.failedStep,"settle-final-amount");
  assert.equal(current.errorCode,"PAYMENT_UNKNOWN");
  assert.equal(current.ownerRole,"center_director");
  assert(current.alertedAt);
  const keys = "alertedAt attempt errorCode failedAt failedAttempt failedStep jobId kind ownerRole replayCount replayedAt replayedBy status updatedAt version workflowId workflowVersion".split(" ");
  assert.deepEqual(Object.keys(current).sort(), keys);
  const badRole = await request("automation-bridge", replay, "POST", { expectedVersion:current.version, reason }, director.accessToken, 403);
  const deniedRead = await request("automation-bridge", detail, "GET", undefined, director.accessToken, 403);
  const stale = await request("automation-bridge", replay, "POST", { expectedVersion:current.version - 1, reason }, undefined, 409);
  assert.equal(stale.body.error.code,"REPLAY_CONFLICT");
  const operatorFixture = JSON.parse(await readFile(path.join(h.directory,"operator-private.json"),"utf8"));
  const revoked = await h.iamCall("/api/v1/auth/login", operatorFixture);
  await h.pools.identity.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [JSON.parse(Buffer.from(revoked.accessToken.split(".")[1],"base64url")).sid]);
  const liveDenied = await request("automation-bridge", replay, "POST", { expectedVersion:current.version, reason }, revoked.accessToken, 401);
  const list = (await request("automation-bridge", endpoint)).data;
  assert.deepEqual(list, [current]);

  const origin = await h.startPortal();
  const browser = await chromium.launch({ channel:"msedge", headless:true });
  const screenshots = [], pageErrors = [];
  const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
  page.on("pageerror", e => pageErrors.push(e.name));
  let browserReplay;
  try {
    await staffLogin(page, origin, { email:operatorFixture.email }, operatorFixture.password, "overview");
    await page.getByRole("link", { name:"Vận hành", exact:true }).press("Enter");
    await page.getByRole("heading", { name:"Vận hành", exact:true }).waitFor();
    const row = page.getByRole("button", { name:"Xem sự cố WF-09 " + jobId });
    await row.press("Enter");
    const dialog = page.getByRole("dialog", { name:"Chi tiết sự cố" });
    await dialog.getByText("PAYMENT_UNKNOWN", { exact:true }).waitFor();
    await dialog.getByRole("heading", { name:"Hướng xử lý" }).waitFor();
    const input = dialog.getByLabel("Lý do replay"), submit = dialog.getByRole("button", { name:"Replay job" });
    assert(await submit.isDisabled());
    await input.fill(reason);
    const route = "**" + replay;
    await page.route(route, request => request.continue({ postData:JSON.stringify({ expectedVersion:current.version - 1, reason }) }), { times:1 });
    await submit.click();
    await dialog.getByRole("alert").filter({ hasText:"Phiên bản đã thay đổi" }).waitFor();
    assert.equal(await input.inputValue(), reason);
    assert(await submit.isDisabled());
    await dialog.getByRole("button", { name:"Tải trạng thái mới" }).click();
    assert.equal(await input.inputValue(), reason);
    const response = page.waitForResponse(resp => resp.url().endsWith(replay) && resp.request().method() === "POST");
    await submit.click();
    browserReplay = (await response).status();
    assert.equal(browserReplay, 200);
    await dialog.getByText("Replay gần nhất", { exact:true }).waitFor();
    const unauthorized = await browser.newPage();
    await staffLogin(unauthorized, origin, director, password, "operations");
    await unauthorized.getByRole("alert").filter({ hasText:"Bạn không có quyền" }).waitFor();
    assert.equal(await unauthorized.getByRole("link", { name:"Vận hành", exact:true }).count(), 0);
    await unauthorized.close();
    const repeated = await request("automation-bridge", replay, "POST", { expectedVersion:current.version, reason }, undefined, 409);
    assert.equal(repeated.body.error.code,"REPLAY_CONFLICT");
  } catch (error) { await browser.close(); throw error; }

  return { async verify(complete) {
    try {
      const dialog = page.getByRole("dialog", { name:"Chi tiết sự cố" });
      await page.reload();
      await dialog.getByText("Workflow đã kết thúc", { exact:true }).waitFor();
      assert.equal(await dialog.getByRole("button", { name:"Replay job" }).count(),0);
      for (const width of [1440,768,390]) {
        await page.setViewportSize({ width, height:900 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        const file = `wf12-incident-${width}.png`;
        const bytes = await page.screenshot({ path:path.join(h.directory,file), animations:"disabled" });
        screenshots.push({ width, file, sha256:sha(bytes) });
      }
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state:"hidden" });
      await page.getByText("Workflow đã kết thúc", { exact:true }).waitFor();
      assert.deepEqual(pageErrors, []);
      const actual = (await request("automation-bridge", detail)).data;
      assert.equal(actual.jobId,complete.jobId);
      assert.equal(actual.status,"DONE");
      assert.equal(actual.replayCount,1);
      assert.equal(actual.alertedAt,current.alertedAt);
      assert.equal(actual.replayedBy,h.operator.user.id);
      const audit = (await h.pool.query("SELECT actor_id,reason,attempt,version FROM automation_audit WHERE job_id=$1 AND action='REPLAY'", [jobId])).rows;
      assert.deepEqual(audit,[{ actor_id:h.operator.user.id, reason, attempt:current.attempt, version:current.version + 1 }]);
      assert.equal(dlqCount(), before + 1);
      return { manifest, executions:records, before:current, after:actual, audit:[{ actorId:actual.replayedBy, version:audit[0].version, reasonVerified:true }],
        api:{ badRole:badRole.status, deniedRead:deniedRead.status, stale:stale.status, revoked:liveDenied.status, repeated:409 },
        broker:{ deadQueueIncrease:1, incidentForBrokerDelivery:false },
        browser:{ replayStatus:browserReplay, staleWasDisplayed:true, reloadShows:"DONE", screenshots } };
    } finally { await browser.close(); }
  } };
}
