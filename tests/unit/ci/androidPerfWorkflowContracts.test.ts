import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const readWorkflow = (name: string) => readFileSync(path.resolve(process.cwd(), ".github/workflows", name), "utf8");

describe("Android perf workflow contracts", () => {
  it("asserts quick secondary perf budgets against the produced smoke summary", () => {
    const workflow = readWorkflow("android.yaml");

    expect(workflow).toContain("- name: Collect quick HVSC secondary summary");
    expect(workflow).toContain("run: npm run test:perf:secondary:quick");
    expect(workflow).toContain("- name: Apply optional perf budgets");
    expect(workflow).toContain("HVSC_PERF_SUMMARY_FILE: ci-artifacts/hvsc-performance/web/web-secondary-smoke.json");
    expect(workflow).toContain("run: npm run test:perf:assert:web");
  });

  /**
   * The perf scenarios drive a preview server through Playwright, whose webServer has a 120 s
   * timeout. With no dist present that command builds the app first, so the build raced the
   * timeout — and lost on a slow runner, failing the whole workflow on a commit that changed
   * only a CI script. The job builds once up front instead, and both perf steps preview that
   * dist rather than building their own.
   */
  it("builds the web app once before the perf scenarios, so no build races the webServer timeout", () => {
    const workflow = readWorkflow("android.yaml");

    const buildStep = workflow.indexOf("- name: Build the web app for the perf scenarios");
    const quickStep = workflow.indexOf("- name: Collect quick HVSC full scenario summary");
    const secondaryStep = workflow.indexOf("- name: Collect quick HVSC secondary summary");

    expect(buildStep).toBeGreaterThan(-1);
    expect(buildStep).toBeLessThan(quickStep);

    // The build has to carry the same probe flag playwright.config.ts bakes into the build it
    // would otherwise run, or the scenarios measure a different bundle from the one they need.
    expect(workflow.slice(buildStep, quickStep)).toContain('VITE_ENABLE_TEST_PROBES: "1"');

    // Both scenario steps must reuse that dist rather than rebuilding inside the timeout.
    for (const step of [quickStep, secondaryStep]) {
      const stepBody = workflow.slice(step, step + 260);
      expect(stepBody).toContain('PLAYWRIGHT_SKIP_BUILD: "1"');
    }
  });
});
