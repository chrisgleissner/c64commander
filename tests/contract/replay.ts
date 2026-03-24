/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import fs from "node:fs";
import path from "node:path";
import { DefaultConfig, loadConfig } from "./lib/config.js";
import { TraceCollector } from "./lib/traceCollector.js";
import { buildReplayConfig, createReplayLogCollector, runReplay } from "./lib/replayEngine.js";
import type { ReplayManifest } from "./lib/traceSchema.js";
import { writeReplayManifest, writeTraceLine, writeTraceMd } from "./lib/traceWriter.js";

const args = parseArgs(process.argv.slice(2));
if (!args.manifestPath) {
  throw new Error("--manifest is required");
}

const manifest = JSON.parse(fs.readFileSync(resolvePath(args.manifestPath), "utf8")) as ReplayManifest;
const overrideConfig = args.configPath ? loadConfig(args.configPath) : DefaultConfig;
const config = buildReplayConfig(DefaultConfig, overrideConfig);
const runId = `replay-${manifest.runSessionId}`;
const runRoot = path.join(process.cwd(), config.outputDir, "runs", runId);

fs.mkdirSync(path.join(runRoot, "replay"), { recursive: true });

const traceCollector = new TraceCollector(runId);
const traceStream = fs.createWriteStream(path.join(runRoot, "trace.jsonl"), { flags: "a" });
traceCollector.onEmit((entry) => writeTraceLine(traceStream, entry));
const replayLog = createReplayLogCollector(runId);

const result = await runReplay({
  manifest,
  config,
  traceCollector,
  log: replayLog.log,
  dryRun: args.dryRun,
});

fs.writeFileSync(path.join(runRoot, "logs.jsonl"), `${replayLog.lines.join("\n")}\n`, "utf8");
fs.writeFileSync(
  path.join(runRoot, "meta.json"),
  `${JSON.stringify(
    {
      runId,
      replayOf: manifest.runSessionId,
      startedAt: result.startedAt,
      baseUrl: config.baseUrl,
      auth: config.auth,
      ftpMode: config.ftpMode,
      outcome: result.outcome,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
writeTraceMd(runRoot, traceCollector.snapshot());
writeReplayManifest(runRoot, traceCollector.snapshot(), config.baseUrl);
traceStream.end();

if (result.outcome === "device-unresponsive") {
  fs.writeFileSync(
    path.join(runRoot, "DEVICE_UNRESPONSIVE"),
    `runId: ${runId}\ntimestamp: ${new Date().toISOString()}\nabortReason: replay failed\nlastStageId: none\n`,
    "utf8",
  );
  process.exitCode = 2;
}

function parseArgs(argv: string[]): { manifestPath?: string; configPath?: string; dryRun: boolean } {
  const result: { manifestPath?: string; configPath?: string; dryRun: boolean } = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--manifest") {
      result.manifestPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (argv[index] === "--config") {
      result.configPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (argv[index] === "--dry-run") {
      result.dryRun = true;
    }
  }
  return result;
}

function resolvePath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}
