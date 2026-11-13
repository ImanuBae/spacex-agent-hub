import { AsyncLocalStorage, createHook, executionAsyncId } from "node:async_hooks";
import { channel } from "node:diagnostics_channel";

const scope = new AsyncLocalStorage(), sockets = new WeakMap();
let nextSocketId = 0, nextTraceId = 0;
const errorCodes = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "ERR_TLS_CERT_ALTNAME_INVALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_SSL_WRONG_VERSION_NUMBER", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
const safeCode = error => errorCodes.has(error?.code) ? error.code : errorCodes.has(error?.cause?.code) ? error.cause.code : null;

// Observe the existing client. No routing, HTTP payload, credentials or TLS settings are changed.
export function startWireTrace({ signal } = {}) {
  const started = performance.now(), context = { id: ++nextTraceId }, subscriptions = [], cleanups = [], candidates = new Set(), dns = new Map();
  const requestEvents = [], poolEvents = [];
  let request, matchedRequests = 0, boundSocket, reused = null, observerErrors = 0, stopped = false;
  const ms = time => Math.round((time - started) * 1000) / 1000;
  const event = (list, name, extra = {}) => list.push({ event: name, atMs: ms(performance.now()), ...extra });
  const safe = callback => (...args) => { try { callback(...args); } catch { observerErrors++; } };
  if (signal) {
    const onAbort = safe(() => event(requestEvents, "clientAbort"));
    if (signal.aborted) onAbort();
    else { signal.addEventListener("abort", onAbort, { once: true }); cleanups.push(() => signal.removeEventListener("abort", onAbort)); }
  }
  function subscribe(name, callback) {
    const target = channel(name), handler = safe(callback);
    target.subscribe(handler); subscriptions.push(() => target.unsubscribe(handler));
  }
  function socketRecord(socket, createdHere = false) {
    let record = sockets.get(socket);
    if (record) return record;
    const origin = performance.now();
    record = { id: ++nextSocketId, creationObserved: createdHere, createdBy: createdHere ? context : null, uses: 0, events: [], dns: [] };
    sockets.set(socket, record);
    const add = (name, extra = {}) => record.events.push({ event: name, atMs: Math.round((performance.now() - origin) * 1000) / 1000, ...extra });
    if (createdHere) {
      add("socketCreated");
      const on = (name, callback) => {
        const handler = safe(callback); socket.on(name, handler);
        cleanups.push(() => socket.removeListener(name, handler));
      };
      on("lookup", (error, _address, family) => {
        add("dnsLookupCompleted", { code: safeCode(error), family: [4,6].includes(family) ? family : null });
        const operation = dns.get(executionAsyncId());
        if (operation) {
          operation.completedAtRequestMs ??= ms(performance.now());
          if (!record.dns.includes(operation)) record.dns.push(operation);
        }
      });
      on("connect", () => add("tcpConnected"));
      on("secureConnect", () => add("tlsConnected", { authorized: socket.authorized === true }));
      on("error", error => add("socketError", { code: safeCode(error) }));
    }
    return record;
  }
  const hook = createHook({ init: safe((id, type) => {
    if (type === "GETADDRINFOREQWRAP" && scope.getStore() === context) dns.set(id, { operationId: id, traceId: context.id, startedAtRequestMs: ms(performance.now()), completedAtRequestMs: null });
  }) });
  hook.enable();
  subscribe("net.client.socket", ({ socket }) => {
    if (scope.getStore() === context) candidates.add(socketRecord(socket, true));
  });
  subscribe("undici:request:create", message => {
    if (scope.getStore() !== context) return;
    matchedRequests++;
    if (!request) { request = message.request; event(requestEvents, "requestCreated"); }
  });
  subscribe("undici:client:beforeConnect", () => {
    if (scope.getStore() === context) event(poolEvents, "poolConnectStarted");
  });
  subscribe("undici:client:connected", ({ socket }) => {
    if (scope.getStore() === context) { candidates.add(socketRecord(socket)); event(poolEvents, "poolConnected"); }
  });
  subscribe("undici:client:connectError", ({ error }) => {
    if (scope.getStore() === context) event(poolEvents, "poolConnectError", { code: safeCode(error) });
  });
  subscribe("undici:client:sendHeaders", message => {
    if (message.request !== request || !request) return;
    const record = socketRecord(message.socket);
    reused = record.uses > 0 ? true : record.createdBy === context ? false : null;
    record.uses++; boundSocket = { socket: message.socket, record };
    event(requestEvents, "requestHeadersWritten", { connectionId: record.id });
  });
  subscribe("undici:request:bodySent", message => {
    if (message.request === request && request) event(requestEvents, "requestBodyWritten");
  });
  subscribe("undici:request:headers", message => {
    if (message.request === request && request) event(requestEvents, "responseHeadersReceived", { statusCode: message.response.statusCode });
  });
  subscribe("undici:request:trailers", message => {
    if (message.request === request && request) event(requestEvents, "responseBodyCompleted");
  });
  subscribe("undici:request:error", message => {
    if (message.request === request && request) event(requestEvents, "requestError", { code: safeCode(message.error) });
  });
  function connection(record, socket) {
    const protocol = socket?.encrypted && socket.getProtocol?.();
    return { id: record.id, creationObserved: record.creationObserved, clock: "ms since this connection was first observed; not request latency", events: record.events.map(e => ({ ...e })), dns: record.dns.map(e => ({ ...e })), tlsProtocol: ["TLSv1.2","TLSv1.3"].includes(protocol) ? protocol : null };
  }
  function snapshot() {
    return {
      version: 1, traceId: context.id, clock: "performance.now; request offsets in milliseconds; DNS offsets refer to their recorded traceId", requestObserved: !!request, matchedRequests, requestScopeUnambiguous: matchedRequests === 1, observerErrors,
      requestEvents: requestEvents.map(e => ({ ...e })),
      connectionBinding: boundSocket ? "REQUEST_SOCKET" : "UNCONFIRMED",
      connection: boundSocket ? { ...connection(boundSocket.record, boundSocket.socket), reused } : null,
      poolEvents: poolEvents.map(e => ({ ...e })),
      poolConnectionCandidates: [...candidates].map(record => connection(record)),
      unassignedDnsLookups: [...dns.values()].filter(op => ![...candidates].some(record => record.dns.includes(op))).map(op => ({ ...op })),
      writeMeaning: "written to local socket; not upstream receipt acknowledgement",
      poolEventMeaning: "connection-pool observations; not proof this request used a candidate until sendHeaders binds its socket",
    };
  }
  return {
    run: work => scope.run(context, work), snapshot,
    stop: () => {
      if (!stopped) { stopped = true; hook.disable(); for (const cleanup of [...subscriptions, ...cleanups]) cleanup(); }
      return snapshot();
    },
  };
}

export function responseDiagnostics(headers, secrets) {
  const ids = {}, rejected = [];
  const formats = { "x-generation-id": /^gen-[A-Za-z0-9_-]+$/, "x-request-id": /^(?:req-[A-Za-z0-9_-]+|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i, "cf-ray": /^[0-9a-f]{16}(?:-[A-Z]{3})?$/i };
  for (const name of ["x-generation-id", "x-request-id", "cf-ray"]) {
    const value = headers?.get?.(name);
    if (!value) continue;
    if (value.length > 200 || !formats[name].test(value) || /sk-or-|bearer/i.test(value) || secrets.some(secret => secret && value.toLowerCase().includes(secret.toLowerCase()))) { rejected.push(name); continue; }
    ids[name] = value;
  }
  const type = headers?.get?.("content-type")?.split(";")[0]?.trim()?.toLowerCase();
  return { responseIds: ids, redactedResponseIdHeaders: rejected, responseContentType: ["application/json", "text/event-stream", "text/html", "text/plain"].includes(type) ? type : null };
}
