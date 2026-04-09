import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadPerfIterationArtifact } from "../../../scripts/hvsc/webPerfArtifacts.mjs";

const tempDirs: string[] = [];

const createTempRoot = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "web-perf-artifacts-"));
  tempDirs.push(root);
  return root;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
  }
});

describe("webPerfArtifacts", () => {
  it("loads a partial iteration artifact and annotates a failing runner exit code", () => {
    const root = createTempRoot();
    const rawFile = path.join(root, "loop-01.json");
    writeFileSync(
      rawFile,
      JSON.stringify({
        suite: "hvsc-perf-scenarios-s1-s11",
        scenarios: [{ scenario: "S3-enter-hvsc-root", wallClockMs: 512, timings: [] }],
      }),
    );

    const artifact = loadPerfIterationArtifact({ rawFile, exitStatus: 1 });

    expect(artifact).toEqual(
      expect.objectContaining({
        suite: "hvsc-perf-scenarios-s1-s11",
        runnerExitCode: 1,
        runnerStatus: "failed",
        scenarios: [expect.objectContaining({ scenario: "S3-enter-hvsc-root" })],
      }),
    );
  });

  it("returns null when the runner did not produce a raw artifact file", () => {
    const root = createTempRoot();
    const artifact = loadPerfIterationArtifact({ rawFile: path.join(root, "missing.json"), exitStatus: 1 });
    expect(artifact).toBeNull();
  });
});
