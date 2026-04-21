import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

const makeTempDir = () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "collect-web-perf-"));
  tempDirs.push(tempDir);
  return tempDir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("collect-web-perf", () => {
  it("returns success for unsupported real-archive scenario observation runs", () => {
    const tempDir = makeTempDir();
    const outFile = path.join(tempDir, "web-full-nightly.json");
    const baselineArchive = path.join(tempDir, "HVSC_84-all-of-them.7z");
    const updateArchive = path.join(tempDir, "HVSC_Update_84.7z");

    writeFileSync(baselineArchive, "fixture");
    writeFileSync(updateArchive, "fixture");

    const result = spawnSync(
      process.execPath,
      ["scripts/hvsc/collect-web-perf.mjs", "--suite=scenarios", `--out=${outFile}`],
      {
        cwd: path.resolve(__dirname, "../../.."),
        env: {
          ...process.env,
          HVSC_PERF_USE_REAL_ARCHIVES: "1",
          HVSC_PERF_BASELINE_ARCHIVE: baselineArchive,
          HVSC_PERF_UPDATE_ARCHIVE: updateArchive,
        },
      },
    );

    expect(result.status).toBe(1);

    const summary = JSON.parse(readFileSync(outFile, "utf8"));
    expect(summary).toEqual(
      expect.objectContaining({
        status: "unsupported",
        runnerExitCode: 1,
        mode: "hybrid-real-download-fixture-browse-web",
        evidenceClass: "hybrid",
      }),
    );
    expect(summary.scenarioCoverage).toEqual([]);
  });
});
