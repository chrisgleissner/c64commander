import { beforeEach, describe, expect, it, vi } from "vitest";

// The ROM images are 8 KB each and fingerprint-checked, so the cheapest honest way to say
// "this device can run the accurate emulation" is to answer the one question the key asks.
const romsPresent = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/roms/romStore", () => ({
  hasCompleteRomSet: () => romsPresent.value,
}));

import { buildRenderedTuneKey, RenderedTuneCache, DEFAULT_MAX_TUNES } from "@/lib/playback/renderedTuneCache";

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

/**
 * The point of pre-rendering is that a seek stops costing a re-render.
 * libsidplayfp cannot rewind, so going backwards through the engine replays the
 * tune from the start at ~150 ms of CPU per second of audio — seconds of
 * silence for something the listener expects to be instant.
 */
describe("seeking from a cached render", () => {
  it("slices audio out of the buffer at the requested offset", () => {
    const cache = new RenderedTuneCache();
    const seconds = 4;
    const rendered = tune(seconds);
    // Mark each frame so the slice can be located unambiguously.
    for (let i = 0; i < rendered.pcm.length; i += 1) rendered.pcm[i] = i % 1000;
    cache.set("k", rendered);

    const hit = cache.get("k")!;
    const targetSeconds = 2;
    const cursor = Math.floor(targetSeconds * hit.sampleRate) * hit.channels;

    expect(cursor).toBe(48000 * 2 * 2);
    expect(hit.pcm.slice(cursor, cursor + 4)).toEqual(
      new Int16Array([cursor % 1000, (cursor + 1) % 1000, (cursor + 2) % 1000, (cursor + 3) % 1000]),
    );
    // Seeking past the end clamps rather than reading out of bounds.
    const past = Math.min(hit.pcm.length, Math.floor(99 * hit.sampleRate) * hit.channels);
    expect(past).toBe(hit.pcm.length);
  });
});

/**
 * The cache holds fully-rendered PCM, so anything that changes what a render sounds like has to
 * separate one key from another. Without that, changing the setting keeps serving audio produced
 * under the old one — and the pre-rendered lead-in of the next track hands over to live rendering
 * under the new one part-way through, which is a change of timbre mid-tune.
 */
describe("buildRenderedTuneKey", () => {
  beforeEach(() => {
    localStorage.clear();
    romsPresent.value = true;
  });

  it("separates the two tunes of one file", () => {
    expect(buildRenderedTuneKey("item", 0)).not.toBe(buildRenderedTuneKey("item", 1));
  });

  it("separates the fallback SID chips", () => {
    localStorage.setItem("c64u_local_sid_model", "6581");
    const on6581 = buildRenderedTuneKey("item", 0);
    localStorage.setItem("c64u_local_sid_model", "8580");
    expect(buildRenderedTuneKey("item", 0)).not.toBe(on6581);
  });

  it("separates the two emulations", () => {
    localStorage.setItem("c64u_sid_emulation_engine", "residfp");
    const accurate = buildRenderedTuneKey("item", 0);
    localStorage.setItem("c64u_sid_emulation_engine", "sidlite");
    expect(buildRenderedTuneKey("item", 0)).not.toBe(accurate);
  });

  it("separates a render made without the ROMs, which is SIDLite whatever the setting says", () => {
    localStorage.setItem("c64u_sid_emulation_engine", "residfp");
    const withRoms = buildRenderedTuneKey("item", 0);
    romsPresent.value = false;
    expect(buildRenderedTuneKey("item", 0)).not.toBe(withRoms);
  });
});
