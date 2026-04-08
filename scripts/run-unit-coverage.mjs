import { spawnSync } from "node:child_process";
import { cpSync, existsSync, globSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const unitCoverageRuns = [
  { projectName: "unit-jsdom", reportKey: "jsdom-1", chunkIndex: 0, chunkCount: 12 },
  { projectName: "unit-jsdom", reportKey: "jsdom-2", chunkIndex: 1, chunkCount: 12 },
  { projectName: "unit-jsdom", reportKey: "jsdom-3", chunkIndex: 2, chunkCount: 12 },
  { projectName: "unit-jsdom", reportKey: "jsdom-4", chunkIndex: 3, chunkCount: 12 },
  { projectName: "unit-jsdom", reportKey: "jsdom-5", chunkIndex: 4, chunkCount: 12 },
  { projectName: "unit-jsdom", reportKey: "jsdom-6", chunkIndex: 5, chunkCount: 12 },
  { projectName: "unit-jsdom", reportKey: "jsdom-7", chunkIndex: 6, chunkCount: 12 },
  { projectName: "unit-jsdom", reportKey: "jsdom-8", chunkIndex: 7, chunkCount: 12 },
  { projectName: "unit-jsdom", reportKey: "jsdom-9", chunkIndex: 8, chunkCount: 12 },
  { projectName: "unit-jsdom", reportKey: "jsdom-10", chunkIndex: 9, chunkCount: 12 },
  { projectName: "unit-jsdom", reportKey: "jsdom-11", chunkIndex: 10, chunkCount: 12 },
  { projectName: "unit-jsdom", reportKey: "jsdom-12", chunkIndex: 11, chunkCount: 12 },
  { projectName: "unit-node", reportKey: "node" },
];

const jsdomIncludeGlobs = ["tests/unit/**/*.{test,spec}.{ts,tsx}", "src/**/*.{test,spec}.{ts,tsx}"];

const nodeTestGlobs = [
  "tests/contract/**/*.test.ts",
  "tests/unit/tracing/traceFormatter.test.ts",
  "tests/unit/tracing/traceIds.test.ts",
  "tests/unit/tracing/traceSession.test.ts",
  "tests/unit/tracing/traceContext.test.ts",
  "tests/unit/tracing/redaction.test.ts",
  "tests/unit/tracing/effectCorrelation.test.ts",
  "tests/unit/tracing/actionTrace.test.ts",
  "tests/unit/tracing/traceActionContextStore.test.ts",
  "tests/unit/traceComparison*.test.ts",
  "tests/unit/diagnostics/**",
  "tests/unit/web/**",
  "tests/unit/sid/**",
  "tests/unit/disks/**",
  "tests/unit/fileTypes.test.ts",
  "tests/unit/fileLibraryUtils.test.ts",
  "tests/unit/playlistTotals.test.ts",
  "tests/unit/sidUtils.test.ts",
  "tests/unit/sidStatus.test.ts",
  "tests/unit/sidVolumeControl.test.ts",
  "tests/unit/audioMixerSolo.test.ts",
  "tests/unit/diskTypes.test.ts",
  "tests/unit/diskFirstPrg.test.ts",
  "tests/unit/playbackClock.test.ts",
  "tests/unit/lib/playback/**",
  "tests/unit/lib/disks/**",
  "tests/unit/lib/buildInfo.test.ts",
  "tests/unit/config/audioMixerOptions.test.ts",
];

export function createCoveragePlan(rootDir = process.cwd()) {
  const covUnitDir = path.join(rootDir, ".cov-unit");
  const rawDir = path.join(covUnitDir, "raw");
  const mergedDir = path.join(covUnitDir, "merged");
  const coverageDir = path.join(rootDir, "coverage");
  const projectReports = Object.fromEntries(
    unitCoverageRuns.map(({ reportKey }) => [reportKey, path.join(covUnitDir, reportKey)]),
  );

  return {
    rootDir,
    covUnitDir,
    rawDir,
    mergedDir,
    coverageDir,
    projectReports,
    mergedCoverageFile: path.join(mergedDir, "coverage-final.json"),
    coverageArtifacts: {
      lcov: path.join(coverageDir, "lcov.info"),
      json: path.join(coverageDir, "coverage-final.json"),
    },
  };
}

export function splitFilesIntoChunks(files, chunkCount) {
  return Array.from({ length: chunkCount }, (_value, chunkIndex) =>
    files.filter((_file, fileIndex) => fileIndex % chunkCount === chunkIndex),
  );
}

export function collectJsdomCoverageFiles(rootDir) {
  const includedFiles = jsdomIncludeGlobs.flatMap((pattern) => globSync(pattern, { cwd: rootDir })).sort();
  const excludedFiles = new Set(nodeTestGlobs.flatMap((pattern) => globSync(pattern, { cwd: rootDir })));
  return includedFiles.filter((file) => !excludedFiles.has(file));
}

export function getProjectFilesForRun(rootDir, runConfig) {
  if (runConfig.projectName !== "unit-jsdom") {
    return [];
  }

  const chunks = splitFilesIntoChunks(collectJsdomCoverageFiles(rootDir), runConfig.chunkCount ?? 1);
  return chunks[runConfig.chunkIndex ?? 0] ?? [];
}

export function getVitestCoverageArgs(rootDir, runConfig, reportsDirectory) {
  const args = [
    "--max-old-space-size=6144",
    path.join(rootDir, "node_modules/vitest/vitest.mjs"),
    "run",
    "--project",
    runConfig.projectName,
    "--coverage",
    "--coverage.provider=istanbul",
    `--coverage.reportsDirectory=${reportsDirectory}`,
    "--coverage.reporter=json",
    "--coverage.thresholds.statements=0",
    "--coverage.thresholds.branches=0",
    "--coverage.thresholds.functions=0",
    "--coverage.thresholds.lines=0",
    "--reporter=dot",
  ];

  const projectFiles = getProjectFilesForRun(rootDir, runConfig);
  if (projectFiles.length > 0) {
    args.push(...projectFiles);
  }

  return args;
}

export function getNycMergeArgs(rawDir, mergedCoverageFile) {
  return ["nyc", "merge", rawDir, mergedCoverageFile];
}

export function getNycReportArgs(mergedDir, coverageDir) {
  return [
    "nyc",
    "report",
    "--temp-dir",
    mergedDir,
    "--report-dir",
    coverageDir,
    "--reporter=lcov",
    "--reporter=json",
    "--reporter=text-summary",
  ];
}

function runOrThrow(command, args, label, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });

  if (result.status === 0) {
    return;
  }

  if (typeof result.status === "number") {
    process.exit(result.status);
  }

  throw new Error(`${label} failed to start`);
}

