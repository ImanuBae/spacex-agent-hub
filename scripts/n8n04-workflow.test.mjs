import { providerSlug, providerTimeoutMs, modelNodeTimeoutMs, draftBudgetMs } from "./n8n04-model.mjs";
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { clarificationModel, clarificationText } from './n8n04-clarification.mjs';

const workflow = JSON.parse(await readFile(new URL('../workflows/n8n/wf-02.json', import.meta.url), 'utf8'))[0];
const node = name => workflow.nodes.find(n => n.name === name);
test('the UTF-8 system instruction agrees with the named selector and its required action field', () => {
  const prompt = new Function('$json', node('Prompt').parameters.jsCode)({ data: { providerAllowed: true, modelReady: true, messages: [] } })[0].json.messages[0].content;
  const body = new Function('$json', `return (${node('Model tool request').parameters.jsonBody.slice(3, -2)});`)({ messages: [] });
  const selector = body.tools[0].function;
  assert(prompt.includes('Bạn là trợ lý tư vấn chỉ đọc'));
  assert(prompt.includes(selector.name)); assert.deepEqual(selector.parameters.required, ['action']);
  assert(prompt.includes('arguments chỉ có action'));
  assert(!prompt.includes('arguments phải đúng object rỗng'));
  assert(prompt.includes('khách khác')); assert(prompt.includes('priceConstraint'));
});
test('single selector preserves handoff and rejects multiple, old, unknown and extra actions', () => {
  const select = (calls) => new Function('$json', node('Tool allowlist').parameters.jsCode)({ choices: [{ message: { tool_calls: calls } }] })[0].json;
  const call = action => ({ id: 'selection', type: 'function', function: { name: 'select_chat_action', arguments: JSON.stringify({ action }) } });
  assert.equal(select([call('read_catalog_classes')]).allowed, true);
  assert.equal(select([call('request_handoff')]).errorCode, 'HANDOFF');
  for (const calls of [[], [call('read_catalog_classes'), call('request_handoff')], [call('admin')], [{ ...call('read_catalog_classes'), function: { name: 'read_catalog_classes', arguments: '{}' } }], [{ ...call('read_catalog_classes'), function: { name: 'select_chat_action', arguments: '{"action":"read_catalog_classes","role":"admin"}' } }]]) assert.equal(select(calls).errorCode, 'DENIED');
});
const lookup = (startedAt, data) => name => ({ isExecuted: true, first: () => ({ json: name === 'Job' ? { startedAt, jobId: 'job', leaseToken: 'lease', attempt: 1 } : name === 'Sources' ? { sources: [], data } : {} }) });
const draft = (text, startedAt = Date.now(), data) => new Function('$json', '$', node('Draft').parameters.jsCode)({ choices: [{ message: { content: text } }] }, lookup(startedAt, data))[0].json;

test('a price answer missing policy versions displays each named source version without another model call', () => {
  const data = { courses: [{ name: 'Khóa A', policyVersion: 2 }], packages: [{ name: 'Gói B', policyVersion: 7 }] };
  const result = draft('Gói B có giá 100.000 VND.', Date.now(), data);
  assert.equal(result.text, 'Gói B có giá 100.000 VND.\n\nChính sách: Khóa Khóa A — phiên bản 2; Gói Gói B — phiên bản 7.');
  assert.equal(result.errorCode, undefined); assert.equal(result.jobId, 'job'); assert.equal(result.leaseToken, 'lease'); assert.equal(result.attempt, 1);
  assert.equal(workflow.connections['Model answer'].main[0][0].node, 'Draft');
  for (const text of ['Chính sách chưa công bố.', 'Cần hỏi về hoàn tiền.', 'Cần chuyển lớp.', 'Giá:100000đồng']) assert.match(draft(text, Date.now(), data).text, /Gói Gói B — phiên bản 7/);
});

test('policy metadata missing or invalid fails closed instead of guessing a source version', () => {
  const course = { name: 'Khóa A', policyVersion: 2 };
  for (const data of [undefined, {}, { courses: {}, packages: [] }, { courses: [], packages: [] }, ...[undefined, null, '1', 0, -1, 1.5, NaN, Infinity].map(policyVersion => ({ courses: [{ ...course, policyVersion }], packages: [] })), { courses: [{ name: '', policyVersion: 1 }], packages: [] }]) {
    const result = draft('Giá gói là100000VND.', Date.now(), data);
    assert.equal(result.errorCode, 'TOOL_ERROR'); assert.equal(result.text, 'Yêu cầu cần tư vấn viên hỗ trợ.');
  }
  assert.equal(draft('Giá gói là100000VND.', Date.now(), { courses: [course], packages: [] }).errorCode, undefined);
});

test('source policy rendering preserves final length/language limits and the Draft deadline', () => {
  const data = { courses: [{ name: 'Khóa A', policyVersion: 2 }], packages: [] };
  assert.equal(draft('Giá '+ 'a'.repeat(3970), Date.now(), data).errorCode, 'MODEL_ERROR');
  assert.equal(draft('Giá100000VND.', Date.now(), { courses: [{ name: '中文', policyVersion: 1 }], packages: [] }).errorCode, 'MODEL_ERROR');
  assert.equal(draft('Giá100000VND.', Date.now() - draftBudgetMs - 1000, data).errorCode, 'TIMEOUT');
});

