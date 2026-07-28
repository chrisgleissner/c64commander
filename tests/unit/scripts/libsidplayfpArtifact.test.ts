import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The sync test next door proves the *right bytes* were deployed. These prove the
 * bytes are the right *engines* and still speak the API the player expects.
 *
 * That gap is not theoretical. The engine spent months shipping as SIDLite while
 * everything believed it was reSIDfp, because a lockfile can tell you a package
 * did not change but not what is inside it. A version bump is exactly what can
 * silently break `SidAudioEngine`'s call surface.
 *
 * Skipped when the artifact is absent: it is git-ignored and populated by
 * `prebuild`, so a plain `npm test` on a fresh clone has not synced it yet.
 */
const ENGINE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "public/wasm/libsidplayfp/dist",
);

const FIXTURE_SID = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "tests/fixtures/local-source-assets/demo.sid",
);

const artifactPresent = existsSync(path.join(ENGINE_DIR, "libsidplayfp.wasm"));

describe.skipIf(!artifactPresent)("fetched libsidplayfp artifact", () => {
  /**
   * Each engine must report its own identity. `getEngineName()` reads a symbol
   * compiled into the binary, so this distinguishes the two artifacts in a way
   * their file paths cannot: it is the check that would have caught the original
   * defect on day one.
   */
  it.each([
    ["residfp", "WasmReSIDfp"],
    ["sidlite", "WasmSIDLite"],
  ])(
    "loads %s and reports itself as %s",
    async (engine, expectedName) => {
      const { SidAudioEngine } = await import(path.join(ENGINE_DIR, "index.js"));
      const player = new SidAudioEngine({ engine });
      const sid = new Uint8Array(await fs.readFile(FIXTURE_SID));

      await player.loadSidBuffer(sid, 0);

      expect(await player.getEngineName()).toBe(expectedName);
      expect(player.getSampleRate()).toBe(44100);
      expect(player.getChannels()).toBe(2);
      expect(player.getTuneInfo().songs).toBeGreaterThan(0);

      // The surface localSid.worker.ts drives. Rendering nothing, or silence, is a
      // broken engine that still loads — so assert samples arrive and carry signal.
      const pcm = await player.renderSeconds(1);
      expect(pcm.length).toBe(44100 * 2);
      expect(pcm.some((sample: number) => sample !== 0)).toBe(true);

      await player.seekSeconds(5);
      expect((await player.renderSeconds(1)).length).toBe(44100 * 2);
    },
    30_000,
  );
});