function ensureFileExists(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`Expected ${label} at ${filePath}`);
  }
}

export function runUnitCoverage(rootDir = process.cwd()) {
  const plan = createCoveragePlan(rootDir);

  for (const target of [plan.coverageDir, plan.covUnitDir, path.join(rootDir, ".nyc_output")]) {
    rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }

  mkdirSync(plan.rawDir, { recursive: true });
  mkdirSync(plan.mergedDir, { recursive: true });

  for (const runConfig of unitCoverageRuns) {
    const { projectName, reportKey } = runConfig;
    const reportsDirectory = plan.projectReports[reportKey];
    mkdirSync(reportsDirectory, { recursive: true });
    runOrThrow(
      process.execPath,
      getVitestCoverageArgs(rootDir, runConfig, reportsDirectory),
      `${projectName}${typeof runConfig.chunkIndex === "number" ? ` chunk ${runConfig.chunkIndex + 1}/${runConfig.chunkCount}` : ""} coverage`,
      rootDir,
    );

    const coverageJson = path.join(reportsDirectory, "coverage-final.json");
    ensureFileExists(
      coverageJson,
      `${projectName}${typeof runConfig.chunkIndex === "number" ? ` chunk ${runConfig.chunkIndex + 1}/${runConfig.chunkCount}` : ""} coverage JSON`,
    );
    cpSync(coverageJson, path.join(plan.rawDir, `${reportKey}.json`));
  }

  runOrThrow("npx", getNycMergeArgs(plan.rawDir, plan.mergedCoverageFile), "coverage merge", rootDir);
  ensureFileExists(plan.mergedCoverageFile, "merged coverage JSON");

  mkdirSync(plan.coverageDir, { recursive: true });
  runOrThrow("npx", getNycReportArgs(plan.mergedDir, plan.coverageDir), "coverage report", rootDir);

  ensureFileExists(plan.coverageArtifacts.lcov, "lcov report");
  ensureFileExists(plan.coverageArtifacts.json, "JSON coverage report");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runUnitCoverage();
}
