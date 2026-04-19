import path from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { describe, expect, it, vi } from "vitest";

import {
  collectJsdomCoverageFiles,
  collectSharedJsdomCoverageFiles,
  createCoveragePlan,
  dedicatedJsdomCoverageFiles,
  ensureReportsDirectory,
  getNycMergeArgs,
  getProjectFilesForRun,
  getNycReportArgs,
  getVitestCoverageArgs,
  coverageRunMaxAttempts,
  jsdomChunkCount,
  runOrThrow,
  splitFilesIntoChunks,
  unitCoverageRuns,
  wrapCommandWithDirectoryKeepalive,
} from "../../../scripts/run-unit-coverage.mjs";

describe("run-unit-coverage", () => {
  it("locks unit coverage to split jsdom shards and node project runs", () => {
    expect(jsdomChunkCount).toBe(32);
    expect(dedicatedJsdomCoverageFiles).toEqual([
      "tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.test.tsx",
      "tests/unit/hooks/useLightingStudio.test.tsx",
      "tests/unit/playFiles/useQueryFilteredPlaylist.scale.test.tsx",
      "tests/unit/playFiles/useQueryFilteredPlaylist.test.tsx",
    ]);
    expect(unitCoverageRuns).toEqual([
      ...dedicatedJsdomCoverageFiles.map((filePath) => ({
        projectName: "unit-jsdom",
        reportKey: `jsdom-dedicated-${path.basename(filePath, path.extname(filePath))}`,
        files: [filePath],
      })),
      ...Array.from({ length: jsdomChunkCount }, (_value, chunkIndex) => ({
        projectName: "unit-jsdom",
        reportKey: `jsdom-${chunkIndex + 1}`,
        chunkIndex,
        chunkCount: jsdomChunkCount,
      })),
      { projectName: "unit-node", reportKey: "node" },
    ]);
  });

  it("splits jsdom coverage files into balanced chunks", () => {
    expect(splitFilesIntoChunks(["a", "b", "c", "d", "e"], 3)).toEqual([["a", "d"], ["b", "e"], ["c"]]);
  });

  it("keeps the current heavy jsdom coverage specs on separate shards", () => {
    const rootDir = process.cwd();
    const chunks = splitFilesIntoChunks(collectSharedJsdomCoverageFiles(rootDir), jsdomChunkCount);

    const lightingStudioChunkIndex = chunks.findIndex((chunk) =>
      chunk.includes("tests/unit/hooks/useLightingStudio.test.tsx"),
    );
    const queryFilteredPlaylistChunkIndex = chunks.findIndex((chunk) =>
      chunk.includes("tests/unit/playFiles/useQueryFilteredPlaylist.scale.test.tsx"),
    );

    expect(lightingStudioChunkIndex).toBe(-1);
    expect(queryFilteredPlaylistChunkIndex).toBe(-1);
    expect(chunks.some((chunk) => chunk.includes("tests/unit/playFiles/useQueryFilteredPlaylist.test.tsx"))).toBe(
      false,
    );
  });

  it("runs the current heavy jsdom coverage specs in dedicated single-file shards", () => {
    const rootDir = process.cwd();
    const dedicatedRuns = unitCoverageRuns.filter((runConfig) => Array.isArray(runConfig.files));

    expect(dedicatedRuns).toHaveLength(dedicatedJsdomCoverageFiles.length);
    expect(dedicatedRuns.map((runConfig) => getProjectFilesForRun(rootDir, runConfig))).toEqual(
      dedicatedJsdomCoverageFiles.map((filePath) => [filePath]),
    );
  });

  it("builds per-project vitest coverage arguments", () => {
    const rootDir = process.cwd();
    const plan = createCoveragePlan(rootDir);

    const jsdomArgs = getVitestCoverageArgs(
      rootDir,
      unitCoverageRuns[dedicatedJsdomCoverageFiles.length],
      plan.projectReports["jsdom-1"],
    );
    const dedicatedArgs = getVitestCoverageArgs(
      rootDir,
      unitCoverageRuns[0],
      plan.projectReports[unitCoverageRuns[0].reportKey],
    );
    const nodeArgs = getVitestCoverageArgs(rootDir, unitCoverageRuns.at(-1), plan.projectReports.node);
    const jsdomFiles = collectJsdomCoverageFiles(rootDir);
    const sharedJsdomFiles = collectSharedJsdomCoverageFiles(rootDir);
    const firstChunkFiles = getProjectFilesForRun(rootDir, unitCoverageRuns[dedicatedJsdomCoverageFiles.length]);

    expect(jsdomArgs).toContain(path.join(rootDir, "node_modules/vitest/vitest.mjs"));
    expect(jsdomArgs).toContain("--project");
    expect(jsdomArgs).toContain("unit-jsdom");
    expect(jsdomArgs).toContain(`--coverage.reportsDirectory=${plan.projectReports["jsdom-1"]}`);
    expect(jsdomArgs).toContain("--coverage.provider=v8");
    expect(jsdomArgs).toContain("--coverage.reporter=json");
    expect(jsdomArgs).toContain("--maxWorkers=1");
    expect(jsdomArgs).toContain("--minWorkers=1");
    expect(jsdomArgs).toContain("--no-file-parallelism");
    expect(dedicatedArgs).toContain(unitCoverageRuns[0].files[0]);
    expect(jsdomFiles.length).toBeGreaterThan(0);
    expect(sharedJsdomFiles.length).toBe(jsdomFiles.length - dedicatedJsdomCoverageFiles.length);
    expect(firstChunkFiles.length).toBeGreaterThan(0);
    expect(jsdomArgs).toContain(firstChunkFiles[0]);

    expect(nodeArgs).toContain("unit-node");
    expect(nodeArgs).toContain(`--coverage.reportsDirectory=${plan.projectReports.node}`);
    expect(nodeArgs.some((arg) => arg.endsWith(".test.ts") || arg.endsWith(".test.tsx"))).toBe(false);
  });

  it("builds nyc merge and report commands for the expected artifacts", () => {
    const rootDir = process.cwd();
    const plan = createCoveragePlan(rootDir);

    expect(getNycMergeArgs(plan.rawDir, plan.mergedCoverageFile)).toEqual([
      "nyc",
      "merge",
      plan.rawDir,
      plan.mergedCoverageFile,
    ]);

    expect(getNycReportArgs(plan.mergedDir, plan.coverageDir)).toEqual([
      "nyc",
      "report",
      "--temp-dir",
      plan.mergedDir,
      "--report-dir",
      plan.coverageDir,
      "--reporter=lcov",
      "--reporter=json",
      "--reporter=text-summary",
    ]);

    expect(plan.coverageArtifacts.lcov).toBe(path.join(rootDir, "coverage", "lcov.info"));
    expect(plan.coverageArtifacts.json).toBe(path.join(rootDir, "coverage", "coverage-final.json"));
  });

  it("creates the shard reports directory together with the Vitest temp directory", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "run-unit-coverage-"));
    const reportsDirectory = path.join(tempRoot, "jsdom-27");

    try {
      ensureReportsDirectory(reportsDirectory);

      expect(existsSync(reportsDirectory)).toBe(true);
      expect(existsSync(path.join(reportsDirectory, ".tmp"))).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("retries a failed coverage shard once before surfacing the exit code", () => {
    const spawn = vi.fn().mockReturnValueOnce({ status: 1 }).mockReturnValueOnce({ status: 0 });
    const onRetry = vi.fn();

    expect(() =>
      runOrThrow(process.execPath, ["coverage-run"], "unit-jsdom chunk 1/32 coverage", process.cwd(), {
        maxAttempts: coverageRunMaxAttempts,
        spawn,
        onRetry,
      }),
    ).not.toThrow();

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith({ attempt: 1, status: 1 });
  });

  it("wraps a coverage command with a keepalive loop for the reports temp directory", () => {
    const wrapped = wrapCommandWithDirectoryKeepalive(
      process.execPath,
      ["node_modules/vitest/vitest.mjs", "run"],
      "/tmp/c64commander/.cov-unit/jsdom-1/.tmp",
    );

    expect(wrapped.command).toBe("bash");
    expect(wrapped.args[0]).toBe("-lc");
    expect(wrapped.args[1]).toContain('keepalive() { while :; do mkdir -p "$keepalive_dir"; sleep 0.2; done; }');
    expect(wrapped.args[1]).toContain("/tmp/c64commander/.cov-unit/jsdom-1/.tmp");
    expect(wrapped.args[1]).toContain("node_modules/vitest/vitest.mjs");
  });
});
