import { modelId, providerSlug } from "./n8n04-model.mjs";
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import cp from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';

const mode = new URL(import.meta.url).searchParams.get('mode');
assert(['headers', 'body', 'partial', 'n8n-first'].includes(mode));
const read = fs.readFile, write = fs.writeFile, spawn = cp.spawn, createServer = http.createServer, realFetch = globalThis.fetch;
const guard = process.argv[1].endsWith('n8n04-benchmark-guard.mjs');
const events = [];
if (guard) {
  const directory = path.dirname(process.argv[2]);
  const eventFile = path.join(directory, 'synthetic-transport-private.json');
  const record = async event => { events.push({ ...event, at: new Date().toISOString() }); await write(eventFile, JSON.stringify({ mode, providerCredentialReads: 0, externalRequests: 0, events }, null, 2)); };
  fs.readFile = async (file, ...args) => {
    if (path.resolve(String(file)) === path.resolve('.local/credentials/openrouter.key')) {
      await record({ type: 'synthetic-credential-substituted' }); return 'synthetic-key-no-provider-access';
    }
    return read(file, ...args);
  };
  let delayed = false;
  fs.writeFile = async (file, body, ...args) => {
    if (mode === 'n8n-first' && !delayed && String(file).endsWith('provider-ledger-private.json') && JSON.parse(body).stopped) {
      delayed = true; await record({ type: 'failure-ledger-io-delay', milliseconds: 3000 });
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    return write(file, body, ...args);
  };
  const local = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    assert.deepEqual(request.provider, { only: [providerSlug], allow_fallbacks: false, require_parameters: true, max_price: { prompt: 0, completion: 0, request: 0 } });
    assert.equal(request.model, modelId);
    await record({ type: 'loopback-request', stage: request.max_tokens === 500 ? 'planner' : 'answer' });
    if (mode !== 'headers') { res.writeHead(200); res.flushHeaders(); }
    if (mode === 'partial') res.write('{"model":');
    const timer = setTimeout(() => res.end('{}'), 20000);
    res.on('close', () => clearTimeout(timer));
  });
  local.listen(0, '127.0.0.1'); await once(local, 'listening');
  globalThis.fetch = (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions', 'SYNTHETIC_EXTERNAL_EGRESS_DENIED');
    assert.equal(options.redirect, 'error');
    return realFetch(`http://127.0.0.1:${local.address().port}/synthetic`, options);
  };
  http.createServer = handler => createServer((req, res) => {
    const end = res.end;
    res.end = function (...args) {
      if (/^\/planner\//.test(req.url)) record({ type: 'guard-http-response', route: req.url });
      return end.apply(this, args);
    };
    return handler(req, res);
  });
} else {
  fs.readFile = (file, ...args) => {
    assert.notEqual(path.resolve(String(file)), path.resolve('.local/credentials/openrouter.key'), 'REAL_CREDENTIAL_READ_DENIED');
    return read(file, ...args);
  };
  cp.spawn = (command, args, options) => {
    if (args[0] === 'scripts/n8n04-benchmark-guard.mjs') return spawn(command, ['--import', import.meta.url, ...args], options);
    return spawn(command, args, options);
  };
  globalThis.fetch = (url, options) => {
    assert.equal(new URL(url).hostname, '127.0.0.1', 'SYNTHETIC_EXTERNAL_EGRESS_DENIED');
    return realFetch(url, options);
  };
}
syncBuiltinESMExports();
