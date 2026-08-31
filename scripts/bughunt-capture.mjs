#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * droidctl/dist is a build artifact and is gitignored, so this import is lazy:
 * importing it at module load would break any consumer that only wants the pure
 * helpers in this file on a tree that has not been built.
 */
const loadDroidctl = async () => {
  try {
    return await import("../droidctl/dist/server.js");
  } catch (error) {
    throw new Error(
      `Unable to load droidctl; run "npm run droid:build" first. Underlying error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

const APP_LOG_FILTER = "c64commander|AndroidRuntime|FATAL|ANR|chromium|Console";

const parseArgs = (argv) => {
  const parsed = { lines: 400 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (!next) throw new Error(`${flag} requires a value`);
      index += 1;
      return next;
    };
    if (flag === "--target") parsed.target = value();
    else if (flag === "--case") parsed.case = value();
    else if (flag === "--lines") parsed.lines = Number(value());
    else if (flag === "--out") parsed.out = value();
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return parsed;
};

const call = async (runtime, name, args) => {
  const result = await runtime.toolRegistry.invoke(name, args);
  return JSON.parse(result.content[0].text);
};

export const run = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  if (!args.target || !args.case || !args.out) {
    process.stderr.write("usage: bughunt-capture.mjs --target <targetId> --case <name> --out <dir> [--lines N]\n");
    return 2;
  }

  const { createDroidctlServerRuntime } = await loadDroidctl();
  const runtime = createDroidctlServerRuntime({ artifactRoot: path.resolve(args.out, "droidctl-runs") });
  const shared = { targetId: args.target, runRoot: path.resolve(args.out) };

  const foreground = await call(runtime, "droid_device.run_shell", {
    targetId: args.target,
    command: ["dumpsys", "activity", "activities"],
  });
  if (foreground.ok) {
    const resumed = /(?:mResumedActivity|ResumedActivity)[^\n]*/.exec(foreground.data.stdout);
    console.log(resumed ? resumed[0].trim() : "resumed activity: unknown");
  } else {
    console.log(`resumed activity: unavailable (${foreground.error.code})`);
  }

  const shot = await call(runtime, "droid_capture.screenshot", { ...shared, name: args.case });
  console.log(shot.ok ? `screenshot: ${shot.data.rawPath}` : `screenshot FAILED: ${shot.error.message}`);

  const hierarchy = await call(runtime, "droid_capture.ui_hierarchy", { ...shared, name: args.case });
  console.log(
    hierarchy.ok
      ? `hierarchy: ${hierarchy.data.xmlPath} (${hierarchy.data.nodeCount} nodes)`
      : `hierarchy FAILED: ${hierarchy.error.message}`,
  );

  const logcat = await call(runtime, "droid_capture.logcat", {
    ...shared,
    mode: "dump",
    name: args.case,
    lines: args.lines,
    filters: [APP_LOG_FILTER],
  });
  console.log(
    logcat.ok
      ? `logcat: ${logcat.data.logPath} (${logcat.data.matchedCount} of ${logcat.data.lineCount} lines matched)`
      : `logcat FAILED: ${logcat.error.message}`,
  );

  return shot.ok && hierarchy.ok && logcat.ok ? 0 : 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      process.exitCode = 1;
    });
}
