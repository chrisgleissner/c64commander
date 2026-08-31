/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CommandRecord } from "./transport/types.js";
import { createRunId, nowIso } from "./types.js";

export type ArtifactCategory = "raw" | "review" | "hierarchies" | "video" | "logs/logcat";

export interface ArtifactEntry {
  readonly timestamp: string;
  readonly tool: string;
  readonly targetId: string | null;
  readonly category: ArtifactCategory;
  readonly path: string;
  readonly bytes: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function assertPngSignature(bytes: Buffer, where: string): void {
  if (bytes.length === 0) {
    throw new Error(`Zero-byte PNG payload for ${where}.`);
  }
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error(`Payload for ${where} is not a PNG (first bytes: ${bytes.subarray(0, 8).toString("hex")}).`);
  }
}

export function assertMp4Signature(bytes: Buffer, where: string): void {
  if (bytes.length === 0) {
    throw new Error(`Zero-byte MP4 payload for ${where}.`);
  }
  if (bytes.length < 12 || bytes.toString("utf8", 4, 8) !== "ftyp") {
    throw new Error(
      `Payload for ${where} has no MP4 ftyp box (first bytes: ${bytes.subarray(0, 12).toString("hex")}).`,
    );
  }
}

export function sanitizeArtifactName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  if (cleaned.length === 0) {
    throw new Error(`Artifact name ${JSON.stringify(name)} contains no usable characters.`);
  }
  return cleaned;
}

export interface ArtifactStoreOptions {
  readonly root?: string;
  readonly runId?: string;
}

/**
 * One run directory per server process, with commands.jsonl recording every
 * transport invocation. A failed stage today leaves no record of which adb calls
 * ran, and no record of which target they ran against.
 */
export class ArtifactStore {
  readonly runId: string;
  readonly runDir: string;
  private readonly artifacts: ArtifactEntry[] = [];
  private commandCount = 0;

  constructor(options: ArtifactStoreOptions = {}) {
    const root =
      options.root ?? process.env["DROIDCTL_ARTIFACT_ROOT"] ?? path.join(process.cwd(), "artifacts", "droidctl");
    this.runId = options.runId ?? createRunId();
    this.runDir = path.join(root, this.runId);
  }

  pathFor(category: ArtifactCategory, filename: string, runRoot?: string): string {
    const base = runRoot ? path.resolve(runRoot) : this.runDir;
    const dir = path.join(base, ...category.split("/"));
    mkdirSync(dir, { recursive: true });
    return path.join(dir, filename);
  }

  write(
    tool: string,
    targetId: string | null,
    category: ArtifactCategory,
    filename: string,
    bytes: Buffer | string,
    runRoot?: string,
  ): ArtifactEntry {
    const filePath = this.pathFor(category, filename, runRoot);
    const payload = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
    writeFileSync(filePath, payload);
    return this.record(tool, targetId, category, filePath, payload.length);
  }

  record(
    tool: string,
    targetId: string | null,
    category: ArtifactCategory,
    filePath: string,
    bytes: number,
  ): ArtifactEntry {
    const entry: ArtifactEntry = { timestamp: nowIso(), tool, targetId, category, path: filePath, bytes };
    this.artifacts.push(entry);
    this.writeIndex();
    return entry;
  }

  recordCommand(record: CommandRecord): void {
    mkdirSync(this.runDir, { recursive: true });
    appendFileSync(path.join(this.runDir, "commands.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
    this.commandCount += 1;
  }

  commandsRecorded(): number {
    return this.commandCount;
  }

  index(): readonly ArtifactEntry[] {
    return this.artifacts;
  }

  private writeIndex(): void {
    mkdirSync(this.runDir, { recursive: true });
    writeFileSync(
      path.join(this.runDir, "index.json"),
      `${JSON.stringify({ runId: this.runId, runDir: this.runDir, artifacts: this.artifacts }, null, 2)}\n`,
      "utf8",
    );
  }
}
