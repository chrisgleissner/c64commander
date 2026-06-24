/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkpointEntry, CheckpointJournal } from "../src/cta/checkpointJournal.js";

describe("CTA checkpoint journal", () => {
  it("builds deterministic checkpoint entries with defaults", () => {
    const entry = checkpointEntry({
      runId: "run-1",
      caseId: "case-1",
      stepId: "step-1",
      stateKey: "state-1",
      recordedAt: "2026-06-24T00:00:00.000Z",
    });

    expect(entry).toEqual({
      runId: "run-1",
      caseId: "case-1",
      stepId: "step-1",
      recordedAt: "2026-06-24T00:00:00.000Z",
      stateKey: "state-1",
      completedActions: [],
      pendingActions: [],
      restored: false,
    });
  });

  it("appends and reads JSONL checkpoints", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "cta-checkpoint-"));
    const journal = new CheckpointJournal(path.join(tempDir, "checkpoint.jsonl"));

    try {
      await expect(journal.latest()).resolves.toBeNull();
      await journal.append({
        runId: "run-1",
        caseId: "case-1",
        stepId: "step-1",
        stateKey: "state-1",
        completedActions: ["a"],
      });
      await journal.append({
        runId: "run-1",
        caseId: "case-1",
        stepId: "step-2",
        stateKey: "state-2",
        pendingActions: ["b"],
      });

      await expect(journal.readAll()).resolves.toHaveLength(2);
      await expect(journal.latest()).resolves.toMatchObject({ stepId: "step-2", pendingActions: ["b"] });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("surfaces malformed journal lines with context", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "cta-checkpoint-bad-"));
    const journalPath = path.join(tempDir, "checkpoint.jsonl");
    const journal = new CheckpointJournal(journalPath);

    try {
      await writeFile(journalPath, "not json\n", "utf-8");
      await expect(journal.readAll()).rejects.toThrow(/Invalid checkpoint journal entry 1/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
