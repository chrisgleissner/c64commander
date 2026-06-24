/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listRetentionCandidates, pruneSuccessfulRuns } from "../src/cta/retention.js";

async function writeResults(runDir: string, failCount: number): Promise<void> {
  await mkdir(runDir, { recursive: true });
  await writeFile(
    path.join(runDir, "results.json"),
    JSON.stringify({ coverageSummary: { byStatus: { FAIL: failCount } } }),
    "utf-8",
  );
}

describe("CTA artifact retention", () => {
  it("ignores discover artifact roots when pruning successful runner artifacts", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "cta-retention-"));
    const discoverDir = path.join(tempDir, "cta-discover");
    const olderRun = path.join(tempDir, "cta-20260624T100000Z-pixel4-c64u-123456789abc");
    const newerRun = path.join(tempDir, "cta-20260624T110000Z-pixel4-c64u-123456789abc");

    try {
      await mkdir(discoverDir, { recursive: true });
      await writeResults(olderRun, 0);
      await writeResults(newerRun, 0);
      await utimes(olderRun, new Date("2026-06-24T10:00:00Z"), new Date("2026-06-24T10:00:00Z"));
      await utimes(newerRun, new Date("2026-06-24T11:00:00Z"), new Date("2026-06-24T11:00:00Z"));

      await expect(listRetentionCandidates(tempDir)).resolves.toHaveLength(2);
      await expect(pruneSuccessfulRuns(tempDir, 1)).resolves.toEqual([olderRun]);
      expect((await stat(discoverDir)).isDirectory()).toBe(true);
      await expect(stat(olderRun)).rejects.toThrow(/ENOENT/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
