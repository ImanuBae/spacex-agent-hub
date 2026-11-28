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
it("an empty Catalog hands off and an answer links only to matched source offers", () => {
  const empty = () => ({ first: () => ({ json: { data: [] } }) });
  expect(run("Sources", {}, empty)).toEqual({ errorCode: "TOOL_ERROR" });

  const packageId = "00000000-0000-4000-8000-000000000001";
  const data = { courses: [{ id: "python", name: "Python cơ bản" }, { id: "sql", name: "SQL thực hành" }],
    packages: [{ id: packageId, courseId: "python", priceVnd: 1800000 }, { id: "other", courseId: "sql", priceVnd: 2100000 }] };
  const lookup = (name: string) => ({ isExecuted: true, first: () => ({ json: name === "Job" ? { startedAt: Date.now(), jobId: packageId, leaseToken: packageId, attempt: 1 } : name === "Sources" ? {
    data, sources: [{ api: "catalog.packages", readAt: "2026-11-27T00:00:00Z" }],
  } : {} }) });
  const draft = run("Draft", { choices: [{ message: { content: "Python cơ bản có phần đọc tệp CSV." } }] }, lookup);
  expect(ConversationDraft.parse(draft).sources[0].offers).toEqual([{ packageId, name: "Python cơ bản" }]);
});
it("named course price and schedule answers ignore unsupported model facts", () => {
  const python = "00000000-0000-4000-8000-000000000001", sql = "00000000-0000-4000-8000-000000000002";
  const data = {
    courses: [{ id: "python", name: "Python cơ bản" }, { id: "sql", name: "SQL thực hành" }],
    packages: [
      { id: python, courseId: "python", name: "Gói 8 buổi", sessionCount: 8, priceVnd: 1800000, policyVersion: 1 },
      { id: sql, courseId: "sql", name: "Gói 10 buổi", sessionCount: 10, priceVnd: 2100000, policyVersion: 1 },
    ],
    classes: [{ courseId: "sql", packageId: sql, name: "SQL thực hành trực tuyến", sessions: [{ startsAt: "2026-12-12T12:00:00Z" }], available: 10 }],
  };
  const draft = (question: string, answer: string) => run("Draft", { choices: [{ message: { content: answer } }] }, (name: string) => ({
    isExecuted: true, first: () => ({ json: name === "Job" ? { startedAt: Date.now(), jobId: python, leaseToken: python, attempt: 1 }
      : name === "Sources" ? { data, sources: [{ api: "catalog.packages", readAt: "2026-11-27T00:00:00Z" }] }
      : name === "Turn" ? { data: { messages: [{ sender: "GUEST", text: question }] } } : {} }),
  }));
  const price = ConversationDraft.parse(draft("Học phí gói Python cơ bản 8 buổi là bao nhiêu?", "Python cơ bản 1.000.000 đồng, còn 10 chỗ."));
  expect(price.text).toContain("1.800.000 đồng");
  expect(price.text).not.toMatch(/10 chỗ|SQL/);
  expect(price.sources[0].offers?.[0].packageId).toBe(python);
  const schedule = ConversationDraft.parse(draft("Lớp SQL thực hành nào đang mở và khai giảng khi nào?", "SQL thực hành còn 20 chỗ, học mỗi thứ Hai."));
  expect(schedule.text).toContain("19:00 12/12/26 (giờ Việt Nam), còn 10 chỗ");
  expect(schedule.text).not.toMatch(/thứ Hai|20 chỗ/);
  expect(schedule.sources[0].offers?.[0].packageId).toBe(sql);
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
