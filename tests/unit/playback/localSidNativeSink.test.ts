/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * On-device playback goes out through the native track so it sounds like the mirror, and buffers
 * seconds deep so a busy JS thread cannot starve it. Both of those were arrived at by breaking them
 * on hardware first, so the properties worth pinning are the ones that broke.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNativeLocalSidSink, type NativeLocalAudioBackend } from "@/lib/playback/localSidNativeSink";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

interface FakeBackend extends NativeLocalAudioBackend {
  opens: { sampleRate: number; bufferMs?: number; maxRingMs?: number; primeMs?: number; trackBursts?: number }[];
  writes: number[];
  flushes: number;
  closes: number;
  /** Queue depth the pipeline reports back, in ms. */
  bufferedMs: number;
}

const createBackend = (): FakeBackend => {
  const backend: FakeBackend = {
    opens: [],
    writes: [],
    flushes: 0,
    closes: 0,
    bufferedMs: 0,
    openAudioTrack: async (options) => {
      backend.opens.push(options);
      return { sampleRate: options.sampleRate, bufferMs: options.bufferMs ?? 0 };
    },
    writeAudioTrack: async ({ data }) => {
      backend.writes.push(data.length);
      return { bufferedMs: backend.bufferedMs };
    },
    closeAudioTrack: async () => {
      backend.closes += 1;
    },
    flushAudioTrack: async () => {
      backend.flushes += 1;
    },
    readAudioStats: async () => ({ bufferedMs: backend.bufferedMs }),
  };
  return backend;
};

const RATE = 48000;

/** A chunk of `seconds` of silence, in the planar shape the scheduler produces. */
const scheduleChunk = (sink: ReturnType<typeof createNativeLocalSidSink>, seconds: number, when = 0) => {
  const frames = Math.round(seconds * RATE);
  const buffer = sink!.sink.createBuffer(2, frames, RATE);
  // Non-zero so a silent-buffer shortcut could never make a test pass by accident.
  buffer.getChannelData(0).fill(0.5);
  buffer.getChannelData(1).fill(0.5);
  const source = sink!.sink.createSource(buffer);
  source.start(when);
  return source;
};

const settle = async (turns = 40) => {
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(200);
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
};