test('workflow branches have no duplicate edges that could dispatch a model call twice', () => {
  for (const [name, connections] of Object.entries(workflow.connections)) for (const edges of connections.main) {
    assert.equal(new Set(edges.map(edge => JSON.stringify(edge))).size, edges.length, name);
  }
});

test('both model calls disable reasoning and enforce zero-price routing with guard bookkeeping headroom', () => {
  for (const name of ['Model tool request', 'Model answer']) {
    const current = node(name);
    assert(!current.parameters.jsonBody.slice(0, -2).includes('}}'), 'Nested object braces must not close the n8n expression early');
    const body = new Function('$json', '$', `return (${current.parameters.jsonBody.slice(3, -2)});`)({ messages: [] }, key => ({ first: () => ({ json: key === 'Prompt' ? { messages: [] } : key === 'Tool allowlist' ? { assistant: { tool_calls: [{ id: 't' }] } } : { data: {} } }) }));
    assert.deepEqual(body.reasoning, { enabled: false });
    assert.deepEqual(body.provider, { only: [providerSlug], allow_fallbacks: false, require_parameters: true, max_price: { prompt: 0, completion: 0, request: 0 } });
    assert.equal(current.parameters.options.timeout, modelNodeTimeoutMs);
    assert(current.parameters.options.timeout - providerTimeoutMs >= 2000);
    assert(draftBudgetMs >= 2 * providerTimeoutMs + 10000);
    assert(draftBudgetMs < workflow.settings.executionTimeout * 1000);
    assert.equal(current.retryOnFail, undefined);
  }
  assert.equal(workflow.active, false); assert.equal(workflow.settings.executionTimeout, 55);
});

test('Chinese text from the model fails closed while a Vietnamese answer keeps its fence', () => {
  assert.equal(draft('Bạn có偏好 về hình thức học không?').errorCode, 'MODEL_ERROR');
  const valid = draft('Bạn muốn học gì?');
  assert.equal(valid.errorCode, undefined); assert.equal(valid.text, 'Bạn muốn học gì?');
  assert.equal(valid.jobId, 'job'); assert.equal(valid.leaseToken, 'lease'); assert.equal(valid.attempt, 1);
});

test('Draft still hands off after its processing budget and preserves provider policy recheck', () => {
  assert.equal(draft('Bạn muốn học gì?', Date.now() - draftBudgetMs - 1000).errorCode, 'TIMEOUT');
  assert.equal(workflow.connections['Provider still allowed'].main[0][0].node, 'Clarify after recheck');
  assert.equal(workflow.connections['Provider still allowed'].main[1][0].node, 'Provider denied');
});

test('an explicit undecided first turn gets exactly two fixed questions without model-supplied facts', () => {
  const decide = messages => new Function('$json', node('Clarification decision').parameters.jsCode)({ data: { messages } })[0].json;
  for (const text of ['Mình chưa biết nên học gì, tư vấn giúp mình nhé.', 'Em không biết chọn khóa nào.', 'Toi chua ro nen hoc gi']) assert.equal(decide([{ sender: 'GUEST', text }]).needsClarification, true);
  for (const text of ['Cho tôi giá khóa Excel online.', 'Tôi không biết lịch học ngày mai.', 'Chưa biết học gì, tôi muốn gặp nhân viên']) assert.equal(decide([{ sender: 'GUEST', text }]).needsClarification, false);
  for (const messages of [null, [], [{ sender: 'AI', text: 'Chưa biết học gì' }], [{ sender: 'GUEST', text: null }], [{ sender: 'GUEST', text: 'Chưa biết học gì' }, { sender: 'AI', text: 'Mục tiêu của bạn?' }]]) assert.equal(decide(messages).needsClarification, false);
  const response = new Function(node('Clarification answer').parameters.jsCode)()[0].json;
  const base = lookup(Date.now());
  const result = new Function('$json', '$', node('Draft').parameters.jsCode)(response, name => name === 'Clarification decision' ? { isExecuted: true, first: () => ({ json: { needsClarification: true } }) } : base(name))[0].json;
  assert.equal(result.text, clarificationText); assert.equal(result.model, clarificationModel);
  assert.equal((result.text.match(/\?/g) ?? []).length, 2); assert(!/Excel|giá|tiết|100/.test(result.text));
  assert.equal(workflow.connections['Model ready'].main[0][0].node, 'Human request decision');
  assert.equal(workflow.connections['Model ready'].main[1][0].node, 'Missing key');
  assert.equal(workflow.connections['Needs clarification'].main[0][0].node, 'Clarification tool plan');
  assert.equal(workflow.connections['Needs clarification'].main[1][0].node, 'Prompt');
  assert.equal(workflow.connections['Clarify after recheck'].main[0][0].node, 'Clarification answer');
  assert.equal(workflow.connections['Clarify after recheck'].main[1][0].node, 'Model answer');
  assert.equal(workflow.connections['Clarification answer'].main[0][0].node, 'Draft');
});
