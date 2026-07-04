// Minimal CDP client for driving the C64 Commander WebView on the Pixel 4.
// Usage: import { connect } from "./cdp.mjs"; const c = await connect(wsUrl);
let nextId = 1;

export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const consoleLogs = [];
  const networkReqs = [];
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = (e) => rej(new Error("ws error: " + (e?.message ?? e)));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? JSON.stringify(a.preview ?? "")).join(" ");
      consoleLogs.push({ t: Date.now(), type: msg.params.type, text });
    }
    if (msg.method === "Network.requestWillBeSent") {
      networkReqs.push({ t: Date.now(), phase: "send", url: msg.params.request.url, method: msg.params.request.method, reqId: msg.params.requestId });
    }
    if (msg.method === "Network.responseReceived") {
      networkReqs.push({ t: Date.now(), phase: "resp", url: msg.params.response.url, status: msg.params.response.status, reqId: msg.params.requestId });
    }
  };
  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  await send("Runtime.enable");
  await send("Network.enable");
  async function evaluate(expression, awaitPromise = true) {
    const r = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error("eval exception: " + JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  }
  const sleep = (ms) => evaluate(`new Promise(r=>setTimeout(r,${ms}))`);
  return {
    send, evaluate, sleep, consoleLogs, networkReqs,
    close: () => ws.close(),
  };
}
