import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testFilePath = fileURLToPath(import.meta.url);
const pagePath = resolve(dirname(testFilePath), "../../../../src/pages/PlayFilesPage.tsx");
const hookPath = resolve(dirname(testFilePath), "../../../../src/pages/playFiles/hooks/useDurationOverride.ts");
const pageSource = readFileSync(pagePath, "utf8");
const hookSource = readFileSync(hookPath, "utf8");

describe("PlayFilesPage duration contracts", () => {
  it("does not rewrite the full playlist on every duration input tick", () => {
    expect(hookSource).not.toContain("applyDurationOverrideToPlaylist(prev, nextDurationMs)");
    expect(hookSource.match(/setPendingDurationOverrideMs\(nextDurationMs\)/g)).toHaveLength(2);
  });

  it("persists accepted duration overrides through a shared commit path", () => {
    expect(hookSource.match(/applyDurationOverrideToPlaylist\(prev, durationOverrideMs\)/g)).toHaveLength(1);
    expect(pageSource).toContain("onDurationSliderCommit={handleDurationSliderCommit}");
    expect(hookSource).toContain("persistDurationOverride(debouncedDurationOverrideMs)");
  });

  it("clears pending duration commits after immediate persist to avoid duplicate debounced commits", () => {
    expect(hookSource.match(/setPendingDurationOverrideMs\(undefined\)/g)).toHaveLength(2);

    const sliderCommit = hookSource.slice(
      hookSource.indexOf("const handleDurationSliderCommit"),
      hookSource.indexOf("const handleDurationInputChange"),
    );
    const inputBlur = hookSource.slice(hookSource.indexOf("const handleDurationInputBlur"));

    expect(sliderCommit).toMatch(
      /persistDurationOverride\(nextDurationMs\);\s*setPendingDurationOverrideMs\(undefined\);/,
    );
    expect(sliderCommit).not.toContain("setPendingDurationOverrideMs(nextDurationMs)");
    expect(inputBlur).toMatch(
      /persistDurationOverride\(nextDurationMs\);\s*setPendingDurationOverrideMs\(undefined\);/,
    );
    expect(inputBlur).not.toContain("setPendingDurationOverrideMs(nextDurationMs)");
  });
});
