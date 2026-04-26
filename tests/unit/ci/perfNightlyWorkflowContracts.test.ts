import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const readWorkflow = (name: string) => readFileSync(path.resolve(process.cwd(), ".github/workflows", name), "utf8");

describe("perf-nightly workflow contracts", () => {
  it("prepares real HVSC archives into the stable cache before nightly perf runs", () => {
    const workflow = readWorkflow("perf-nightly.yaml");
    expect(workflow).toContain("path: ~/.cache/c64commander/hvsc");
    expect(workflow).toContain("key: hvsc-perf-archives-${{ runner.os }}-hvsc84-v1");
    expect(workflow).toContain("- name: Prepare HVSC perf archives");
    expect(workflow).toContain(
      'prepare-perf-archives.mjs --out=ci-artifacts/hvsc-performance/archive-preparation.json --write-env="$GITHUB_ENV"',
    );
    expect(workflow).toContain("- name: Resolve perf profile");
    expect(workflow).toContain('echo "HVSC_PERF_PROFILE=${{ inputs.profile }}" >> "$GITHUB_ENV"');
    expect(workflow).toContain('echo "HVSC_PERF_PROFILE=nightly" >> "$GITHUB_ENV"');
    expect(workflow).toContain("- name: Run HVSC node data-path perf suite");
    expect(workflow).toContain("- name: Collect HVSC full scenario summary");
    expect(workflow).toContain("- name: Collect HVSC secondary summary");
  });

  it("exposes a manual workflow profile selector and always uploads perf artifacts", () => {
    const workflow = readWorkflow("perf-nightly.yaml");
    expect(workflow).toContain("default: manual-extended");
    expect(workflow).toContain("- manual-extended");
    expect(workflow).toContain("- smoke");
    expect(workflow).toContain("if: env.HVSC_PERF_PROFILE != 'smoke'");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("name: hvsc-perf-${{ env.HVSC_PERF_PROFILE }}");
  });
});
