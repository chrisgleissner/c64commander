/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveAdbSerial, resolvePreferredPhysicalTestDeviceSerial } from "./deviceRegistry.js";
import { runPreflight } from "./preflight.js";
import { discoverMirroredCorpora } from "./testDataDiscovery.js";
import { runCase } from "./validation/runner.js";
import { appFirstPlaybackContinuity, appFirstPlaylistAutoAdvance } from "./validation/cases/index.js";
import type { RunResult, ValidationCase } from "./validation/types.js";

function timestampId(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function resolveWorkspaceRoot(): string {
  return path.basename(process.cwd()) === "c64scope" ? path.resolve(process.cwd(), "..") : process.cwd();
}

function isDirectExecution(metaUrl: string): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && pathToFileURL(entry!).href === metaUrl;
}

export async function main(): Promise<void> {
  const serialInput = process.env["ANDROID_SERIAL"];
  const serial = serialInput ? await resolveAdbSerial(serialInput) : await resolvePreferredPhysicalTestDeviceSerial();
  const c64uHost = process.env["C64U_HOST"] ?? "c64u";
  const repeatRaw = process.env["REPEAT"] ?? "3";
  const repeatCount = Number.parseInt(repeatRaw, 10);
  if (!Number.isFinite(repeatCount) || repeatCount < 1) {
    throw new Error(`Invalid REPEAT value "${repeatRaw}". REPEAT must be a positive integer (>= 1).`);
  }
  const workspaceRoot = resolveWorkspaceRoot();
  const artifactRoot = path.join(workspaceRoot, "c64scope", "artifacts");
  const runRoot = path.join(artifactRoot, `wave1-${timestampId()}`);
  const discoveryPath = path.join(runRoot, "discovery.json");
  const summaryPath = path.join(runRoot, "summary.md");
  const cases: ValidationCase[] = [appFirstPlaybackContinuity, appFirstPlaylistAutoAdvance];

  const preflight = await runPreflight({ deviceSerial: serial, c64uHost });
  if (!preflight.ready) {
    const reasons = preflight.checks
      .filter((check) => check.status !== "pass")
      .map((check) => `${check.name}: ${check.detail}`);
    throw new Error(`Wave 1 preflight failed: ${reasons.join("; ")}`);
  }

  await mkdir(runRoot, { recursive: true });
  const discovery = await discoverMirroredCorpora(workspaceRoot, c64uHost);
  await writeFile(discoveryPath, JSON.stringify(discovery, null, 2), "utf-8");

  const results: RunResult[] = [];
  for (let repeat = 1; repeat <= repeatCount; repeat += 1) {
    for (const caseInfo of cases) {
      const result = await runCase(caseInfo, serial, c64uHost, artifactRoot);
      results.push(result);
    }
  }

  const lines = [
    "# Agentic Exploratory Wave 1",
    "",
    `- Started with serial: ${serial}`,
    `- C64U host: ${c64uHost}`,
    `- Repeat count: ${repeatCount}`,
    `- Discovery JSON: ${discoveryPath}`,
    "",
    "## Discovery",
    "",
    `- Local mirror root: ${discovery.local.mirror.rootPath}`,
    `- Local mirror files: ${discovery.local.mirror.fileCount}`,
    `- Local mirror directories: ${discovery.local.mirror.directoryCount}`,
    `- Local mirror symlinks: ${discovery.local.mirror.symlinkCount}`,
    discovery.local.hvscTarget
      ? `- Resolved HVSC target files: ${discovery.local.hvscTarget.fileCount}`
      : "- Resolved HVSC target files: unavailable",
    discovery.local.hvscTarget
      ? `- Resolved HVSC target directories: ${discovery.local.hvscTarget.directoryCount}`
      : "- Resolved HVSC target directories: unavailable",
    `- Device root entries: ${discovery.device.topLevelEntries.join(", ")}`,
    `- Device SID candidates: ${discovery.device.sidCandidates.slice(0, 4).join(", ")}`,
    `- Device multi-disk directories: ${discovery.device.multiDiskDirectories.join(", ")}`,
    `- Device approximate file count: ${discovery.device.approximateFileCount ?? "n/a"}`,
    `- Device approximation basis: ${discovery.device.approximationBasis}`,
    "",
    "## Results",
    "",
    ...results.map(
      (result, index) =>
        `- Run ${index + 1}: ${result.caseId} => outcome=${result.outcome}; failureClass=${result.failureClass}; runId=${result.runId}; artifacts=${result.artifactDir}`,
    ),
  ];

  await writeFile(summaryPath, lines.join("\n"), "utf-8");
  console.log(`Wave 1 summary written: ${summaryPath}`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
