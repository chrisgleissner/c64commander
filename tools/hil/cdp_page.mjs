/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * One DevTools connection to the app's page, on a port already forwarded to the WebView.
 *
 * `scripts/bughunt-cdp.mjs` opens a socket per expression and caps each at 15 s, which suits one-off
 * reads. The samplers and the profiler here need one socket held for a whole run: a profile has to be
 * started and stopped on the same session, and a 250 ms sampler cannot afford a new socket per read.
 * The forward itself is the caller's (`droid_device.forward_webview`, see the `hil-attach` skill).
 */

export const connectPage = async (port = "9333") => {
  const targets = await (await fetch(`http://localhost:${port}/json`)).json();
  const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl) ?? targets[0];
  if (!page?.webSocketDebuggerUrl) throw new Error(`no CDP page on port ${port}; is the WebView forwarded?`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const waiter = message.id ? pending.get(message.id) : undefined;
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(`${waiter.method}: ${JSON.stringify(message.error)}`));
    else waiter.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    for (const [id, waiter] of pending) {
      pending.delete(id);
      waiter.reject(new Error(`${waiter.method}: the CDP socket closed`));
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error(`CDP socket on port ${port} refused`)), { once: true });
  });

  const send = (method, params = {}, timeoutMs = 60_000) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, method });
      socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`${method}: no answer in ${timeoutMs} ms`));
      }, timeoutMs);
    });

  /** Evaluate in the page; a string result that starts like JSON is parsed, an exception is rethrown. */
  const evaluate = async (expression, timeoutMs = 60_000) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw new Error(`page threw: ${details.exception?.description ?? details.text}`);
    }
    const value = result.result.value;
    return typeof value === "string" && /^[[{]/.test(value) ? JSON.parse(value) : value;
  };

  return { send, evaluate, close: () => socket.close(), url: page.url };
};
