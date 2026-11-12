import assert from "node:assert/strict";
import { test } from "node:test";
import { lookupFinishedJob } from "./n8n04-runtime.mjs";
test("uncertain result lookup verifies the current job and never retries an operation", async () => {
  const original = globalThis.fetch, claimed = { jobId: "job", eventId: "event", workflowId: "WF-02", workflowVersion: 1, inputRef: "input", contextRef: "context", entity: { id: "conversation" } };
  let issued = 0, requests = 0, data = { ...claimed, status: "DONE" };
  const h = { bridgePort: 1234, iamCall: async (route, body) => { issued++; assert.equal(route, "/internal/iam/machine/token"); assert.deepEqual(body.scopes, ["automation:read"]); assert.deepEqual(body.workflows, ["WF-02"]); return { accessToken: "synthetic" }; } };
  globalThis.fetch = async (url, options) => { requests++; assert.equal(url, "http://127.0.0.1:1234/internal/automation/jobs/job"); assert.equal(options.method, undefined); assert.equal(options.redirect, "error"); return new Response(JSON.stringify({ data })); };
  try {
    assert.equal(await lookupFinishedJob(h, {}, "WF-02", null), null); assert.equal(issued, 0);
    assert.equal((await lookupFinishedJob(h, {}, "WF-02", claimed)).status, "DONE");
    data = { ...claimed, status: "RUNNING" }; assert.equal(await lookupFinishedJob(h, {}, "WF-02", claimed), null);
    data = { ...claimed, status: "DONE", eventId: "other" }; await assert.rejects(lookupFinishedJob(h, {}, "WF-02", claimed), /another operation/);
    assert.equal(requests, 3); assert.equal(issued, 3);
  } finally { globalThis.fetch = original; }
});
