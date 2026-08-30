import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

/**
 * The manual is typeset in its own workflow and attached to the release that
 * the android workflow creates on the same tag. The two are only connected by
 * a wait, so the length of that wait is a contract rather than a detail.
 */

const repoRoot = process.cwd();
const source = readFileSync(path.join(repoRoot, ".github/workflows/manual.yaml"), "utf8");
const workflow = yaml.load(source) as {
  on: { push?: { tags?: string[] }; workflow_dispatch?: unknown };
  jobs: Record<string, { "timeout-minutes"?: number }>;
};

const attempts = Number(source.match(/for attempt in \$\(seq 1 (\d+)\); do/)?.[1]);
const sleepSeconds = Number(source.match(/^\s*sleep (\d+)$/m)?.[1]);
const waitMinutes = (attempts * sleepSeconds) / 60;

describe("the manual workflow", () => {
  it("waits long enough for the android workflow to create the release", () => {
    expect(attempts).toBeGreaterThan(0);
    expect(sleepSeconds).toBeGreaterThan(0);

    // Tag builds of android.yaml ran 35 minutes end to end for 0.10.0,
    // 0.10.0-rc2 and 0.10.0-rc3, and the job that creates the release sits near
    // the end of that chain. A shorter wait than the build simply drops the
    // manual from the release, with the workflow reporting the failure long
    // after anyone is watching.
    expect(waitMinutes, "the wait is shorter than a tag build takes").toBeGreaterThanOrEqual(60);
  });

  it("allows the job to run for longer than it is prepared to wait", () => {
    // Otherwise the runner kills the job mid-wait and the wait's own error
    // message never appears.
    const timeout = workflow.jobs.manual["timeout-minutes"] ?? 360;
    expect(timeout).toBeGreaterThan(waitMinutes);
  });

  it("runs on the tags that produce a release", () => {
    const tags = workflow.on.push?.tags ?? [];
    expect(tags).toContain("[0-9]+.[0-9]+.[0-9]+");
    expect(tags, "release candidates are published too").toContain("[0-9]+.[0-9]+.[0-9]+-rc[0-9]+");
  });

  it("can be run on demand", () => {
    expect(workflow.on).toHaveProperty("workflow_dispatch");
  });

  it("attaches the manual only after checking it is a whole PDF", () => {
    const checkIndex = source.indexOf("Check the typeset output");
    const attachIndex = source.indexOf("Attach the manual to the release");
    expect(checkIndex).toBeGreaterThan(-1);
    expect(attachIndex).toBeGreaterThan(checkIndex);

    expect(source).toContain("head -c 5 \"$PDF\" | grep -q '%PDF-'");
    expect(source).toContain('pdffonts "$PDF" | grep -q IBMPlex');
  });
});
