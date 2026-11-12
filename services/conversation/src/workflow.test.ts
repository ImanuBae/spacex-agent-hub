import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { ConversationDraft } from "@spacex/contracts";
const workflows = ["wf-01", "wf-02", "wf-03"].map(id => JSON.parse(readFileSync(new URL(`../../../workflows/n8n/${id}.json`, import.meta.url), "utf8"))[0]);
const nodes = workflows[1].nodes as { name: string; type: string; parameters: { jsCode?: string; jsonBody?: string; url?: string } }[];
const run = (name: string, input: unknown, lookup?: unknown) => new Function("$json", "$", nodes.find(n => n.name === name)!.parameters.jsCode!)(input, lookup)[0].json;
it("all workflow code and body expressions parse; credentials stay outside workflow JSON", () => {
  for (const workflow of workflows) for (const n of workflow.nodes) {
    if (n.parameters.jsCode) expect(() => new Function("$json", "$", n.parameters.jsCode)).not.toThrow();
    for (const expression of [n.parameters.jsonBody, n.parameters.url]) if (expression?.startsWith("={{")) {
      expect(expression.slice(3,-2)).not.toContain("}}");
      expect(() => new Function("$json", "$", `return (${expression.slice(3,-2)});`)).not.toThrow();
    }
    expect(JSON.stringify(n)).not.toMatch(/clientSecret|sk-or-|Bearer eyJ/);
  }
});
it("tool allowlist rejects injection, arguments, extra calls and handles quota/timeout", () => {
  const call = (name: string, args = '{"action":"read_catalog_classes"}') => ({ function: { name, arguments: args } });
  expect(run("Tool allowlist", { choices: [{ message: { tool_calls: [call("select_chat_action")] } }] }).allowed).toBe(true);
  expect(run("Tool allowlist", { choices: [{ message: { tool_calls: [call("select_chat_action", '{ "action": "read_catalog_classes" }')] } }] }).allowed).toBe(true);
  expect(run("Tool allowlist", { choices: [{ message: { tool_calls: [call("select_chat_action", '{"action":"request_handoff"}')] } }] }).errorCode).toBe("HANDOFF");
  for (const calls of [[call("fetch_url")], [call("read_catalog_classes", '{"branchId":"other"}')], [call("read_catalog_classes"),call("read_catalog_classes")]])
    expect(run("Tool allowlist", { choices: [{ message: { tool_calls: calls } }] }).errorCode).toBe("DENIED");
  expect(run("Tool allowlist", { error: { code: 429 } }).errorCode).toBe("QUOTA");
  expect(run("Tool allowlist", { error: "request timed out" }).errorCode).toBe("TIMEOUT");
  for (const tool_calls of [[null], {length:1}, "x", []]) expect(run("Tool allowlist", {choices:[{message:{tool_calls}}]}).errorCode).toBe("DENIED");
});
it("malformed or oversized provider text hands off instead of failing the draft contract", () => {
  const lookup = (name: string) => ({ isExecuted: true, first: () => ({json: name === "Job" ? {startedAt:Date.now()} : name === "Sources" ? {sources:[]} : {model:"test-fixture"}}) });
  for (const content of [undefined, {}, "   ", "x".repeat(4001)]) {
    const draft = run("Draft", {choices:[{message:{content}}]}, lookup);
    expect(draft.errorCode).toBe("MODEL_ERROR");
    expect(typeof draft.text).toBe("string");
  }
  expect(run("Draft", {choices:[{message:{content:"Valid synthetic text"}}]}, lookup).errorCode).toBeUndefined();
});
it("provider model metadata cannot break a valid draft or error handoff", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const body = nodes.find(n => n.name === "Model tool request")!.parameters.jsonBody!;
  const configuredModel = new Function("$json", `return (${body.slice(3, -2)});`)({ messages: [] }).model;
  for (const model of [{}, "", "x".repeat(151), undefined]) {
    const lookup = (name: string) => ({ isExecuted: true, first: () => ({json: name === "Job"
      ? {startedAt:Date.now(),jobId:id,leaseToken:id,attempt:1}
      : name === "Sources" ? {sources:[]} : {model}}) });
    for (const response of [{model, choices:[{message:{content:"Synthetic answer"}}]}, {model, error:{code:429}}]) {
      const draft = run("Draft", response, lookup);
      expect(ConversationDraft.safeParse(draft).success).toBe(true);
      expect(draft.model).toBe(configuredModel);
      expect(draft.errorCode).toBe("error" in response ? "QUOTA" : undefined);
    }
  }
});
it("Class snapshots join active offers; internal sellable exchange stays disabled", () => {
  const lookup = (name: string) => ({ first: () => ({ json: ({
    "Catalog courses": { data: [{ id: "c", deliveryModes: ["online"] }] },
    "Catalog packages": { data: [{ id: "p", courseId: "c" }] },
    "Class list": { data: [
      { id: "ok", courseId: "c", packageId: "p", available: 1, mode: "online", registrationClosesAt: "2099-01-01" },
      { id: "full", courseId: "c", packageId: "p", available: 0, mode: "online", registrationClosesAt: "2099-01-01" },
      { id: "hidden", courseId: "other", packageId: "p", available: 1, mode: "online", registrationClosesAt: "2099-01-01" },
    ] },
  } as Record<string, unknown>)[name] }) });
  const result = run("Sources", {}, lookup);
  expect(result.data.classes.map((c: { id: string }) => c.id)).toEqual(["ok"]);
  expect(result.sources).toHaveLength(3);
  expect(nodes.find(n => n.name === "Class list")!.parameters.url).not.toContain("sellable=true");
});
it("provider calls require explicit export admission and recheck before answer; tool errors bypass the model", () => {
  const wf = workflows[1];
  const condition = (name: string) => wf.nodes.find((n: { name: string }) => n.name === name).parameters.conditions.conditions[0].leftValue;
  const admitted = (name: string, data: unknown) => new Function("$json", `return (${condition(name).slice(3,-2)});`)({ data });
  for (const name of ["Model ready", "Provider still allowed"]) {
    for (const data of [undefined, {}, {modelReady:true}, {modelReady:true,providerAllowed:false}, {providerAllowed:true}]) expect(admitted(name,data)).toBe(false);
    expect(admitted(name,{modelReady:true,providerAllowed:true})).toBe(true);
  }
  expect(() => run("Prompt", {data:{modelReady:true,messages:[]}})).toThrow("Provider export denied");
  expect(wf.connections.Sources.main[0][0].node).toBe("Sources ready");
  expect(wf.connections["Sources ready"].main[1][0].node).toBe("Draft");
  expect(wf.connections["Sources ready"].main[0][0].node).toBe("Recheck turn");
  expect(wf.connections["Provider still allowed"].main[0][0].node).toBe("Clarify after recheck");
  expect(wf.connections["Clarify after recheck"].main[0][0].node).toBe("Clarification answer");
  expect(wf.connections["Clarify after recheck"].main[1][0].node).toBe("Model answer");
  expect(wf.connections["Provider still allowed"].main[1][0].node).toBe("Provider denied");
});
