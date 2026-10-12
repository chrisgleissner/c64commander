/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const romState = vi.hoisted(() => ({ complete: true }));
vi.mock("@/lib/roms/romStore", () => ({
  hasCompleteRomSet: () => romState.complete,
  loadStoredRoms: () => ({}),
}));

import {
  isNativePcm,
  NativePcmBuffer,
  payloadFrames,
  payloadSamples,
  type NativePcmRef,
} from "@/lib/playback/sidRenderer/pcmPayload";
import { PcmAccumulator } from "@/lib/playback/sidRenderer/pcmAccumulator";
import { RenderedTuneCache, samePcmStorage, playbackSidEmulation } from "@/lib/playback/renderedTuneCache";
import { __setNativePcmReleasePluginForTests, releaseNativePcm } from "@/lib/playback/sidRenderer/nativePcmRelease";
import {
  __resetPcmPortForTests,
  confirmedPcmPort,
  pcmMessage,
  PCM_HEADER_BYTES,
} from "@/lib/playback/sidRenderer/nativePcmPort";
import {
  __resetRenderThroughput,
  accurateEngineViable,
  recordRenderMeasurement,
  renderRatio,
  setActiveRenderThroughputRenderer,
  startupBufferSeconds,
} from "@/lib/playback/renderThroughput";
import { __setSidplayEzAvailabilityForTests } from "@/lib/playback/sidRenderer/sidRendererAvailability";
import { saveSidEmulationEngine } from "@/lib/config/appSettings";
import type { SidAudioPlugin } from "@/lib/native/sidAudio";

const ref = (bufferId: number, startFrame: number, frames: number): NativePcmRef => ({
  kind: "native-pcm",
  bufferId,
  startFrame,
  frames,
});

describe("PCM payloads", () => {
  it("tells a native reference from a JS buffer, and counts both in frames and samples", () => {
    expect(isNativePcm(ref(1, 0, 10))).toBe(true);
    expect(isNativePcm(new Int16Array(4))).toBe(false);
    expect(isNativePcm(null)).toBe(false);
    expect(payloadFrames(ref(1, 0, 10), 2)).toBe(10);
    expect(payloadFrames(new Int16Array(20), 2)).toBe(10);
    expect(payloadSamples(ref(1, 0, 10), 2)).toBe(20);
  });

  it("slices a native buffer by sample index into frame ranges of the same buffer", () => {
    const buffer = new NativePcmBuffer(9, 100);
    expect(buffer.length).toBe(200);
    expect(buffer.byteLength).toBe(400);
    expect(buffer.slice(20, 60)).toEqual(ref(9, 10, 20));
    expect(buffer.slice(150, 999)).toEqual(ref(9, 75, 25));
    expect(buffer.subarray(0, 50)).toEqual(new NativePcmBuffer(9, 25));
    expect(() => buffer.subarray(2, 10)).toThrow(/start/);
  });
});

