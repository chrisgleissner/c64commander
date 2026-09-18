/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Talking to the app on the phone: adb on one side, the WebView's DevTools socket on the other.
 *
 * Shared by the HIL harnesses in this directory because the connection is the part that goes wrong
 * rather than the part that is interesting. Two failures cost a run each before this was written
 * down: a handle kept across a relaunch reads a dead page and reports the app as hung, and a run
 * that skipped the stage where the first connection happened failed every later stage on a null
 * socket rather than on anything it measured.
 *
 * The app's REST calls go through native CapacitorHttp, so they never appear in the Network domain
 * and a release build logs nothing about them. Console and Log events are captured instead: they
 * carry the faults nothing on screen mentions and no user ever reports.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const createHilCdp = ({ serial, packageName, port }) => {
  let socket = null;
  let pending = new Map();
  let nextId = 1;
  let consoleErrors = [];

  const adb = async (...args) => {
    const { stdout } = await execFileAsync("adb", ["-s", serial, ...args], { maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  };
  const shell = (command) => adb("shell", command);

  const noteConsoleEvent = (message) => {
    if (
      message.method === "Runtime.consoleAPICalled" &&
      (message.params.type === "error" || message.params.type === "assert")
    ) {
      const text = (message.params.args ?? [])
        .map((arg) => arg.value ?? arg.description ?? arg.unserializableValue ?? "")
        .join(" ")
        .trim();
      if (text) consoleErrors.push(`console.${message.params.type}: ${text.slice(0, 200)}`);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails ?? {};
      const text = details.exception?.description ?? details.text ?? "uncaught exception";
      consoleErrors.push(`uncaught: ${String(text).slice(0, 200)}`);
      return;
    }
    if (message.method === "Log.entryAdded" && message.params.entry?.level === "error") {
      const entry = message.params.entry;
      consoleErrors.push(`${entry.source}: ${String(entry.text).slice(0, 200)}`);
    }
  };

  const send = (method, params = {}, timeoutMs = 20_000) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`cdp timeout: ${method}`));
      }, timeoutMs);
    });

  const openCdp = async () => {
    const targets = await (await fetch(`http://localhost:${port}/json`)).json();
    const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl) ?? targets[0];
    if (!page) throw new Error(`no CDP page on port ${port}`);
    const next = new WebSocket(page.webSocketDebuggerUrl);
    pending = new Map();
    nextId = 1;
    next.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        noteConsoleEvent(message);
        return;
      }
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    });
    await new Promise((resolve, reject) => {
      next.addEventListener("open", resolve);
      next.addEventListener("error", () => reject(new Error("cdp socket refused")));
    });
    socket = next;
    await send("Runtime.enable", {}, 20_000);
    await send("Log.enable", {}, 20_000).catch(() => undefined);
  };

  /** Point the local port at this package's WebView, resolving its pid the way droidctl does. */
  const forwardWebView = async () => {
    const sockets = await shell("cat /proc/net/unix");
    const pid = (await shell(`pidof ${packageName}`)).trim().split(/\s+/)[0];
    if (!pid) throw new Error(`${packageName} is not running`);
    const name = `webview_devtools_remote_${pid}`;
    if (!sockets.includes(name)) throw new Error(`no devtools socket for pid ${pid}; is this a debug build?`);
    await adb("forward", "--remove-all").catch(() => undefined);
    await adb("forward", `tcp:${port}`, `localabstract:${name}`);
  };

  const attach = async () => {
    await forwardWebView();
    await openCdp();
  };

  const ensureAttached = async () => {
    if (socket && socket.readyState === WebSocket.OPEN) return;
    await attach();
  };

  const evaluate = async (expression, timeoutMs = 20_000) => {
    await ensureAttached();
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    const value = result.result.value;
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };

  const takeConsoleErrors = () => {
    const taken = consoleErrors;
    consoleErrors = [];
    return taken;
  };

  /**
   * The window that has focus, when it is not this app's.
   *
   * Nothing read over CDP can see one. The WebView keeps answering while an Android runtime-permission
   * dialog, a system share sheet or a clipboard editor sits on top of it, so a stage goes on driving a
   * page the user cannot reach and reports whatever it finds. That is not hypothetical: a
   * POST_NOTIFICATIONS prompt appeared after an app-data reset, took focus, stopped the tune, and the
   * network stage blamed the Wi-Fi for it.
   */
  const foreignFocusedWindow = async () => {
    const dump = await shell("dumpsys window | grep -m1 mCurrentFocus").catch(() => "");
    const match = /mCurrentFocus=Window\{[^\s]+ \S+ ([^}]+)\}/.exec(dump.trim());
    const window = match?.[1]?.trim();
    if (!window || window.startsWith(packageName)) return null;
    return window;
  };

  /** Drop the socket, so a run that is finished does not leave the page attached. */
  const close = () => socket?.close();

  return { adb, shell, attach, ensureAttached, evaluate, send, close, takeConsoleErrors, foreignFocusedWindow };
};
