#!/usr/bin/env node
// QA bug-hunt CDP helper (OBSERVATION ONLY — never dispatches synthetic product input).
// Uses Chrome DevTools Protocol over the WebView debug socket to read DOM + console + network.
// Requires: adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>  (caller sets up)
//
// Modes:
//   dom                       -> enumerate interactive elements + route, print JSON
//   eval "<expr>"             -> evaluate JS expression, print JSON result
//   listen <seconds>          -> stream console/exception/network-failure events as JSON lines (0 = until killed)
//
// Env: CDP_PORT (default 9333)
const PORT = process.env.CDP_PORT || '9333';
const MODE = process.argv[2] || 'dom';
const ARG = process.argv[3];

async function getPageWs() {
  const res = await fetch(`http://localhost:${PORT}/json`);
  const pages = await res.json();
  const page = pages.find(p => p.type === 'page' && p.webSocketDebuggerUrl) || pages[0];
  if (!page) throw new Error('no CDP page found');
  return page.webSocketDebuggerUrl;
}

function makeClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', e => reject(new Error('ws error: ' + (e.message || e.type))));
  });
  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 15000);
    });
  }
  function on(fn) { listeners.push(fn); }
  return { ws, ready, send, on };
}

const DOM_EXPR = `(() => {
  const sel = 'button, a, input, select, textarea, [role=button], [role=tab], [role=switch], [role=menuitem], [role=menuitemradio], [role=option], [role=checkbox], [role=slider], [tabindex], [data-testid], summary, label';
  const seen = new Set();
  const out = [];
  document.querySelectorAll(sel).forEach(el => {
    if (seen.has(el)) return; seen.add(el);
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const visible = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && el.offsetParent !== null;
    const txt = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().replace(/\\s+/g,' ').slice(0,80);
    out.push({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || el.getAttribute('role') || '',
      text: txt,
      testid: el.getAttribute('data-testid') || el.id || '',
      aria: el.getAttribute('aria-label') || '',
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('disabled') !== null,
      checked: el.getAttribute('aria-checked') || (el.checked === true ? 'true' : ''),
      visible,
      x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2),
      w: Math.round(r.width), h: Math.round(r.height),
    });
  });
  return JSON.stringify({
    href: location.href, hash: location.hash, title: document.title,
    bodyTextLen: document.body ? document.body.innerText.length : 0,
    count: out.length,
    elements: out
  });
})()`;

(async () => {
  const wsUrl = await getPageWs();
  const c = makeClient(wsUrl);
  await c.ready;

  if (MODE === 'dom' || MODE === 'eval') {
    await c.send('Runtime.enable');
    const expr = MODE === 'eval' ? ARG : DOM_EXPR;
    const res = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) { console.log(JSON.stringify({ error: res.exceptionDetails.text, detail: res.exceptionDetails })); process.exit(2); }
    const val = res.result.value;
    console.log(typeof val === 'string' ? val : JSON.stringify(val));
    process.exit(0);
  }

  if (MODE === 'listen') {
    const seconds = Number(ARG || '0');
    await c.send('Runtime.enable');
    await c.send('Log.enable');
    await c.send('Network.enable');
    await c.send('Page.enable');
    const emit = o => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));
    c.on(m => {
      if (m.method === 'Runtime.consoleAPICalled') {
        const a = (m.params.args||[]).map(x => x.value ?? x.description ?? x.unserializableValue ?? '').join(' ').slice(0,400);
        if (['error','warning','assert'].includes(m.params.type)) emit({ kind: 'console.'+m.params.type, text: a });
      } else if (m.method === 'Runtime.exceptionThrown') {
        const e = m.params.exceptionDetails;
        emit({ kind: 'exception', text: (e.exception?.description || e.text || '').slice(0,500) });
      } else if (m.method === 'Log.entryAdded') {
        const e = m.params.entry;
        if (['error','warning'].includes(e.level)) emit({ kind: 'log.'+e.level, source: e.source, text: (e.text||'').slice(0,400), url: e.url });
      } else if (m.method === 'Network.requestWillBeSent') {
        emit({ kind: 'net.req', method: m.params.request.method, url: m.params.request.url.slice(0,160) });
      } else if (m.method === 'Network.loadingFailed') {
        emit({ kind: 'net.fail', err: m.params.errorText, url: m.params.requestId });
      } else if (m.method === 'Network.responseReceived') {
        const s = m.params.response.status;
        if (s >= 400) emit({ kind: 'net.status', status: s, url: m.params.response.url.slice(0,160) });
      } else if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) {
        emit({ kind: 'page.nav', url: m.params.frame.url });
      }
    });
    emit({ kind: 'listen.start', wsUrl });
    if (seconds > 0) { setTimeout(() => { emit({ kind: 'listen.end' }); process.exit(0); }, seconds*1000); }
    // else run until killed
  }
})().catch(e => { console.error(JSON.stringify({ fatal: e.message })); process.exit(1); });
