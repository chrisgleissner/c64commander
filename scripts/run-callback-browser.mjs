#!/usr/bin/env node
/* C64 Commander — GPL-3.0-or-later, Copyright (C) 2026 Christian Gleissner. */

import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { constrainCallbackCpu } from "../playwright/callbackCpu.ts";

const separator = process.argv.indexOf("--");
const command = separator >= 0 ? process.argv.slice(separator + 1) : [];
if (!command.length) throw new Error("Usage: node scripts/run-callback-browser.mjs -- <command> [arguments]");
const referenceMs = Number(process.env.CALLBACK_KERNEL_MS ?? "171.8");
if (!Number.isFinite(referenceMs) || referenceMs <= 0) throw new Error("CALLBACK_KERNEL_MS must be positive");

const server = await chromium.launchServer({
  args: [
    "--enable-automation",
    "--remote-debugging-port=0",
    "--disable-font-subpixel-positioning",
    "--disable-lcd-text",
    "--disable-skia-runtime-opts",
    "--font-render-hinting=none",
    "--force-color-profile=srgb",
  ],
});
let browser;
let socket;
let protocolFailure;
let child;
try {
  browser = await chromium.connect(server.wsEndpoint());
  const context = await browser.newContext();
  const page = await context.newPage();
  const calibration = await constrainCallbackCpu(page, referenceMs);
  console.log(
    `Callback CPU calibration: ${JSON.stringify({ rate: calibration.rate, measuredMs: calibration.measuredMs, referenceMs })}`,
  );
  const browserSession = await browser.newBrowserCDPSession();
  // Chromium publishes the DevTools socket in its profile when port zero picks a free port.
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const args = await browserSession.send("Browser.getBrowserCommandLine");
  const profile = args.arguments
    .find((argument) => argument.startsWith("--user-data-dir="))
    ?.split("=")
    .slice(1)
    .join("=");
  if (!profile) throw new Error("Chromium did not report its profile directory");
  const [port, socketPath] = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split("\n");
  if (!port || !socketPath) throw new Error(`Invalid DevToolsActivePort in ${profile}`);
  socket = new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("Could not connect to Callback browser DevTools"));
  });
  let nextId = 0;
  const pending = new Map();
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request?.reject(new Error(`${message.error.message}`));
      else request?.resolve(message.result);
      return;
    }
    if (message.method !== "Target.attachedToTarget") return;
    const { sessionId, targetInfo: target } = message.params;
    void (async () => {
      if (target.type === "page") {
        await send("Emulation.setCPUThrottlingRate", { rate: calibration.rate }, sessionId);
      }
      await send("Runtime.runIfWaitingForDebugger", {}, sessionId);
    })().catch((error) => {
      console.error("Applying Callback CPU constraint to a new browser target failed", target, error);
      protocolFailure = error;
      child?.kill("SIGTERM");
    });
  };
  await context.close();
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  child = spawn(command[0], command.slice(1), {
    stdio: "inherit",
    env: { ...process.env, CALLBACK_BROWSER_WS: server.wsEndpoint(), PLAYWRIGHT_WORKERS: "1" },
  });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (protocolFailure) throw new Error("Callback browser simulation failed", { cause: protocolFailure });
  process.exitCode = result.code ?? 1;
} finally {
  socket?.close();
  await browser?.close();
  await server.close();
}
