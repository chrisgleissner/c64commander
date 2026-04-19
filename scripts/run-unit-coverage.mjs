import { spawnSync } from "node:child_process";
import { cpSync, existsSync, globSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const jsdomChunkCount = 32;

export const dedicatedJsdomCoverageFiles = [
  "tests/unit/components/diagnostics/GlobalDiagnosticsOverlay.test.tsx",
  "tests/unit/hooks/useLightingStudio.test.tsx",
  "tests/unit/playFiles/useQueryFilteredPlaylist.scale.test.tsx",
  "tests/unit/playFiles/useQueryFilteredPlaylist.test.tsx",
];

export const unitCoverageRuns = [
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

export function collectSharedJsdomCoverageFiles(rootDir) {
  const dedicatedFiles = new Set(dedicatedJsdomCoverageFiles);
  return collectJsdomCoverageFiles(rootDir).filter((file) => !dedicatedFiles.has(file));
}

export function getProjectFilesForRun(rootDir, runConfig) {
  if (runConfig.projectName !== "unit-jsdom") {
    return [];
  }

  if (Array.isArray(runConfig.files) && runConfig.files.length > 0) {
    return runConfig.files;
  }

  const chunks = splitFilesIntoChunks(collectSharedJsdomCoverageFiles(rootDir), runConfig.chunkCount ?? 1);
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
    "--coverage.provider=v8",
    `--coverage.reportsDirectory=${reportsDirectory}`,
    "--coverage.reporter=json",
    "--coverage.thresholds.statements=0",
    "--coverage.thresholds.branches=0",
    "--coverage.thresholds.functions=0",
    "--coverage.thresholds.lines=0",
    "--maxWorkers=1",
    "--minWorkers=1",
    "--no-file-parallelism",
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

export function ensureReportsDirectory(reportsDirectory) {
  mkdirSync(reportsDirectory, { recursive: true });
  mkdirSync(path.join(reportsDirectory, ".tmp"), { recursive: true });
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
    ensureReportsDirectory(reportsDirectory);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runUnitCoverage();
}
