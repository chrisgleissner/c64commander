/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Run as its own process by tunnelReaper.test.ts. It lists a scripted phone through
 * an in-process runtime, the way a HIL harness does, with the container adb tunnel
 * backed by a real long-running process, then returns without closing anything.
 * The test asserts that this process exits by itself and takes the tunnel with it.
 */

import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createDroidctlServerRuntime } from "../../src/server.js";
import { type RawSpawnHandle, type RawSpawnRequest, nodeSpawnRunner } from "../../src/transport/adb.js";
import { TunnelReaper, nodeTunnelReaperDeps } from "../../src/transport/tunnelReaper.js";
import { usbPhone } from "../support/sshFakes.js";

const workDir = process.argv[2]!;
const pidFile = path.join(workDir, "tunnel.pid");
const exitLog = path.join(workDir, "exit.log");

const phone = usbPhone({ listeners: ["00000000:15B3"], endpoints: { "127.0.0.1:5555": "device" } });
const reaper = new TunnelReaper({
  ...nodeTunnelReaperDeps,
  runSync: (argv) => appendFileSync(exitLog, `${argv.join(" ")}\n`),
});

const tunnelScript = `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1e9);`;

function spawnRealTunnel(request: RawSpawnRequest): RawSpawnHandle {
  const scripted = phone.spawn(request);
  const real = nodeSpawnRunner({
    file: process.execPath,
    args: ["-e", tunnelScript],
    ...(request.detachFromEventLoop === undefined ? {} : { detachFromEventLoop: request.detachFromEventLoop }),
  });
  return {
    kill(signal) {
      real.kill(signal);
      scripted.kill(signal);
    },
    onClose: (listener) => real.onClose(listener),
    onStderr: (listener) => real.onStderr(listener),
  };
}

const runtime = createDroidctlServerRuntime({
  artifactRoot: workDir,
  transports: [phone.transport({ spawn: spawnRealTunnel, tunnelReaper: reaper })],
});
const result = await runtime.toolRegistry.invoke("droid_target.list_targets", {});
const listing = JSON.parse(result.content[0]!.text) as { data?: { targets?: { route?: string }[] } };
if (listing.data?.targets?.[0]?.route !== "container-adb") {
  throw new Error(`expected a container-adb target, got ${result.content[0]!.text}`);
}

const deadline = Date.now() + 5_000;
while (!existsSync(pidFile) && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 25));
}
process.stdout.write("ready\n");
