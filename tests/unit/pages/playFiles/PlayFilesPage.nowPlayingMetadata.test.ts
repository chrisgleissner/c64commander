import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testFilePath = fileURLToPath(import.meta.url);
const pageSource = readFileSync(resolve(dirname(testFilePath), "../../../../src/pages/PlayFilesPage.tsx"), "utf8");

const hookSource = readFileSync(
  resolve(dirname(testFilePath), "../../../../src/pages/playFiles/hooks/useLockScreenPlayback.ts"),
  "utf8",
);

describe("PlayFilesPage now-playing metadata (HARD27-040)", () => {
  it("publishes the tune the transport shows, not the raw playlist label alone", () => {
    expect(pageSource).toContain("const nowPlayingTitle = currentDisplay?.title ?? shownItem?.label ?? null;");
    expect(pageSource).toContain("const nowPlayingArtist = currentItemCredits.author;");
    expect(pageSource).toContain("title: nowPlayingTitle,");
    expect(pageSource).toContain("artist: nowPlayingArtist,");
    expect(pageSource).toContain("durationMs: shownNowPlaying.durationMs ?? null,");
  });

  it("QW-LS-04: hands the tune number and count to the lock-screen hook, which names the album", () => {
    expect(pageSource).toContain("tuneNumber: clampedSongNr,");
    expect(pageSource).toContain("tuneCount: knownSubsongCount,");
    expect(hookSource).toContain("{ title, artist, durationMs, album }");
  });

  it("QW-LS-03: the transport and the lock screen read one seek answer, resolveSeekToFraction", () => {
    expect(pageSource).toContain("const onSeekToFraction = resolveSeekToFraction({");
    expect(pageSource).toContain("onSeekToFraction={onSeekToFraction}");
    expect(pageSource).toMatch(/useLockScreenPlayback\(\{[^}]*\n {4}onSeekToFraction,\n {2}\}\);/);
    expect(pageSource).not.toContain('localEngineActive && currentItem?.category === "sid" && currentDurationMs');
  });

  it("republishes on every track change, including a repeat of the same tune", () => {
    const effect = hookSource.slice(
      hookSource.indexOf("void setBackgroundExecutionNowPlaying("),
      hookSource.indexOf("const publishPosition"),
    );
    expect(effect).toContain("}, [durationMs, artist, title, album, trackInstanceId]);");
  });
});
