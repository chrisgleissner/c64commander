import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const launchFlowPath = path.resolve(process.cwd(), ".maestro/subflows/launch-and-wait.yaml");

describe("launch-and-wait Maestro subflow", () => {
  it("waits for the Home tab instead of the below-fold Quick Config section", () => {
    const flow = readFileSync(launchFlowPath, "utf8");

    expect(flow).toContain('visible: "Home"');
    expect(flow).not.toContain('visible: "Quick Config"');
  });

  // A run that has not been given a device host - a fresh install with no smoke-mode
  // config, which is what scripts/smoke-no-google-services.sh does - reaches the startup
  // device discovery dialog. It is modal, so leaving it up makes every later tap on the
  // tab bar hit its backdrop instead of the tab.
  it("dismisses the startup device discovery dialog before waiting for Home", () => {
    const flow = readFileSync(launchFlowPath, "utf8");

    expect(flow).toContain('text: "Not now"');
    expect(flow.indexOf('text: "Not now"')).toBeLessThan(flow.indexOf('visible: "Home"'));
  });

  it("dismisses the delayed first-run tour before asserting the Home search control", () => {
    const flow = readFileSync(launchFlowPath, "utf8");
    const searchAssertion = flow.indexOf('assertVisible: "Search the app"');
    const searchReadinessRetry = flow.lastIndexOf("- retry:", searchAssertion);
    const tourDismissal = flow.lastIndexOf("runFlow: dismiss-tour.yaml", searchAssertion);

    expect(searchAssertion).toBeGreaterThan(-1);
    expect(searchReadinessRetry).toBeGreaterThan(flow.indexOf('visible: "Home"'));
    expect(tourDismissal).toBeGreaterThan(searchReadinessRetry);
    expect(tourDismissal).toBeLessThan(searchAssertion);
  });
});