describe("a growing render", () => {
  it("copies WASM slices into one buffer sized up front, without reallocating per slice", () => {
    const accumulator = new PcmAccumulator();
    const first = accumulator.append(Int16Array.from([1, 2, 3, 4]), 12, 2) as Int16Array;
    const second = accumulator.append(Int16Array.from([5, 6]), 12, 2) as Int16Array;
    expect(Array.from(second)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(second.buffer).toBe(first.buffer);
    const finished = accumulator.finish() as Int16Array;
    expect(Array.from(finished)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(finished.buffer.byteLength).toBe(12);
    expect(accumulator.samples).toBe(0);
  });

  it("grows once when a render overruns its estimate, and survives a useless estimate", () => {
    const accumulator = new PcmAccumulator();
    accumulator.append(new Int16Array(4).fill(1), 2, 2);
    const grown = accumulator.append(new Int16Array(4).fill(2), Number.NaN, 2) as Int16Array;
    expect(Array.from(grown)).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
  });

  it("tracks a libSidplayEZ render as how far the native buffer has got", () => {
    const accumulator = new PcmAccumulator();
    accumulator.append(ref(4, 0, 100), 0, 2);
    const grown = accumulator.append(ref(4, 100, 50), 0, 2);
    expect(grown).toEqual(new NativePcmBuffer(4, 150));
    expect(accumulator.nativeBuffer?.bufferId).toBe(4);
    expect(accumulator.reset()).toEqual(new NativePcmBuffer(4, 150));
    expect(accumulator.nativeBuffer).toBeNull();
  });
});

describe("the render cache and native buffers", () => {
  const tune = (pcm: Int16Array | NativePcmBuffer) => ({ pcm, sampleRate: 48000, channels: 2, durationSeconds: 1 });

  it("reports every entry it lets go of, but not one replaced by a grown view of the same buffer", () => {
    const dropped: unknown[] = [];
    const cache = new RenderedTuneCache(2, 1e9, (entry) => dropped.push(entry.pcm));
    cache.set("a", tune(new NativePcmBuffer(1, 10)));
    cache.set("a", tune(new NativePcmBuffer(1, 20)));
    expect(dropped).toEqual([]);
    cache.set("a", tune(new NativePcmBuffer(2, 20)));
    expect(dropped).toEqual([new NativePcmBuffer(1, 20)]);
    cache.set("b", tune(new NativePcmBuffer(3, 1)));
    cache.set("c", tune(new NativePcmBuffer(4, 1)));
    expect(dropped).toContainEqual(new NativePcmBuffer(2, 20));
    cache.delete("b");
    cache.clear();
    expect(dropped).toContainEqual(new NativePcmBuffer(3, 1));
    expect(dropped).toContainEqual(new NativePcmBuffer(4, 1));
  });

  it("reports a tune too large to cache, so its buffer is not stranded", () => {
    const dropped: unknown[] = [];
    const cache = new RenderedTuneCache(3, 100, (entry) => dropped.push(entry.pcm));
    cache.set("a", tune(new NativePcmBuffer(5, 1000)));
    expect(dropped).toEqual([new NativePcmBuffer(5, 1000)]);
  });

  it("says whether it holds a buffer, by storage rather than by view", () => {
    const cache = new RenderedTuneCache();
    const js = new Int16Array(8);
    cache.set("a", tune(js.subarray(0, 4)));
    cache.set("b", tune(new NativePcmBuffer(7, 3)));
    expect(cache.holds(js)).toBe(true);
    expect(cache.holds(new NativePcmBuffer(7, 0))).toBe(true);
    expect(cache.holds(new NativePcmBuffer(8, 0))).toBe(false);
    expect(samePcmStorage(js, new NativePcmBuffer(1, 1))).toBe(false);
  });
});

describe("giving native buffers back", () => {
  it("batches the releases of one turn into one call, and ignores JS buffers", async () => {
    const releaseBuffers = vi.fn(async () => ({ held: 0 }));
    __setNativePcmReleasePluginForTests({ releaseBuffers } as unknown as SidAudioPlugin);
    releaseNativePcm(ref(1, 0, 10));
    releaseNativePcm(new NativePcmBuffer(2, 5));
    releaseNativePcm(ref(1, 10, 10));
    releaseNativePcm(new Int16Array(4));
    releaseNativePcm(null);
    await Promise.resolve();
    expect(releaseBuffers).toHaveBeenCalledTimes(1);
    expect(releaseBuffers).toHaveBeenCalledWith({ bufferIds: [1, 2] });
  });
});

describe("the binary PCM port", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).c64SidAudioPort;
    __resetPcmPortForTests();
    vi.useRealTimers();
  });

  it("frames a chunk as header plus little-endian stereo samples", () => {
    const message = pcmMessage(3, 4_000_000_001, Int16Array.from([1, -2, 3, -4]));
    const view = new DataView(message);
    expect(view.getUint32(0, true)).toBe(0x50343643);
    expect(view.getUint32(4, true)).toBe(1);
    expect(view.getUint32(8, true)).toBe(3);
    expect(view.getUint32(12, true)).toBe(4_000_000_001);
    expect(view.getUint32(16, true)).toBe(2);
    expect(Array.from(new Int16Array(message, PCM_HEADER_BYTES))).toEqual([1, -2, 3, -4]);
  });

  it("is used only once a probe has been seen arriving on the native side", async () => {
    vi.useFakeTimers();
    const posted: ArrayBuffer[] = [];
    (globalThis as Record<string, unknown>).c64SidAudioPort = { postMessage: (m: ArrayBuffer) => posted.push(m) };
    let probes = 0;
    const plugin = { describe: vi.fn(async () => ({ binaryPortProbes: probes })) };
    const pending = confirmedPcmPort(plugin as unknown as SidAudioPlugin);
    await vi.advanceTimersByTimeAsync(10);
    probes = 1;
    await vi.advanceTimersByTimeAsync(300);
    expect(await pending).not.toBeNull();
    expect(new DataView(posted[0]).getUint32(4, true)).toBe(0);
  });

  it("falls back to the bridge when probes never arrive, or when there is no port at all", async () => {
    vi.useFakeTimers();
    expect(await confirmedPcmPort({ describe: vi.fn() } as unknown as SidAudioPlugin)).toBeNull();
    __resetPcmPortForTests();
    (globalThis as Record<string, unknown>).c64SidAudioPort = { postMessage: () => undefined };
    const pending = confirmedPcmPort({
      describe: vi.fn(async () => ({ binaryPortProbes: 0 })),
    } as unknown as SidAudioPlugin);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBeNull();
  });
});

