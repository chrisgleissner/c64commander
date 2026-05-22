import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testFilePath = fileURLToPath(import.meta.url);
const pagePath = resolve(dirname(testFilePath), "../../../../src/pages/PlayFilesPage.tsx");
const pageSource = readFileSync(pagePath, "utf8");

describe("PlayFilesPage duration contracts", () => {
  it("does not rewrite the full playlist on every duration input tick", () => {
    expect(pageSource).not.toContain("applyDurationOverrideToPlaylist(prev, nextDurationMs)");
    expect(pageSource.match(/setPendingDurationOverrideMs\(nextDurationMs\)/g)).toHaveLength(4);
  });

  it("persists accepted duration overrides through a shared commit path", () => {
    expect(pageSource.match(/applyDurationOverrideToPlaylist\(prev, durationOverrideMs\)/g)).toHaveLength(1);
    expect(pageSource).toContain("onDurationSliderCommit={handleDurationSliderCommit}");
    expect(pageSource).toContain("persistDurationOverride(debouncedDurationOverrideMs)");
  });
});
