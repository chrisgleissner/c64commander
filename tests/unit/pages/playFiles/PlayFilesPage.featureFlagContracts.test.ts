import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testFilePath = fileURLToPath(import.meta.url);
const playFilesPagePath = resolve(dirname(testFilePath), "../../../../src/pages/PlayFilesPage.tsx");
const playFilesPageSource = readFileSync(playFilesPagePath, "utf8");

describe("PlayFilesPage feature-flag contracts", () => {
  it("derives background execution from the feature-flag policy before touching the native bridge", () => {
    expect(playFilesPageSource).toContain(
      "const backgroundExecutionEnabled = isBackgroundExecutionEnabled(featureFlags);",
    );
    expect(playFilesPageSource).toContain("shouldStartBackgroundExecution({");
    expect(playFilesPageSource).toContain("shouldStopBackgroundExecution({");
    expect(playFilesPageSource).toContain("shouldSyncBackgroundExecutionDueAt(");
  });

  it("routes HVSC source and preparation behavior through the tightened HVSC feature policy", () => {
    expect(playFilesPageSource).toContain("shouldIncludeHvscSource(featureFlags, hvscAvailable)");
    expect(playFilesPageSource).toContain(
      "shouldOpenHvscPreparation(featureFlags, source.type, hvsc.hvscPreparationState)",
    );
    expect(playFilesPageSource).toContain(
      "shouldCancelHvscLifecycleOnDisable(hvscControlsEnabled, hvsc.hvscPreparationState)",
    );
  });
});
