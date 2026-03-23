import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const launchFlowPath = path.resolve(process.cwd(), ".maestro/subflows/launch-and-wait.yaml");

describe("launch-and-wait Maestro subflow", () => {
  it("waits for the Home header subtitle instead of the below-fold Quick Config section", () => {
    const flow = readFileSync(launchFlowPath, "utf8");

    expect(flow).toContain('visible: "C64 Commander"');
    expect(flow).not.toContain('visible: "Quick Config"');
  });
});
