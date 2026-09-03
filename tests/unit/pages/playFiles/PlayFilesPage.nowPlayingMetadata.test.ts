import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testFilePath = fileURLToPath(import.meta.url);
const pageSource = readFileSync(resolve(dirname(testFilePath), "../../../../src/pages/PlayFilesPage.tsx"), "utf8");

describe("PlayFilesPage now-playing metadata (HARD27-040)", () => {
  it("publishes the tune the transport shows, not the raw playlist label alone", () => {
    expect(pageSource).toContain("const nowPlayingTitle = currentDisplay?.title ?? currentItem?.label ?? null;");
    expect(pageSource).toContain("const nowPlayingArtist = currentItemCredits.author;");
    expect(pageSource).toContain(
      "{ title: nowPlayingTitle, artist: nowPlayingArtist, durationMs: currentDurationMs ?? null }",
    );
  });

  it("republishes on every track change, including a repeat of the same tune", () => {
    const effect = pageSource.slice(
      pageSource.indexOf("void setBackgroundExecutionNowPlaying("),
      pageSource.indexOf("// How much of the tune the on-device engine has rendered"),
    );
    expect(effect).toContain("}, [currentDurationMs, nowPlayingArtist, nowPlayingTitle, trackInstanceId]);");
  });
});
