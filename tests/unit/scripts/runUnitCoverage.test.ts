import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  collectJsdomCoverageFiles,
  createCoveragePlan,
  getNycMergeArgs,
  getProjectFilesForRun,
  getNycReportArgs,
  getVitestCoverageArgs,
  jsdomChunkCount,
  splitFilesIntoChunks,
  unitCoverageRuns,
} from "../../../scripts/run-unit-coverage.mjs";

describe("run-unit-coverage", () => {
  it("locks unit coverage to split jsdom shards and node project runs", () => {
    expect(jsdomChunkCount).toBe(24);
    expect(unitCoverageRuns).toEqual([
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

  it("builds per-project vitest coverage arguments", () => {
    const rootDir = process.cwd();
    const plan = createCoveragePlan(rootDir);

    const jsdomArgs = getVitestCoverageArgs(rootDir, unitCoverageRuns[0], plan.projectReports["jsdom-1"]);
    const nodeArgs = getVitestCoverageArgs(rootDir, unitCoverageRuns.at(-1), plan.projectReports.node);
    const jsdomFiles = collectJsdomCoverageFiles(rootDir);
    const firstChunkFiles = getProjectFilesForRun(rootDir, unitCoverageRuns[0]);

    expect(jsdomArgs).toContain(path.join(rootDir, "node_modules/vitest/vitest.mjs"));
    expect(jsdomArgs).toContain("--project");
    expect(jsdomArgs).toContain("unit-jsdom");
    expect(jsdomArgs).toContain(`--coverage.reportsDirectory=${plan.projectReports["jsdom-1"]}`);
    expect(jsdomArgs).toContain("--coverage.provider=istanbul");
    expect(jsdomArgs).toContain("--coverage.reporter=json");
    expect(jsdomArgs).toContain("--maxWorkers=1");
    expect(jsdomArgs).toContain("--minWorkers=1");
    expect(jsdomArgs).toContain("--no-file-parallelism");
    expect(jsdomFiles.length).toBeGreaterThan(0);
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
});
