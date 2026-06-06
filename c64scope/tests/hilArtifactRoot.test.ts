/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseHilEvidenceArgs, resolveHilArtifactsRoot } from "../src/hilEvidenceRun.js";
import {
  parseArgs as parsePlaybackVolumeLatencyArgs,
  resolvePlaybackVolumeLatencyArtifactDir,
} from "../src/playbackVolumeLatency.js";

describe("HIL artifact root handling", () => {
  it("resolves hil evidence artifacts under the requested root", () => {
    const args = parseHilEvidenceArgs(["--artifact-root", "tmp/ph8/hil"]);
    const root = resolveHilArtifactsRoot("/workspace/c64commander", args);

    expect(root).toBe(path.resolve("/workspace/c64commander", "tmp/ph8/hil"));
  });

  it("resolves playback latency artifacts under the requested root", () => {
    const args = parsePlaybackVolumeLatencyArgs(["--artifact-root", "tmp/ph8/scope", "--host", "u64"]);
    const dir = resolvePlaybackVolumeLatencyArtifactDir(args, "/workspace/c64commander", "u64", "20260606T010000Z");

    expect(dir).toBe(
      path.resolve("/workspace/c64commander", "tmp/ph8/scope/playback-volume-latency/20260606T010000Z-u64"),
    );
  });

  it("preserves exact playback latency artifact-dir override", () => {
    const args = parsePlaybackVolumeLatencyArgs(["--artifact-dir", "tmp/exact", "--host", "u64"]);
    const dir = resolvePlaybackVolumeLatencyArtifactDir(args, "/workspace/c64commander", "u64", "20260606T010000Z");

    expect(dir).toBe(path.resolve("/workspace/c64commander", "tmp/exact"));
  });

  it("keeps root npm wrappers forwarding c64scope HIL arguments", () => {
    const rootPackage = JSON.parse(readFileSync(path.resolve(process.cwd(), "..", "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["scope:hil:evidence"]).toContain("npm run hil:evidence --");
    expect(rootPackage.scripts["scope:hil:playback-volume-latency"]).toContain(
      "npm run hil:playback-volume-latency --",
    );
  });
});
