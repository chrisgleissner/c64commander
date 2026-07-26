import { describe, expect, it } from "vitest";

import { RenderedTuneCache, DEFAULT_MAX_TUNES } from "@/lib/playback/renderedTuneCache";

/**
 * Rendered audio is big — 48 kHz stereo 16-bit is 192 KB per second, so a
 * three-minute tune is ~35 MB. The cache therefore has to be bounded by bytes
 * as well as by count, or one long tune turns a three-entry window into an
 * out-of-memory crash.
 */
const tune = (seconds: number) => ({
  pcm: new Int16Array(48000 * 2 * seconds),
  sampleRate: 48000,
  channels: 2,
  durationSeconds: seconds,
});

describe("RenderedTuneCache", () => {
  it("keeps previous / current / next and drops the oldest", () => {
    const cache = new RenderedTuneCache();
    expect(DEFAULT_MAX_TUNES).toBe(3);
    for (const key of ["a", "b", "c"]) cache.set(key, tune(1));
    expect(cache.size).toBe(3);

    cache.set("d", tune(1));

    expect(cache.size).toBe(3);
    expect(cache.has("a")).toBe(false);
    expect(cache.has("d")).toBe(true);
  });

  it("treats a read as use, so the current tune is not evicted by its neighbours", () => {
    const cache = new RenderedTuneCache();
    for (const key of ["a", "b", "c"]) cache.set(key, tune(1));

    cache.get("a"); // "a" is what is playing
    cache.set("d", tune(1));

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });

  it("evicts on the byte budget even when under the count limit", () => {
    // 2 MB budget: each 10-second tune is ~1.9 MB, so the second one evicts the first.
    const cache = new RenderedTuneCache(3, 2 * 1024 * 1024);
    cache.set("a", tune(10));
    cache.set("b", tune(10));

    expect(cache.size).toBe(1);
    expect(cache.has("b")).toBe(true);
    expect(cache.bytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it("refuses a tune bigger than the whole budget instead of emptying itself", () => {
    const cache = new RenderedTuneCache(3, 1024 * 1024);
    cache.set("small", tune(1));
    const before = cache.size;

    cache.set("huge", tune(60));

    // The oversized tune is not stored, and it did not evict what was there.
    expect(cache.has("huge")).toBe(false);
    expect(cache.size).toBe(before);
    expect(cache.has("small")).toBe(true);
  });

  it("reports the byte cost so the budget can be asserted", () => {
    const cache = new RenderedTuneCache();
    cache.set("a", tune(1));
    // One second of 48 kHz stereo Int16 = 192,000 bytes.
    expect(cache.bytes).toBe(192_000);
  });
});
