#!/usr/bin/env node
/* C64 Commander — GPL-3.0-or-later, Copyright (C) 2026 Christian Gleissner. */

import { spawn } from "node:child_process";
import { connect } from "./remote-input-hil/cdp.mjs";
import { createDroidDevice } from "../tools/hil/droidctl_device.mjs";

const separator = process.argv.indexOf("--");
const command = separator >= 0 ? process.argv.slice(separator + 1) : [];
if (!command.length) throw new Error("Usage: node scripts/run-callback-hil.mjs -- <command> [arguments]");
const phone = await createDroidDevice({ serial: process.env.ANDROID_SERIAL });
const port = Number(process.env.CALLBACK_CDP_PORT ?? "9333");
await phone.forwardWebview("uk.gleissner.c64commander", port);
const pages = await (await fetch(`http://localhost:${port}/json`)).json();
const page = pages.find((candidate) => candidate.type === "page");
if (!page) throw new Error("No app WebView found for Callback CPU simulation");
const client = await connect(page.webSocketDebuggerUrl);
let child;
const stopChild = () => child?.kill("SIGTERM");
try {
  await client.send("Emulation.setCPUThrottlingRate", { rate: 2 });
  console.log("Pixel 4 WebView CPU rate 2; native viewport retained for physical touch coordinates");
  process.once("SIGINT", stopChild);
  process.once("SIGTERM", stopChild);
  child = spawn(command[0], command.slice(1), {
    stdio: "inherit",
    env: { ...process.env, ANDROID_SERIAL: phone.serial },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  process.removeListener("SIGINT", stopChild);
  process.removeListener("SIGTERM", stopChild);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  client.close();
}
