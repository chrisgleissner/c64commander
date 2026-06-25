/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const checkpointEntrySchema = z.object({
  runId: z.string().min(1),
  caseId: z.string().min(1),
  stepId: z.string().min(1),
  recordedAt: z.string().min(1),
  stateKey: z.string().min(1),
  completedActions: z.array(z.string()),
  pendingActions: z.array(z.string()),
  restored: z.boolean(),
});

export type CheckpointEntry = z.infer<typeof checkpointEntrySchema>;

export interface CheckpointInput {
  runId: string;
  caseId: string;
  stepId: string;
  stateKey: string;
  completedActions?: readonly string[];
  pendingActions?: readonly string[];
  restored?: boolean;
  recordedAt?: string;
}

export function checkpointEntry(input: CheckpointInput): CheckpointEntry {
  return checkpointEntrySchema.parse({
    runId: input.runId,
    caseId: input.caseId,
    stepId: input.stepId,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    stateKey: input.stateKey,
    completedActions: [...(input.completedActions ?? [])],
    pendingActions: [...(input.pendingActions ?? [])],
    restored: input.restored ?? false,
  });
}

export class CheckpointJournal {
  constructor(private readonly journalPath: string) {}

  async append(input: CheckpointInput): Promise<CheckpointEntry> {
    const entry = checkpointEntry(input);
    await mkdir(path.dirname(this.journalPath), { recursive: true });
    await appendFile(this.journalPath, `${JSON.stringify(entry)}\n`, "utf-8");
    return entry;
  }

  async readAll(): Promise<CheckpointEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.journalPath, "utf-8");
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to read checkpoint journal ${this.journalPath}: ${message}`);
    }

    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line, index) => {
        try {
          return checkpointEntrySchema.parse(JSON.parse(line));
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Invalid checkpoint journal entry ${index + 1} in ${this.journalPath}: ${message}`);
        }
      });
  }

  async latest(): Promise<CheckpointEntry | null> {
    const entries = await this.readAll();
    return entries.at(-1) ?? null;
  }
}
