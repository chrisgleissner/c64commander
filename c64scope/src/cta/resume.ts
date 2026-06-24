/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CheckpointJournal } from "./checkpointJournal.js";
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

function resolveArtifactDir(args: readonly string[]): string {
  const explicit = readFlagValue(args, "artifact-dir");
  if (explicit) {
    return explicit;
  }
  const runId = readFlagValue(args, "run-id");
  if (!runId) {
    throw new Error("CTA resume requires --artifact-dir or --run-id.");
  }
  return path.join(resolveWorkspaceRoot(), "c64scope", "artifacts", runId);
}

export async function main(): Promise<void> {
  const artifactDir = resolveArtifactDir(process.argv.slice(2));
  const journal = new CheckpointJournal(path.join(artifactDir, "checkpoint.jsonl"));
  const entries = await journal.readAll();
  const latest = entries.at(-1) ?? null;
  const summary = {
    artifactDir,
    checkpointCount: entries.length,
    latest,
    resumable: latest !== null && !latest.restored,
  };
  const summaryPath = path.join(artifactDir, "resume-summary.json");
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`CTA resume summary written: ${summaryPath}`);
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
