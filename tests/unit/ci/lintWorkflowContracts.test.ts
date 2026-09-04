import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

/**
 * `npm run lint` chains thirteen checks and was run by no workflow, so main
 * failed lint:display-profiles with every check green.
 */

const repoRoot = process.cwd();
const source = readFileSync(path.join(repoRoot, ".github/workflows/android.yaml"), "utf8");
const workflow = yaml.load(source) as {
  jobs: Record<string, { steps?: { env?: Record<string, string>; run?: string }[] }>;
};
const scripts = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts as Record<string, string>;
const lintScript = scripts.lint;

describe("the lint gate", () => {
  it("is run by a workflow at all", () => {
    const runners = Object.entries(workflow.jobs).filter(([, job]) =>
      (job.steps ?? []).some((step) => /(^|\s|&&)\s*npm run lint\s*$/.test((step.run ?? "").trim())),
    );
    expect(
      runners.map(([name]) => name),
      "no job runs `npm run lint`",
    ).not.toEqual([]);
  });

  it("blocks rather than reports", () => {
    const lintJob = source.slice(source.indexOf("  lint:"), source.indexOf("  notices:"));
    expect(lintJob).toContain("npm run lint");
    // continue-on-error reports a masked step as successful in this repository's
    // own experience, so an advisory gate here would be indistinguishable from none.
    expect(lintJob).not.toContain("continue-on-error");
  });

  it("generates variant metadata first, which several of the checks read", () => {
    const lintJob = source.slice(source.indexOf("  lint:"), source.indexOf("  notices:"));
    expect(lintJob.indexOf("run: npm run variant:generate")).toBeGreaterThan(-1);
    expect(lintJob.indexOf("run: npm run variant:generate")).toBeLessThan(lintJob.indexOf("run: npm run lint"));
  });

  it("still covers the checks that have caught real drift", () => {
    for (const check of [
      "lint:display-profiles",
      "lint:font-size-floors",
      "lint:stale-names",
      "variant:check",
      "feature-flags:check",
      "palettes:check",
      "search:check",
    ]) {
      expect(lintScript, `npm run lint no longer runs ${check}`).toContain(check);
    }
  });
});

/**
 * `npm run lint` runs the bundle budget with `--skip-if-missing`, and no job that runs
 * `npm run lint` builds the app, so the gzipped chunk budget reported "skipping" and
 * passed on every CI run until a job that has a dist ran it directly.
 */
describe("the bundle budget gate", () => {
  const measuringJobs = Object.entries(workflow.jobs).filter(([, job]) => {
    const steps = job.steps ?? [];
    const buildIndex = steps.findIndex((step) => /npm run build\b/.test(step.run ?? ""));
    const checkIndex = steps.findIndex((step) =>
      /node scripts\/check-bundle-budgets\.mjs\s*$/.test((step.run ?? "").trim()),
    );
    return buildIndex > -1 && checkIndex > buildIndex;
  });

  it("is measured by a job that has already built the app", () => {
    expect(
      measuringJobs.map(([name]) => name),
      "no job runs check-bundle-budgets.mjs after building, so the budget measures nothing",
    ).not.toEqual([]);
  });

  it("measures a build that carries no coverage instrumentation", () => {
    for (const [name, job] of measuringJobs) {
      const buildStep = (job.steps ?? []).find((step) => /npm run build\b/.test(step.run ?? ""));
      expect(buildStep?.run, `${name} builds with coverage, which inflates every chunk`).not.toContain("VITE_COVERAGE");
      expect(buildStep?.env?.VITE_COVERAGE, `${name} builds with coverage, which inflates every chunk`).toBeUndefined();
    }
  });

  it("keeps the skip only on the lint entry point, which has no build of its own", () => {
    expect(scripts["lint:bundle-budgets"]).toContain("--skip-if-missing");
    expect(lintScript).toContain("lint:bundle-budgets");
  });
});
