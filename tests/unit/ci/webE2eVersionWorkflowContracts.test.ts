import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const readWorkflow = (name: string) => readFileSync(path.resolve(process.cwd(), ".github/workflows", name), "utf8");

const extractBlock = (workflow: string, startMarker: string, endMarker: string) => {
  const start = workflow.indexOf(startMarker);
  const end = workflow.indexOf(endMarker, start + startMarker.length);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return workflow.slice(start, end);
};

const expectStepBefore = (workflow: string, earlierStep: string, laterStep: string) => {
  const earlierIndex = workflow.indexOf(`- name: ${earlierStep}`);
  const laterIndex = workflow.indexOf(`- name: ${laterStep}`);

  expect(earlierIndex).toBeGreaterThanOrEqual(0);
  expect(laterIndex).toBeGreaterThanOrEqual(0);
  expect(earlierIndex).toBeLessThan(laterIndex);
};

describe("Web E2E version workflow contracts", () => {
  it("resolves source-side version metadata before skipped-build Playwright jobs", () => {
    const workflow = readWorkflow("android.yaml");
    const screenshotsJob = extractBlock(workflow, "  web-screenshots:", "  web-build-coverage:");
    const e2eJob = extractBlock(workflow, "  web-e2e:", "  web-coverage-merge:");

    expect(screenshotsJob).toContain("- name: Resolve Playwright version metadata");
    expect(screenshotsJob).toContain("run: bash scripts/resolve-version.sh");
    expect(e2eJob).toContain("- name: Resolve Playwright version metadata");
    expect(e2eJob).toContain("run: bash scripts/resolve-version.sh");
    expectStepBefore(
      e2eJob,
      "Resolve Playwright version metadata",
      "Run Playwright e2e tests (shard ${{ matrix.shard }}/${{ matrix.shardTotal }})",
    );
    expectStepBefore(screenshotsJob, "Resolve Playwright version metadata", "Run screenshot tests");
  });
});
