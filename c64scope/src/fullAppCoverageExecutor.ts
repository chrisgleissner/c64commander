/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { resolveAdbSerial, resolvePreferredPhysicalTestDeviceSerial } from "./deviceRegistry.js";
import { runPreflight } from "./preflight.js";
import { ALL_CASES } from "./validation/cases/index.js";
import { runCase } from "./validation/runner.js";
import type { RunResult, ValidationCase } from "./validation/types.js";

const matrixEntrySchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
});

const manifestItemSchema = z.object({
  featureId: z.string().min(1),
  promptPath: z.string().min(1),
  mappedCaseId: z.string().nullable(),
  executionStatus: z.enum(["executed", "not-executed"]),
  runId: z.string().nullable(),
  evidencePath: z.string().nullable(),
  result: z.enum(["PASS", "FAIL", "BLOCKED"]),
  reason: z.string().min(1),
});

const manifestSchema = z.object({
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  serial: z.string().min(1),
  c64uHost: z.string().min(1),
  items: z.array(manifestItemSchema),
});

const featureToCaseIdMap: Record<string, string> = {
  F001: "AF-LAUNCH-SHELL-001",
  F002: "AF-TABS-001",
  F003: "AF-HOME-SURFACE-001",
  F004: "AF-HOME-SURFACE-001",
  F005: "AF-HOME-SURFACE-001",
  F006: "AF-HOME-SURFACE-001",
  F007: "AF-DISKS-SURFACE-001",
  F008: "AF-DISKS-SURFACE-001",
  F009: "AF-DISKS-SURFACE-001",
  F010: "AF-PLAY-SURFACE-001",
  F011: "AF-PLAY-SURFACE-001",
  F012: "AF-PLAY-SURFACE-001",
  F013: "AF-PLAY-SURFACE-001",
  F014: "AF-PLAY-SURFACE-001",
  F015: "AF-PLAY-SURFACE-001",
  F016: "AF-PLAY-SURFACE-001",
  F017: "AF-RUNTIME-RECOVERY-001",
  F018: "AF-CONFIG-SURFACE-001",
  F019: "AF-CONFIG-SURFACE-001",
  F020: "AF-SETTINGS-SURFACE-001",
  F021: "AF-SETTINGS-SURFACE-001",
  F022: "AF-TABS-001",
  F023: "AF-RUNTIME-RECOVERY-001",
};

