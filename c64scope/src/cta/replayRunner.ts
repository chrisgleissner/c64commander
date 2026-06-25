/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { replaySpecSchema } from "./replay.js";
import { resolveWorkspaceRoot } from "../fullAppCoverageExecutor.js";

function readFlagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function resolveReplayFile(args: readonly string[]): string {
  const explicit = readFlagValue(args, "replay-file");
  if (explicit) {
    return explicit;
  }
  const runId = readFlagValue(args, "run-id");
  const caseId = readFlagValue(args, "case");
  if (!runId || !caseId) {
    throw new Error("CTA replay requires --replay-file or both --run-id and --case.");
  }
  return path.join(resolveWorkspaceRoot(), "c64scope", "artifacts", runId, "replays", `${caseId}.json`);
}

export async function main(): Promise<void> {
  const replayFile = resolveReplayFile(process.argv.slice(2));
  const spec = replaySpecSchema.parse(JSON.parse(await readFile(replayFile, "utf-8")));
  const summary = {
    replayFile,
    runId: spec.runId,
    caseId: spec.caseId,
    requiredTarget: spec.requiredTarget,
    actionCount: spec.actions.length,
    firstAction: spec.actions[0]?.semanticTarget ?? null,
  };
  const summaryPath = path.join(path.dirname(replayFile), `${spec.caseId}-replay-summary.json`);
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`CTA replay summary written: ${summaryPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

function isDirectExecution(metaUrl: string): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && pathToFileURL(entry!).href === metaUrl;
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
