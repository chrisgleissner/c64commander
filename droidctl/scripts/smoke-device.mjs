#!/usr/bin/env node
/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Manual hardware check. Not a merge gate: tools/hil/merge_gate.mjs already is
 * one, and a second device gate doubles rig contention for no new signal.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDroidctlServerRuntime } from "../dist/server.js";

const usage = `Usage: node scripts/smoke-device.mjs --target <targetId> --package <applicationId> [--out <dir>]

Runs the device-side operations that cannot be proven without hardware:
screenshot, ui hierarchy, a recording, logcat, and a WebView forward. Requires an
explicit target; it will not pick one for you. List targets first with:

  node -e "import('./dist/server.js').then(async m => { const r = m.createDroidctlServerRuntime(); console.log((await r.toolRegistry.invoke('droid_target.list_targets', {})).content[0].text); })"
`;

const parseArgs = (argv) => {
  const parsed = { out: null, target: null, package: null, localPort: 9222 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (!next) throw new Error(`${arg} requires a value`);
      index += 1;
      return next;
    };
    if (arg === "--target") parsed.target = value();
    else if (arg === "--package") parsed.package = value();
    else if (arg === "--out") parsed.out = value();
    else if (arg === "--local-port") parsed.localPort = Number(value());
    else if (arg === "-h" || arg === "--help") parsed.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
};

const call = async (runtime, name, args) => {
  const result = await runtime.toolRegistry.invoke(name, args);
  const parsed = JSON.parse(result.content[0].text);
  console.log(`${parsed.ok ? "ok  " : "FAIL"} ${name}`);
  if (!parsed.ok) {
    console.log(`     ${parsed.error.code}: ${parsed.error.message}`);
  }
  return parsed;
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage);
    return 0;
  }
  if (!args.target || !args.package) {
    process.stderr.write(`--target and --package are both required.\n\n${usage}`);
    return 2;
  }

  const runtime = createDroidctlServerRuntime(args.out ? { artifactRoot: path.resolve(args.out) } : {});
  console.log(`run directory: ${runtime.artifacts.runDir}`);

  await call(runtime, "droid_target.describe_target", { targetId: args.target });
  await call(runtime, "droid_device.prepare_device", { targetId: args.target, dismissKeyguard: true });
  await call(runtime, "droid_capture.screenshot", { targetId: args.target, name: "smoke" });
  await call(runtime, "droid_capture.ui_hierarchy", { targetId: args.target, name: "smoke" });

  const recording = await call(runtime, "droid_capture.start_recording", {
    targetId: args.target,
    name: "smoke",
    timeLimitSec: 10,
  });
  await new Promise((resolve) => setTimeout(resolve, 4000));
  if (recording.ok) {
    await call(runtime, "droid_capture.stop_recording", {
      targetId: args.target,
      recordingId: recording.data.recordingId,
    });
  }

  await call(runtime, "droid_capture.logcat", {
    targetId: args.target,
    mode: "dump",
    name: "smoke",
    lines: 200,
    package: args.package,
  });
  await call(runtime, "droid_device.forward_webview", {
    targetId: args.target,
    package: args.package,
    localPort: args.localPort,
  });

  console.log(`artifacts: ${runtime.artifacts.index().length}, commands: ${runtime.artifacts.commandsRecorded()}`);
  return 0;
};

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entrypoint === fileURLToPath(import.meta.url)) {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      process.exitCode = 1;
    });
}