export function timestampId(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function resolveWorkspaceRoot(): string {
  return path.basename(process.cwd()) === "c64scope" ? path.resolve(process.cwd(), "..") : process.cwd();
}

export async function parseFeatureMatrix(matrixPath: string): Promise<Array<{ id: string; prompt: string }>> {
  const raw = await readFile(matrixPath, "utf-8");
  const jsonMatch = raw.match(/```json\n([\s\S]+?)\n```/);
  if (!jsonMatch) {
    throw new Error(`Unable to locate machine-readable JSON block in ${matrixPath}`);
  }
  const parsed = JSON.parse(jsonMatch[1] ?? "[]");
  if (!Array.isArray(parsed)) {
    throw new Error(`Machine-readable matrix block is not an array in ${matrixPath}`);
  }
  return parsed.map((entry) => {
    const validated = matrixEntrySchema.parse(entry);
    return { id: validated.id, prompt: validated.prompt };
  });
}

export async function assertPromptFileExists(promptPath: string): Promise<void> {
  try {
    await access(promptPath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Prompt file missing at ${promptPath}: ${message}`);
  }
}

export function toFeatureResult(runResult: RunResult): "PASS" | "FAIL" {
  return runResult.outcome === "pass" ? "PASS" : "FAIL";
}

export async function main(): Promise<void> {
  const workspaceRoot = resolveWorkspaceRoot();
  const docsRoot = path.join(workspaceRoot, "docs", "testing", "agentic-tests", "full-app-coverage");
  const runsRoot = path.join(docsRoot, "runs");
  const matrixPath = path.join(docsRoot, "feature-status-matrix.md");
  const artifactRoot = path.join(workspaceRoot, "c64scope", "artifacts");

  const serialInput = process.env["ANDROID_SERIAL"];
  const serial = serialInput ? await resolveAdbSerial(serialInput) : await resolvePreferredPhysicalTestDeviceSerial();
  const c64uHost = process.env["C64U_HOST"] ?? "192.168.1.13";

  const preflight = await runPreflight({ deviceSerial: serial, c64uHost });
  if (!preflight.ready) {
    const reasons = preflight.checks
      .filter((check) => check.status !== "pass")
      .map((check) => `${check.name}: ${check.detail}`)
      .join("; ");
    throw new Error(`Preflight failed for full-app coverage executor: ${reasons}`);
  }

  const matrixEntries = await parseFeatureMatrix(matrixPath);
  const caseByCaseId = new Map<string, ValidationCase>(ALL_CASES.map((caseInfo) => [caseInfo.caseId, caseInfo]));
  const executedCaseResults = new Map<string, RunResult>();
  const startedAt = new Date().toISOString();

  await mkdir(runsRoot, { recursive: true });
  await mkdir(artifactRoot, { recursive: true });

  const items: Array<z.infer<typeof manifestItemSchema>> = [];

  for (const entry of matrixEntries) {
    const promptPath = path.join(docsRoot, entry.prompt);
    await assertPromptFileExists(promptPath);

    const mappedCaseId = featureToCaseIdMap[entry.id] ?? null;
    if (!mappedCaseId) {
      items.push({
        featureId: entry.id,
        promptPath,
        mappedCaseId: null,
        executionStatus: "not-executed",
        runId: null,
        evidencePath: null,
        result: "BLOCKED",
        reason: "No product-track case mapping available for this feature yet.",
      });
      continue;
    }

    const caseInfo = caseByCaseId.get(mappedCaseId);
    if (!caseInfo) {
      items.push({
        featureId: entry.id,
        promptPath,
        mappedCaseId,
        executionStatus: "not-executed",
        runId: null,
        evidencePath: null,
        result: "BLOCKED",
        reason: `Mapped case '${mappedCaseId}' is missing from validation case registry.`,
      });
      continue;
    }

    let runResult = executedCaseResults.get(mappedCaseId);
    if (!runResult) {
      runResult = await runCase(caseInfo, serial, c64uHost, artifactRoot);
      executedCaseResults.set(mappedCaseId, runResult);
    }

    items.push({
      featureId: entry.id,
      promptPath,
      mappedCaseId,
      executionStatus: "executed",
      runId: runResult.runId,
      evidencePath: runResult.artifactDir,
      result: toFeatureResult(runResult),
      reason: `Mapped to ${caseInfo.id} (${caseInfo.name})`,
    });
  }

  const finishedAt = new Date().toISOString();
  const manifest = manifestSchema.parse({
    startedAt,
    finishedAt,
    serial,
    c64uHost,
    items,
  });

  const runId = `fac-${timestampId()}-executor-manifest`;
  const jsonPath = path.join(runsRoot, `${runId}.json`);
  const summaryPath = path.join(runsRoot, `${runId}.md`);
  await writeFile(jsonPath, JSON.stringify(manifest, null, 2), "utf-8");

  const passCount = manifest.items.filter((item) => item.result === "PASS").length;
  const failCount = manifest.items.filter((item) => item.result === "FAIL").length;
  const blockedCount = manifest.items.filter((item) => item.result === "BLOCKED").length;
  await writeFile(
    summaryPath,
    [
      `# Full App Coverage Executor Run (${runId})`,
      "",
      `- Started: ${manifest.startedAt}`,
      `- Finished: ${manifest.finishedAt}`,
      `- Device serial: ${manifest.serial}`,
      `- C64U host: ${manifest.c64uHost}`,
      `- PASS: ${passCount}`,
      `- FAIL: ${failCount}`,
      `- BLOCKED: ${blockedCount}`,
      "",
      "## Item Summary",
      "",
      ...manifest.items.map(
        (item) =>
          `- ${item.featureId}: ${item.result} (${item.executionStatus})` +
          ` | case=${item.mappedCaseId ?? "none"}` +
          ` | run=${item.runId ?? "n/a"}` +
          ` | evidence=${item.evidencePath ?? "n/a"}` +
          ` | reason=${item.reason}`,
      ),
      "",
      `- Manifest JSON: ${jsonPath}`,
    ].join("\n"),
    "utf-8",
  );

  console.log(`Executor manifest written: ${jsonPath}`);
  console.log(`Executor summary written:  ${summaryPath}`);
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