describe("render throughput, learned per renderer", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetRenderThroughput();
  });

  it("keeps each renderer's measurements apart", () => {
    for (let i = 0; i < 6; i += 1) {
      recordRenderMeasurement(1, 1000 / 10, "sidplayez");
      recordRenderMeasurement(1, 1000 / 2, "residfp");
    }
    expect(renderRatio("sidplayez")).toBeGreaterThan(renderRatio("residfp") * 3);
    expect(startupBufferSeconds("sidplayez")).toBeLessThan(startupBufferSeconds("residfp"));
  });

  it("answers for the renderer the engine opened last when the caller names none", () => {
    for (let i = 0; i < 6; i += 1) recordRenderMeasurement(1, 1000 / 10, "sidplayez");
    setActiveRenderThroughputRenderer("sidplayez");
    expect(renderRatio()).toBe(renderRatio("sidplayez"));
  });

  it("demotes one renderer on its own evidence without touching another", () => {
    for (let i = 0; i < 6; i += 1) recordRenderMeasurement(1, 1000, "residfp");
    expect(accurateEngineViable("residfp")).toBe(false);
    expect(accurateEngineViable("sidplayez")).toBe(true);
  });

  it("keeps reSIDfp's figure under the key earlier releases stored it in", () => {
    localStorage.setItem("c64c.local-sid.render-throughput", "3.5");
    __resetRenderThroughputKeepStorage();
    expect(renderRatio("residfp")).toBe(3.5);
    expect(renderRatio("sidplayez")).toBe(2);
  });
});

/** Forget the in-memory figures but keep what is stored, as a relaunch does. */
const __resetRenderThroughputKeepStorage = () => {
  const stored = localStorage.getItem("c64c.local-sid.render-throughput");
  __resetRenderThroughput();
  if (stored !== null) localStorage.setItem("c64c.local-sid.render-throughput", stored);
};

describe("which renderer a tune actually plays with", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetRenderThroughput();
  });

  afterEach(() => __setSidplayEzAvailabilityForTests(null));

  it("is libSidplayEZ by default where it exists, and reSIDfp where it does not", () => {
    __setSidplayEzAvailabilityForTests(true);
    expect(playbackSidEmulation()).toBe("sidplayez");
    __setSidplayEzAvailabilityForTests(false);
    expect(playbackSidEmulation()).toBe("residfp");
  });

  it("honours an explicit choice of either WASM renderer", () => {
    __setSidplayEzAvailabilityForTests(true);
    saveSidEmulationEngine("residfp");
    expect(playbackSidEmulation()).toBe("residfp");
    saveSidEmulationEngine("sidlite");
    expect(playbackSidEmulation()).toBe("sidlite");
  });

  it("falls back to SIDLite, never to the slower reSIDfp, when libSidplayEZ cannot keep up", () => {
    __setSidplayEzAvailabilityForTests(true);
    for (let i = 0; i < 6; i += 1) recordRenderMeasurement(1, 1000, "sidplayez");
    expect(playbackSidEmulation()).toBe("sidlite");
  });
});