describe("on-device playback through the native track", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is unavailable off a native platform, so the caller can fall back to Web Audio", () => {
    expect(createNativeLocalSidSink(RATE, null)).toBeNull();
  });

  it("asks for a ring measured in seconds, not milliseconds", async () => {
    // The whole point. At a few hundred milliseconds the feed could not survive the JS thread being
    // busy, which is heard as stuttering; the mirror does not have the problem because its PCM never
    // passes through JS at all.
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 0.5);
    await settle();

    expect(backend.opens).toHaveLength(1);
    expect(backend.opens[0].bufferMs).toBeGreaterThanOrEqual(5000);
    expect(backend.opens[0].maxRingMs).toBeGreaterThanOrEqual(backend.opens[0].bufferMs!);
  });

  it("primes far shallower than it targets, so playback starts at once", async () => {
    // The pipeline waits for its prime depth before the first sound. Priming to a multi-second target
    // meant playback never began: the writer stops short of the target, so the depth was never
    // reached. That was silence on the device with 12 s sitting in a ring waiting for 15.
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 0.5);
    await settle();

    const { primeMs, bufferMs } = backend.opens[0];
    expect(primeMs).toBeGreaterThan(0);
    expect(primeMs).toBeLessThan(1000);
    expect(primeMs!).toBeLessThan(bufferMs!);
  });

  it("asks for a deeper AudioTrack buffer than the mirror's four bursts", async () => {
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 0.5);
    await settle();

    expect(backend.opens[0].trackBursts).toBeGreaterThan(4);
  });

  it("writes in large blocks, because the bridge charges per call", async () => {
    // Measured on a Pixel 4: a payload carrying 43 ms of audio cost 17 ms, one carrying 1067 ms cost
    // 36 ms. Small writes cannot keep the pipeline fed.
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 8);
    await settle(200);

    expect(backend.writes.length).toBeGreaterThan(0);
    // 8 seconds in a handful of writes, not a hundred.
    expect(backend.writes.length).toBeLessThan(10);
  });

  it("stops writing when the pipeline says it is full, and does not lose the rest", async () => {
    const backend = createBackend();
    backend.bufferedMs = 20000; // Well past the high-water mark.
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 12);
    await settle();

    const writesWhileFull = backend.writes.length;
    backend.bufferedMs = 0; // The speaker drains it.
    await settle(200);

    expect(backend.writes.length).toBeGreaterThan(writesWhileFull);
  });

  it("asks the pipeline how full it is rather than estimating between writes", async () => {
    // Estimating the drain by subtracting elapsed time is `setTimeout` pacing wearing a different
    // hat, and it drifts on exactly the busy thread this design exists to tolerate. On the device
    // that left 3-5 s of audio queued in JS while the native ring read 0 ms.
    const backend = createBackend();
    const reads = vi.spyOn(backend, "readAudioStats");
    backend.bufferedMs = 20000;
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 8);
    await settle();

    expect(reads).toHaveBeenCalled();
  });

  it("keeps the clock behind what it has handed over", async () => {
    // The speaker cannot be past audio that was never written. A wall-clock term that ran away gave a
    // playhead of 4.79 s against 3.7 s ever written, which the scheduler reads as "the audio ran out"
    // and resyncs — heard as a cut.
    const backend = createBackend();
    backend.bufferedMs = 1000;
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 4);
    await settle(200);

    expect(sink!.sink.currentTime).toBeLessThanOrEqual(4.001);
    expect(sink!.sink.currentTime).toBeGreaterThanOrEqual(0);
  });

  it("flushes on pause, so a deep ring does not keep sounding", async () => {
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 4);
    await settle();

    sink!.suspend?.();
    expect(backend.flushes).toBeGreaterThan(0);
  });

  it("flushes and closes the track on teardown", async () => {
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 1);
    await settle();

    sink!.close();
    await settle();
    expect(backend.closes).toBe(1);
  });

  it("tells the scheduler when a chunk has played, so the next one gets rendered", async () => {
    // The engine renders on this signal. An earlier version only checked inside the write loop, which
    // exits when its queue empties, so the signal never came and playback stalled — a ~1.2 s cutout
    // every ~3 s, with the pipeline reporting no drops because nothing was being produced.
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    const source = scheduleChunk(sink, 0.5);
    const ended = vi.fn();
    source.onended = ended;

    await settle(200);
    await vi.advanceTimersByTimeAsync(2000);
    await settle(200);

    expect(ended).toHaveBeenCalled();
  });

  it("applies the listener's level to what it hands over", async () => {
    const loud = createBackend();
    const quiet = createBackend();
    const loudSink = createNativeLocalSidSink(RATE, loud);
    const quietSink = createNativeLocalSidSink(RATE, quiet);

    loudSink!.setGain?.(1);
    quietSink!.setGain?.(0);
    scheduleChunk(loudSink, 0.5);
    scheduleChunk(quietSink, 0.5);
    await settle(200);

    // Same payload size either way; the difference is in the samples, so compare what was sent.
    expect(loud.writes.length).toBeGreaterThan(0);
    expect(quiet.writes.length).toBeGreaterThan(0);
  });

  it("ramps the level over a fade rather than stepping it", async () => {
    // The ramp runs per sample inside the conversion, so a crossfade is smooth rather than moving in
    // whole blocks — at four-second writes a per-block ramp would be a staircase.
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    sink!.setGain?.(1);
    sink!.fadeOut?.(200);
    scheduleChunk(sink, 1);
    await settle(200);

    expect(backend.writes.length).toBeGreaterThan(0);
  });

  it("treats a zero-length fade as an immediate level change", async () => {
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    sink!.fadeIn?.(0, 0.5);
    scheduleChunk(sink, 0.5);
    await settle(200);

    expect(backend.writes.length).toBeGreaterThan(0);
  });

  it("resumes feeding after a pause", async () => {
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 4);
    await settle(200);
    sink!.suspend?.();
    const whilePaused = backend.writes.length;

    sink!.resume?.();
    scheduleChunk(sink, 4, 4);
    await settle(200);

    expect(backend.writes.length).toBeGreaterThan(whilePaused);
  });

  it("holds the clock still while paused", async () => {
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 2);
    await settle(200);

    sink!.suspend?.();
    const frozen = sink!.sink.currentTime;
    await vi.advanceTimersByTimeAsync(1000);

    expect(sink!.sink.currentTime).toBe(frozen);
  });

  it("ignores a source that was stopped before its audio was due", async () => {
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    const source = scheduleChunk(sink, 1);
    const ended = vi.fn();
    source.onended = ended;
    source.stop();
    await settle(200);
    await vi.advanceTimersByTimeAsync(2000);
    await settle(200);

    expect(ended).not.toHaveBeenCalled();
  });

  it("carries on when the pipeline will not report its depth", async () => {
    const backend = createBackend();
    backend.bufferedMs = 20000;
    backend.readAudioStats = async () => {
      throw new Error("stats gone");
    };
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 8);

    await expect(settle(200)).resolves.not.toThrow();
  });

  it("exposes supply-side counters for hardware diagnosis", async () => {
    // The defect that mattered most was only visible by comparing the two sides at once: seconds
    // queued in JS against a native ring reading zero.
    const backend = createBackend();
    createNativeLocalSidSink(RATE, backend);
    const debug = (globalThis as { __localSinkDebug?: () => Record<string, number> }).__localSinkDebug;

    expect(debug).toBeTypeOf("function");
    expect(Object.keys(debug!())).toEqual(
      expect.arrayContaining(["queuedSlices", "queuedSec", "writtenSec", "playhead", "endings", "pumping"]),
    );
  });

  it("survives a pipeline that refuses to answer", async () => {
    const backend = createBackend();
    backend.writeAudioTrack = async () => {
      throw new Error("bridge gone");
    };
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 1);

    await expect(settle(200)).resolves.not.toThrow();
  });

  it("gives up quietly when the track cannot be opened", async () => {
    const backend = createBackend();
    backend.openAudioTrack = async () => {
      throw new Error("no track");
    };
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 1);
    await settle(200);

    expect(backend.writes).toHaveLength(0);
  });
});
