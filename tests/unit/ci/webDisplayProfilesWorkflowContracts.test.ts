import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const readWorkflow = (name: string) => readFileSync(path.resolve(process.cwd(), ".github/workflows", name), "utf8");
const readPlaywrightSpec = (name: string) => readFileSync(path.resolve(process.cwd(), "playwright", name), "utf8");
const extractStepBlock = (workflow: string, stepName: string) => {
  const stepHeader = `- name: ${stepName}`;
  const stepStart = workflow.indexOf(stepHeader);
  expect(stepStart).toBeGreaterThanOrEqual(0);

  const nextStepStart = workflow.indexOf("\n      - name:", stepStart + stepHeader.length);
  return workflow.slice(stepStart, nextStepStart === -1 ? undefined : nextStepStart);
};

describe("web display profile zoom proof contracts", () => {
  it("routes the browser-zoom diagnostics proof to the dedicated web Playwright lane", () => {
    const workflow = readWorkflow("android.yaml");
    const screenshotStep = extractStepBlock(workflow, "Run screenshot tests");
    const webProofStep = extractStepBlock(workflow, "Run web display profile zoom proof");

    expect(screenshotStep).toContain('PLAYWRIGHT_SKIP_BUILD: "1"');
    expect(screenshotStep).toContain("npm run screenshots");
    expect(screenshotStep.match(/\n        run: \|/g)).toHaveLength(1);

    expect(webProofStep).toContain('PLAYWRIGHT_DEVICES: "web"');
    expect(webProofStep).toContain('SOURCE_DATE_EPOCH: "0"');
    expect(webProofStep).toContain(
      'npx playwright test playwright/displayProfiles.spec.ts -g "@web-platform" --project=web',
    );
    expect(webProofStep.match(/\n        run: \|/g)).toHaveLength(1);
  });

  it("marks the browser-zoom diagnostics proof as web-platform only so phone shards do not skip it", () => {
    const spec = readPlaywrightSpec("displayProfiles.spec.ts");
    expect(spec).toContain("compact diagnostics CTA layout remains reachable under browser zoom on web @web-platform");
    expect(spec).toContain('if (testInfo.project.name !== "web")');
  });
});
