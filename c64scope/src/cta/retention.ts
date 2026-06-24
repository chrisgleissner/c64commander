/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

export interface RetentionCandidate {
  path: string;
  createdMs: number;
  successful: boolean;
}

const ctaRunDirectoryPattern = /^cta-\d{8}T\d{6}Z-pixel4-(?:c64u|u64)-[0-9a-f]{12}$/;

async function isSuccessfulRun(runDir: string): Promise<boolean> {
  try {
    const results = JSON.parse(await readFile(path.join(runDir, "results.json"), "utf-8")) as {
      coverageSummary?: { byStatus?: Record<string, number> };
    };
    return (results.coverageSummary?.byStatus?.["FAIL"] ?? 0) === 0;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to inspect CTA run results for retention at ${runDir}: ${message}`);
  }
}

export async function listRetentionCandidates(rootDir: string): Promise<RetentionCandidate[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const candidates: RetentionCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !ctaRunDirectoryPattern.test(entry.name)) {
      continue;
    }
    const runDir = path.join(rootDir, entry.name);
    const info = await stat(runDir);
    candidates.push({
      path: runDir,
      createdMs: info.mtimeMs,
      successful: await isSuccessfulRun(runDir),
    });
  }
  return candidates.sort((left, right) => right.createdMs - left.createdMs);
}

export async function pruneSuccessfulRuns(rootDir: string, retainSuccess: number): Promise<string[]> {
  if (retainSuccess < 0) {
    throw new Error(`retainSuccess must be >= 0; received ${retainSuccess}.`);
  }
  const successful = (await listRetentionCandidates(rootDir)).filter((candidate) => candidate.successful);
  const toDelete = successful.slice(retainSuccess);
  for (const candidate of toDelete) {
    await rm(candidate.path, { recursive: true, force: true });
  }
  return toDelete.map((candidate) => candidate.path);
}
