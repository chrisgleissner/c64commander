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
  /** The samples of each write, decoded — the volume control's whole job is what is in here. */
  pcm: Int16Array[];
  flushes: number;
  pauses: number;
  resumes: number;
  closes: number;
  /** Queue depth the pipeline reports back, in ms. */
  bufferedMs: number;
  /** Cumulative AudioTrack underruns the pipeline reports back. */
  underruns: number;
}

/** Undo the sink's base64 framing, back to the interleaved S16 the pipeline would have played. */
const decodePcm = (base64: string): Int16Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
};

const createBackend = (): FakeBackend => {
  const backend: FakeBackend = {
    opens: [],
    writes: [],
    pcm: [],
    flushes: 0,
    pauses: 0,
    resumes: 0,
    closes: 0,
    bufferedMs: 0,
    underruns: 0,
    openAudioTrack: async (options) => {
      backend.opens.push(options);
      return { sampleRate: options.sampleRate, bufferMs: options.bufferMs ?? 0 };
    },
    writeAudioTrack: async ({ data }) => {
      backend.writes.push(data.length);
      backend.pcm.push(decodePcm(data));
      return { bufferedMs: backend.bufferedMs, underruns: backend.underruns };
    },
    closeAudioTrack: async () => {
      backend.closes += 1;
    },
    flushAudioTrack: async () => {
      backend.flushes += 1;
    },
    pauseAudioTrack: async () => {
      backend.pauses += 1;
    },
    resumeAudioTrack: async () => {
      backend.resumes += 1;
    },
    readAudioStats: async () => ({ bufferedMs: backend.bufferedMs, underruns: backend.underruns }),
  };
  return backend;
};

const RATE = 48000;

/** The conversion-side level, which is the only attenuator once the pipeline has refused. */
const sinkMasterGainOf = (sink: NonNullable<ReturnType<typeof createNativeLocalSidSink>>): number =>
  (sink.sink as unknown as { masterGain: number }).masterGain;
/** Int16 full scale, as the sink scales to it. */
const INT16_MAX = 32768;

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

    // Sized from how fast this device renders (see renderThroughput), so the figure is small relative
    // to the target rather than a fixed number — what matters is that it is nowhere near it.
    const { primeMs, bufferMs } = backend.opens[0];
    expect(primeMs).toBeGreaterThan(0);
    expect(primeMs!).toBeLessThan(bufferMs! / 3);
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

  it("drops queued audio on a seek, so the old position stops at once", async () => {
    // Stopping the scheduled sources is not enough here: the pipeline holds seconds of audio ahead of
    // the speaker, so without this a seek went on playing where the listener had just left.
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 8);
    await settle();
    const before = backend.flushes;

    sink!.flush?.();

    expect(backend.flushes).toBeGreaterThan(before);
    // And the clock restarts, so audio scheduled from the new position is not judged late.
    expect(sink!.sink.currentTime).toBeLessThan(0.5);
  });

  it("holds the pipeline on pause, so a deep ring does not keep sounding", async () => {
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 4);
    await settle();

    sink!.suspend?.();
    await settle();
    expect(backend.pauses).toBe(1);
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

  // These three used to assert only that *something* was written, which every one of them would have
  // done with the gain removed entirely. They now decode the payload, because the samples in it are
  // the only thing the volume control changes.
  it("applies the listener's level to what it hands over", async () => {
    const loud = createBackend();
    const quiet = createBackend();
    const silent = createBackend();
    const loudSink = createNativeLocalSidSink(RATE, loud);
    const quietSink = createNativeLocalSidSink(RATE, quiet);
    const silentSink = createNativeLocalSidSink(RATE, silent);

    loudSink!.setGain?.(1);
    quietSink!.setGain?.(0.25);
    silentSink!.setGain?.(0);
    scheduleChunk(loudSink, 0.5);
    scheduleChunk(quietSink, 0.5);
    scheduleChunk(silentSink, 0.5);
    await settle(200);

    // 0.5 full scale in, so unity is half of Int16 and a quarter of that is an eighth.
    expect(loud.pcm[0][0]).toBe(Math.round(0.5 * (INT16_MAX - 1)));
    expect(quiet.pcm[0][0]).toBe(Math.round(0.125 * (INT16_MAX - 1)));
    // Mute is silence, not "quiet enough".
    expect(Array.from(silent.pcm[0]).every((sample) => sample === 0)).toBe(true);
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

    const samples = backend.pcm[0];
    const at = (seconds: number) => Math.abs(samples[Math.round(seconds * RATE) * 2]);
    expect(at(0)).toBeGreaterThan(15000);
    // A quarter of the way through a 200 ms fade-out, roughly three quarters of the level is left.
    expect(at(0.05)).toBeGreaterThan(11000);
    expect(at(0.05)).toBeLessThan(13500);
    // And it has actually reached silence by the end of the fade, rather than merely got quieter.
    expect(at(0.25)).toBe(0);
  });

  it("treats a zero-length fade as an immediate level change", async () => {
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    sink!.fadeIn?.(0, 0.5);
    scheduleChunk(sink, 0.5);
    await settle(200);

    expect(backend.pcm[0][0]).toBe(Math.round(0.25 * (INT16_MAX - 1)));
  });

  it("mutes to silence and comes back to the level the slider still reads", async () => {
    // What the Play page's speaker button asks for. The level is held here, not in the button, so
    // unmuting must land back on the same step rather than on a default.
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    sink!.setGain?.(0.25);
    scheduleChunk(sink, 0.5);
    await settle(200);

    sink!.setGain?.(0);
    scheduleChunk(sink, 0.5, 0.5);
    await settle(200);

    sink!.setGain?.(0.25);
    scheduleChunk(sink, 0.5, 1);
    await settle(200);

    const quarter = Math.round(0.125 * (INT16_MAX - 1));
    expect(backend.pcm[0][0]).toBe(quarter);
    // Past the ramp into and out of the mute, so this is the settled state either side of it.
    expect(backend.pcm[1][backend.pcm[1].length - 1]).toBe(0);
    expect(backend.pcm[2][backend.pcm[2].length - 1]).toBe(quarter);
  });

  it("ramps a level change instead of stepping it, so the change is not heard as a click", async () => {
    // A gain that differs between one sample and the next is a step in the waveform, and a step is a
    // click; dragging the slider would produce a run of them. Twenty milliseconds of ramp is enough
    // to remove it and short enough that Mute still reads as instant.
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 0.5);
    await settle(200);

    sink!.setGain?.(0);
    scheduleChunk(sink, 0.5, 0.5);
    await settle(200);

    const muted = backend.pcm[1];
    // The first sample after the change is still near the old level: it has not jumped to zero.
    expect(muted[0]).toBeGreaterThan(Math.round(0.45 * (INT16_MAX - 1)));
    // It falls away smoothly rather than in one move.
    expect(muted[2 * Math.round(0.005 * RATE)]).toBeLessThan(muted[0]);
    expect(muted[2 * Math.round(0.005 * RATE)]).toBeGreaterThan(0);
    // And it is silent once the ramp has run.
    expect(muted[2 * Math.round(0.03 * RATE)]).toBe(0);
  });

  it("keeps the listener's level and the crossfade apart, so neither cancels the other", async () => {
    // They are two different quantities behind one conversion. While they shared a field, moving the
    // slider during a crossfade cancelled the crossfade and every crossfade discarded the level.
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 0.5);
    await settle(200);

    sink!.fadeOut?.(200);
    sink!.setGain?.(0.5);
    scheduleChunk(sink, 0.5, 0.5);
    await settle(200);

    const faded = backend.pcm[1];
    // The crossfade still runs to silence despite the level change landing on top of it.
    expect(faded[faded.length - 2]).toBe(0);
    // And it was attenuated on the way down, so the level change was not discarded either: a quarter
    // of the way through the fade the two multiply to about 0.5 x 0.75 of the source.
    const quarterWay = Math.abs(faded[2 * Math.round(0.05 * RATE)]);
    expect(quarterWay).toBeGreaterThan(5000);
    expect(quarterWay).toBeLessThan(7000);
  });

  it("attenuates only, so the control can never push a sample into clipping", async () => {
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    sink!.setGain?.(4);
    scheduleChunk(sink, 0.5);
    await settle(200);

    expect(backend.pcm[0][0]).toBe(Math.round(0.5 * (INT16_MAX - 1)));
  });

  it("resumes feeding after a pause without being handed anything new", async () => {
    // The engine does not re-feed a resumed tune: its render top-up is gated on what the scheduler
    // believes is still in flight, and a pause changes nothing about that. So the sink has to
    // continue from what it already holds, on its own, or playback never restarts.
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    // A full pipeline, so the pump stops at its high water with slices of its own still queued.
    backend.bufferedMs = 12_000;
    scheduleChunk(sink, 20);
    await settle(200);
    sink!.suspend?.();
    const whilePaused = backend.writes.length;
    // Drained, so the only thing left holding the pump back is the pause.
    backend.bufferedMs = 0;
    await settle(200);
    expect(backend.writes.length).toBe(whilePaused);

    const frozen = sink!.sink.currentTime;
    sink!.resume?.();
    await settle(200);

    expect(backend.writes.length).toBeGreaterThan(whilePaused);
    // The transport clock is derived from this, and a resume that writes nothing froze it for good.
    expect(sink!.sink.currentTime).toBeGreaterThan(frozen);
  });

  it("pauses the pipeline rather than flushing it, so a resume is not a jump forward", async () => {
    // The ring runs twelve seconds deep. Flushing it for a pause discards audio the tune already
    // rendered, and the write counter then has to be rebased onto what was played — which leaves the
    // scheduler counting audio the sink no longer holds, and its render gate never reopens.
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 4);
    await settle(200);

    sink!.suspend?.();
    await settle();

    expect(backend.pauses).toBe(1);
    expect(backend.flushes).toBe(0);
  });

  // A refused pause or resume must not stop the transport: the sink's own state has already moved,
  // and the worst case is the speaker not following it, which the next chunk corrects.
  it("logs a refused pause and a refused resume rather than raising them", async () => {
    const backend = createBackend();
    backend.pauseAudioTrack = async () => {
      throw new Error("track released");
    };
    backend.resumeAudioTrack = async () => {
      throw new Error("track released");
    };
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 4);
    await settle(200);

    expect(() => sink!.suspend?.()).not.toThrow();
    await settle();
    expect(() => sink!.resume?.()).not.toThrow();
    await settle();
  });

  // Without the plugin's pause method the flush is the only way to stop the speaker. It costs the
  // ring's audio, which is heard as a jump forward, so it is a fallback rather than the design.
  it("falls back to a flush on a plugin build with no pause method", async () => {
    const backend = createBackend();
    delete (backend as { pauseAudioTrack?: unknown }).pauseAudioTrack;
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 4);
    await settle(200);

    sink!.suspend?.();
    await settle();

    expect(backend.flushes).toBeGreaterThan(0);
  });

  it("keeps the completions owed for audio a pause did not throw away", async () => {
    // They are what drives the engine to render more. Discarding them on a pause stopped the chain:
    // no completion, no render, nothing written, and the playhead could not advance again.
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 4, 100);
    await settle(200);
    const debug = (globalThis as Record<string, unknown>).__localSinkDebug as () => Record<string, number>;
    const owed = debug().endings;
    expect(owed).toBeGreaterThan(0);

    sink!.suspend?.();

    expect(debug().endings).toBe(owed);
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

  it("tries again after a failed open instead of staying silent for good", async () => {
    // A rejected attempt used to be cached, so one failure at the wrong moment — a track the platform
    // was still tearing down, say — silenced the sink permanently.
    const backend = createBackend();
    let fail = true;
    backend.openAudioTrack = async (options) => {
      if (fail) throw new Error("busy");
      backend.opens.push(options);
      return { sampleRate: options.sampleRate, bufferMs: options.bufferMs ?? 0 };
    };
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 1);
    await settle(200);
    expect(backend.writes).toHaveLength(0);

    fail = false;
    scheduleChunk(sink, 1, 1);
    await settle(200);

    expect(backend.writes.length).toBeGreaterThan(0);
  });

  it("gives up when the platform never answers the open, instead of latching the pump", async () => {
    // `openAudioTrack` is a Capacitor call, and Capacitor delivers a plugin result by evaluating
    // JavaScript in the page — a hidden WebView suspends it indefinitely rather than failing it.
    // `pump()` awaits this inside its `try`, so an open that never settles means the `finally` that
    // clears `pumping` never runs and no later pump can start: silence for the rest of the session
    // with the transport still reporting playback.
    vi.useFakeTimers();
    try {
      const backend = createBackend();
      let opens = 0;
      backend.openAudioTrack = () => {
        opens += 1;
        return new Promise(() => {}); // never settles, like a suspended Capacitor bridge
      };
      const sink = createNativeLocalSidSink(RATE, backend);
      scheduleChunk(sink, 1);

      // Well inside the deadline: one attempt in flight, and the pump is legitimately waiting on it.
      await vi.advanceTimersByTimeAsync(1000);
      expect(opens).toBe(1);

      // Past the deadline the attempt is abandoned, the pump loop breaks and its `finally` releases
      // the gate, so a later slice can start a fresh pump and try again. Without the deadline the
      // first attempt is still pending, `pumping` never clears, and `opens` stays at 1 forever.
      await vi.advanceTimersByTimeAsync(20_000);
      expect(opens).toBeGreaterThan(1);
      expect(backend.writes).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
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

/**
 * The speaker running dry is the user-facing failure, and only the pipeline can see it: the chunk
 * scheduler counts chunks it handed over late, which on this sink says nothing about whether the
 * ring drained underneath it. `AudioTrack.underrunCount` was already on the wire and nothing read
 * it, so the pinned `audioUnderruns` budget of 0 could not fail for the fault it exists to catch.
 */
describe("the native ring's own underruns reach the engine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts at zero and reports what the pipeline reports", async () => {
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend)!;
    scheduleChunk(sink, 0.5);
    await settle();
    expect(sink.audioUnderruns!()).toBe(0);

    backend.underruns = 4;
    scheduleChunk(sink, 0.5, 0.5);
    await settle();

    expect(sink.audioUnderruns!()).toBe(4);
  });

  it("never walks the count backwards when a read arrives out of order", async () => {
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend)!;
    backend.underruns = 7;
    scheduleChunk(sink, 0.5);
    await settle();
    expect(sink.audioUnderruns!()).toBe(7);

    backend.underruns = 2;
    scheduleChunk(sink, 0.5, 0.5);
    await settle();

    expect(sink.audioUnderruns!()).toBe(7);
  });
});

/**
 * A pipeline that has stopped consuming.
 *
 * `ensureOpen` short-circuits on a flag held here in JavaScript, and nothing ever checked it against
 * the pipeline it describes. Reproduced on a Pixel 4 after a burst of rapid track changes: the app's
 * elapsed clock advanced, `__localSinkDebug()` reported seconds of audio buffered, `dumpsys audio`
 * reported `mMusicActiveMs=0` and no AudioTrack in its players list, and the phone was silent until
 * the app was relaunched.
 */
describe("a native pipeline that stops consuming", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("re-opens the track when the buffered depth stops falling while idle", async () => {
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 0.5);
    await settle();
    const opensBefore = backend.opens.length;
    expect(opensBefore).toBeGreaterThan(0);

    // The pipeline says it is holding audio, and goes on saying exactly that. A working one drains
    // once nothing more is being written.
    backend.bufferedMs = 5000;
    await vi.advanceTimersByTimeAsync(9000);
    await settle();

    // The stalled track is dropped, which is what clears the stale "it is open" belief. It is not
    // re-opened on the spot, because there is nothing to write yet — the next audio does that, and
    // that is the property a listener actually experiences.
    expect(backend.closes).toBeGreaterThan(0);

    backend.bufferedMs = 0;
    scheduleChunk(sink, 0.5, 1);
    await settle();

    expect(backend.opens.length).toBeGreaterThan(opensBefore);
  });

  it("leaves a draining pipeline alone", async () => {
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 0.5);
    await settle();
    const opensBefore = backend.opens.length;

    // Falling depth is a pipeline doing its job, and must never be re-opened underneath the audio.
    backend.bufferedMs = 5000;
    for (let ms = 5000; ms > 0; ms -= 500) {
      backend.bufferedMs = ms;
      await vi.advanceTimersByTimeAsync(500);
      await settle(5);
    }

    expect(backend.closes).toBe(0);
    expect(backend.opens.length).toBe(opensBefore);
  });

  it("does not re-open a pipeline that is simply empty", async () => {
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 0.5);
    await settle();
    const opensBefore = backend.opens.length;

    // Nothing buffered is a tune that has finished, not a pipeline that has stopped consuming.
    backend.bufferedMs = 0;
    await vi.advanceTimersByTimeAsync(9000);
    await settle();

    expect(backend.closes).toBe(0);
    expect(backend.opens.length).toBe(opensBefore);
  });
});

describe("what a stalled track leaves behind", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Dropping the track rebases the written total down onto the playhead, and chunk completions are
  // announced against a clock clamped to that total. Anything still outstanding would therefore sit
  // unfired for audio that no longer exists, and the engine renders more only when it is told a
  // chunk has finished — so a silent pipeline would have become a stalled one.
  it("announces the chunk completions that went with the dropped track", async () => {
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    // A long chunk, with the pipeline reporting nearly all of it still queued ahead of the speaker,
    // so its completion is a long way from due when the stall is detected. A short chunk finishes on
    // its own inside the watchdog's grace period and would pass whether or not anything was fixed.
    const source = scheduleChunk(sink, 30);
    const ended = vi.fn();
    source.onended = ended;
    backend.bufferedMs = 25000;
    await settle();

    expect(ended).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(9000);
    await settle();

    expect(backend.closes).toBeGreaterThan(0);
    expect(ended).toHaveBeenCalled();
  });
});

describe("where the listener's level is applied", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Scaling at the float-to-Int16 conversion is correct and slow: this sink keeps up to twenty
  // seconds of audio scheduled ahead, so a level applied there reaches the speaker twenty seconds
  // after the slider moved. The pipeline attenuates on its way out of the ring instead, which is
  // heard within the AudioTrack's own buffer.
  it("hands the level to the pipeline when it can take it", async () => {
    const backend = createBackend() as FakeBackend & { gains: number[] };
    backend.gains = [];
    backend.setAudioTrackGain = async ({ gain }: { gain: number }) => {
      backend.gains.push(gain);
    };
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 0.5);
    await settle();

    sink!.setGain(0.25);
    await settle();

    expect(backend.gains).toEqual([0.25]);
  });

  it("clamps what it asks the pipeline for, so the level can only attenuate", async () => {
    const backend = createBackend() as FakeBackend & { gains: number[] };
    backend.gains = [];
    backend.setAudioTrackGain = async ({ gain }: { gain: number }) => {
      backend.gains.push(gain);
    };
    const sink = createNativeLocalSidSink(RATE, backend);
    await settle();

    sink!.setGain(4);
    sink!.setGain(-3);
    await settle();

    expect(backend.gains).toEqual([1, 0]);
  });

  // A pipeline too old to know the call must not leave the listener without a volume control.
  it("falls back to scaling at the conversion when the pipeline has no gain call", async () => {
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 0.5);
    await settle();
    const loud = backend.writes.length;

    sink!.setGain(0);
    scheduleChunk(sink, 0.5, 1);
    await settle();

    // Still writing — the fallback attenuates the samples rather than stopping the pump.
    expect(backend.writes.length).toBeGreaterThan(loud);
  });
});

describe("when the pipeline refuses the level", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // The level used to stand the conversion down to unity as soon as the bridge call was *issued*.
  // A rejection arriving afterwards then left nothing attenuating at all, and the listener heard
  // full volume until they happened to move the slider again. The conversion only stands down once
  // the pipeline has confirmed it holds the level.
  it("attenuates at the conversion instead, rather than losing the level", async () => {
    const backend = createBackend() as FakeBackend & { setAudioTrackGain?: (o: { gain: number }) => Promise<void> };
    backend.setAudioTrackGain = async () => {
      throw new Error("no such method");
    };
    const sink = createNativeLocalSidSink(RATE, backend);
    scheduleChunk(sink, 0.5);
    await settle();

    sink!.setGain(0);
    await settle();

    // Silence has to reach the samples themselves, since the pipeline declined to apply it.
    backend.writes.length = 0;
    scheduleChunk(sink, 0.5, 1);
    await settle();
    const written = backend.writes.at(-1);
    expect(written).toBeDefined();
    expect(sinkMasterGainOf(sink!)).toBe(0);
  });

  it("stops asking a pipeline that has already refused", async () => {
    let calls = 0;
    const backend = createBackend() as FakeBackend & { setAudioTrackGain?: (o: { gain: number }) => Promise<void> };
    backend.setAudioTrackGain = async () => {
      calls += 1;
      throw new Error("no such method");
    };
    const sink = createNativeLocalSidSink(RATE, backend);
    await settle();

    sink!.setGain(0.5);
    await settle();
    sink!.setGain(0.25);
    await settle();

    expect(calls).toBe(1);
  });
});

/**
 * A superseded sink must not tear down the track its successor is using.
 *
 * There is one native AudioTrack, and each tune gets a fresh sink object over it. A crossfade
 * deliberately keeps the outgoing sink alive so its tail can ring out under the incoming tune, and
 * closes it on a timer afterwards — `crossfadeMs + 50`, which with the default 1.5 s fade lands a
 * second and a half into the new tune.
 *
 * That close used to flush and close the shared track, throwing away the audio the *new* tune had
 * queued and stopping its output. Measured on a Pixel 4 with the microphone: pressing Next left
 * every other track silent after a fraction of a second — 4 of 8 trials, alternating exactly, with
 * the engine reporting 0.15 s of buffer for the whole of each silent track.
 */
describe("a sink that has been replaced", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves the shared track alone when it is closed after its successor opened", async () => {
    const backend = createBackend();
    const outgoing = createNativeLocalSidSink(RATE, backend);
    await outgoing!.resume?.();
    const incoming = createNativeLocalSidSink(RATE, backend);
    await incoming!.resume?.();
    // The new tune has begun: it is writing, which is what takes the track.
    scheduleChunk(incoming, 0.5);
    await settle(200);

    const closesBefore = backend.closes;
    const flushesBefore = backend.flushes;

    // The crossfade timer fires: the outgoing sink closes, well after the new tune started.
    outgoing!.close();

    expect(backend.closes).toBe(closesBefore);
    expect(backend.flushes).toBe(flushesBefore);
  });

  it("still closes the track when it is the last sink standing", async () => {
    // The ordinary case must keep working, or the track is never released at all.
    const backend = createBackend();
    const only = createNativeLocalSidSink(RATE, backend)!;
    await only.resume?.();

    only.close();

    expect(backend.closes).toBe(1);
  });

  it("does not flush the shared track on behalf of a tune that has been replaced", async () => {
    const backend = createBackend();
    const outgoing = createNativeLocalSidSink(RATE, backend);
    await outgoing!.resume?.();
    const incoming = createNativeLocalSidSink(RATE, backend);
    await incoming!.resume?.();
    scheduleChunk(incoming, 0.5);
    await settle(200);

    const flushesBefore = backend.flushes;
    // A late seek settling on the outgoing tune would otherwise empty the new tune's queue.
    outgoing!.flush?.();
    expect(backend.flushes).toBe(flushesBefore);

    // The current sink may still flush its own audio.
    incoming!.flush?.();
    expect(backend.flushes).toBe(flushesBefore + 1);
  });
});

/**
 * A superseded sink must go quiet, not just stop tearing things down.
 *
 * There is one AudioTrack. Two sinks writing to it do not mix — their slices interleave, and the
 * listener hears the old tune, a fragment of the new one, the old tune again, and so on until the
 * outgoing one runs out. Reported from a Pixel 4 as "instead of a smooth fadeover... that is
 * nonsense", and it is: a shared track cannot carry two streams at once.
 *
 * So being replaced makes a sink inert. It stops writing as well as leaving the track alone.
 */
describe("a superseded sink goes quiet", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes nothing more once another sink has taken the track", async () => {
    const backend = createBackend();
    const outgoing = createNativeLocalSidSink(RATE, backend);
    await outgoing!.resume?.();
    scheduleChunk(outgoing, 0.5);
    await settle(200);

    const incoming = createNativeLocalSidSink(RATE, backend);
    await incoming!.resume?.();
    // The new tune produces its first audio: that write is what takes the track.
    scheduleChunk(incoming, 0.5);
    await settle(200);
    const writesBefore = backend.writes.length;

    // The outgoing tune keeps producing for the length of the crossfade. None of it may reach the
    // track any more, because the track is the new tune's now.
    for (let i = 0; i < 4; i += 1) scheduleChunk(outgoing, 0.5);
    await settle(200);

    expect(backend.writes.length).toBe(writesBefore);
  });

  it("still lets the current sink write", async () => {
    const backend = createBackend();
    const outgoing = createNativeLocalSidSink(RATE, backend);
    await outgoing!.resume?.();
    const incoming = createNativeLocalSidSink(RATE, backend);
    await incoming!.resume?.();

    const writesBefore = backend.writes.length;
    scheduleChunk(incoming, 0.5);
    await settle(200);

    expect(backend.writes.length).toBeGreaterThan(writesBefore);
  });
});

/**
 * A crossfade means both tunes sounding at once.
 *
 * There is one AudioTrack, so two sinks cannot overlap by both writing — their slices interleave.
 * And a sink's gain ramp is applied when a slice is *converted*, so it cannot reach audio that has
 * already been converted and queued. Both routes to an overlap are closed, which is why the
 * transition was heard on a Pixel 4 as a hard cut with no fade at all.
 *
 * So the incoming sink mixes: it takes what the outgoing one had rendered but not yet played and
 * sums it under its own output with a falling ramp. These tests use two constant levels, so an
 * overlap is arithmetic rather than a matter of opinion.
 */
describe("crossfade mixing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A slice of `frames` stereo frames, every sample `value`. */
  const flat = (frames: number, value: number) => {
    const pcm = new Int16Array(frames * 2);
    pcm.fill(value);
    return pcm;
  };

  it("hands over what was rendered but never played, and no more than asked for", async () => {
    const backend = createBackend();
    const outgoing = createNativeLocalSidSink(RATE, backend);
    await outgoing!.resume?.();
    // Far more queued than the crossfade wants: the rest of the tune is not part of the fade.
    for (let i = 0; i < 8; i += 1) scheduleChunk(outgoing, 0.5);

    const tail = outgoing!.takeCrossfadeTail?.(1.0) ?? [];
    const frames = tail.reduce((sum, s) => sum + s.length / 2, 0);
    expect(frames).toBeGreaterThan(0);
    expect(frames).toBeLessThanOrEqual(Math.round(1.5 * RATE));
  });

  it("sums the outgoing tune under the incoming one instead of replacing it", async () => {
    const backend = createBackend();
    const incoming = createNativeLocalSidSink(RATE, backend);
    await incoming!.resume?.();

    // The outgoing tune, as a steady level.
    incoming!.adoptCrossfadeTail?.([flat(RATE, 4000)], 0.5);
    scheduleChunk(incoming, 0.25);
    await settle(200);

    const written = backend.pcm[0]!;
    // The incoming chunk alone is 0.5 full scale. With the outgoing tune folded in at its opening
    // gain of 1, the first frame has to be louder than the incoming tune on its own.
    const alone = Math.round(0.5 * (INT16_MAX - 1));
    expect(written[0]).toBeGreaterThan(alone);
  });

  it("fades the outgoing tune away rather than dropping it", async () => {
    const backend = createBackend();
    const incoming = createNativeLocalSidSink(RATE, backend);
    await incoming!.resume?.();

    incoming!.adoptCrossfadeTail?.([flat(RATE, 8000)], 0.5);
    scheduleChunk(incoming, 0.5);
    await settle(200);

    const written = backend.pcm[0]!;
    const first = written[0] as number;
    const later = written[Math.floor(written.length / 2)] as number;
    // Same incoming level throughout, so any fall is the outgoing tune receding.
    expect(later).toBeLessThan(first);
  });

  it("adds nothing once the fade is over", async () => {
    const backend = createBackend();
    const incoming = createNativeLocalSidSink(RATE, backend);
    await incoming!.resume?.();

    incoming!.adoptCrossfadeTail?.([flat(RATE / 10, 8000)], 0.1);
    scheduleChunk(incoming, 0.5);
    await settle(200);

    const written = backend.pcm[0]!;
    const alone = Math.round(0.5 * (INT16_MAX - 1));
    // The tail is a tenth of a second; the end of a half-second slice is the incoming tune alone.
    expect(written[written.length - 2]).toBe(alone);
  });

  it("clamps rather than wrapping when both tunes peak together", async () => {
    // Two loud tunes summed can exceed full scale. Wrapping an Int16 turns that into a crack.
    const backend = createBackend();
    const incoming = createNativeLocalSidSink(RATE, backend);
    await incoming!.resume?.();

    incoming!.adoptCrossfadeTail?.([flat(RATE, 30000)], 0.5);
    scheduleChunk(incoming, 0.25);
    await settle(200);

    const written = backend.pcm[0]!;
    for (const sample of written) expect(sample).toBeGreaterThan(0);
  });
});

/**
 * The tail has to sound during the gap, not only once the new tune has something of its own.
 *
 * This is the case the first version of the mixing missed, and the tests missed it too because they
 * handed the incoming sink audio immediately. On a device the incoming tune is a second or two from
 * its first chunk, and during that time the outgoing tail is the only audio there is. Folding it
 * only into the incoming tune's own slices meant it was never written at all: the listener heard the
 * old tune, then a gap, then the new one — reported from a Pixel 4 as "there was no transition at
 * all".
 */
describe("the crossfade tail carries the gap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const flat = (frames: number, value: number) => {
    const pcm = new Int16Array(frames * 2);
    pcm.fill(value);
    return pcm;
  };

  it("plays the outgoing tune while the incoming one has nothing to offer", async () => {
    const backend = createBackend();
    const incoming = createNativeLocalSidSink(RATE, backend);
    await incoming!.resume?.();

    // A tail, and not one sample of the new tune. This is the first second after a skip.
    incoming!.adoptCrossfadeTail?.([flat(RATE, 6000)], 1.0);
    await settle(400);

    expect(backend.writes.length).toBeGreaterThan(0);
    const written = backend.pcm[0]!;
    expect(Math.max(...Array.from(written).map(Math.abs))).toBeGreaterThan(1000);
  });

  it("stops once the tail is spent, rather than writing silence for ever", async () => {
    const backend = createBackend();
    const incoming = createNativeLocalSidSink(RATE, backend);
    await incoming!.resume?.();

    incoming!.adoptCrossfadeTail?.([flat(RATE / 10, 6000)], 0.1);
    await settle(400);
    const afterTail = backend.writes.length;
    await settle(400);

    expect(backend.writes.length).toBe(afterTail);
  });
});

describe("a crossfade is one continuous stream of samples", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps the outgoing tune at full level until the incoming one has audio of its own", async () => {
    const backend = createBackend();
    const outgoing = createNativeLocalSidSink(RATE, backend)!;
    scheduleChunk(outgoing, 0.5);
    backend.bufferedMs = 400;
    await settle();
    const tail = outgoing.takeCrossfadeTail!(1.5);

    const incoming = createNativeLocalSidSink(RATE, backend)!;
    backend.pcm.length = 0;
    incoming.adoptCrossfadeTail!(tail.length ? tail : [new Int16Array(RATE).fill(8000)], 1.5);
    await settle(200);

    // Nothing of the incoming tune has been scheduled, so every sample written so far is the
    // outgoing tune's. It must still be at its own level: a fade that ran while the next tune was
    // opening would reach zero before that tune made a sound, which is the gap this removes.
    const written = backend.pcm.flatMap((chunk) => [...chunk]).filter((value) => value !== 0);
    expect(written.length).toBeGreaterThan(0);
    const quietest = Math.min(...written.map(Math.abs));
    const loudest = Math.max(...written.map(Math.abs));
    expect(quietest).toBe(loudest);
  });

  it("raises the incoming tune from silence, so the two ramps are the two halves of one fade", async () => {
    const backend = createBackend();
    const sink = createNativeLocalSidSink(RATE, backend)!;
    // What the engine does when a crossfade is configured: open this tune at the listener's level,
    // blending in over the fade.
    sink.fadeIn!(1000, 1);
    scheduleChunk(sink, 1);
    await settle(400);

    const written = backend.pcm.flatMap((chunk) => [...chunk]);
    expect(written.length).toBeGreaterThan(RATE);
    // A fresh sink's blend gain is already 1, so a fade "to 1" changed nothing and the tune arrived
    // at full level — a crossfade on one side only. The opening samples must be well below the
    // level the tune reaches later.
    const opening = Math.max(...written.slice(0, 400).map(Math.abs));
    const later = Math.max(...written.slice(RATE, RATE + 400).map(Math.abs));
    expect(opening).toBeLessThan(later * 0.25);
    // And it does reach full level rather than staying quiet.
    expect(later).toBeGreaterThan(0);
  });

  it("fades the outgoing tune only once the incoming one is playing", async () => {
    const backend = createBackend();
    const incoming = createNativeLocalSidSink(RATE, backend)!;
    incoming.adoptCrossfadeTail!([new Int16Array(RATE * 2).fill(8000)], 1);
    scheduleChunk(incoming, 1);
    await settle(400);

    const mixed = backend.pcm.flatMap((chunk) => [...chunk]);
    expect(mixed.length).toBeGreaterThan(RATE);
    // The tail is summed under the tune and ramps away, so the level falls across the fade.
    const early = Math.max(...mixed.slice(0, 2000).map(Math.abs));
    const late = Math.max(...mixed.slice(-2000).map(Math.abs));
    expect(late).toBeLessThan(early);
  });

  it("inherits a track that is already open instead of replacing it", async () => {
    const backend = createBackend();
    const first = createNativeLocalSidSink(RATE, backend)!;
    scheduleChunk(first, 0.2);
    await settle();
    expect(backend.opens.length).toBe(1);

    // A second tune over the same backend must write onto the end of the running track. Opening
    // again tears the track down and takes the outgoing tune's committed audio with it, which is
    // heard as a hole at the seam.
    const second = createNativeLocalSidSink(RATE, backend)!;
    scheduleChunk(second, 0.2);
    await settle();
    expect(backend.opens.length).toBe(1);
  });

  it("takes ownership of an inherited track at once, not at the inheritor's first write", async () => {
    // Inheriting the track and owning it are two separate steps, and the gap between them is where a
    // tune goes silent. The inheritor marks itself open the moment it adopts the running track, but
    // the claim used to wait for its first write — and a write does not always follow: a slice that
    // carries only the outgoing tail is dropped when the tail runs out partway through it, because
    // writing the silent remainder would put a hole exactly at the seam. Until the claim lands the
    // previous opener is not superseded, so closing it tears down the track the inheritor is using.
    const backend = createBackend();
    const opener = createNativeLocalSidSink(RATE, backend)!;
    scheduleChunk(opener, 0.2);
    await settle();
    expect(backend.opens.length).toBe(1);

    // The inheritor's only audio is a tail far shorter than one tail slice, so it adopts the track
    // and then writes nothing at all.
    const inheritor = createNativeLocalSidSink(RATE, backend)!;
    const writesBefore = backend.writes.length;
    inheritor.adoptCrossfadeTail!([new Int16Array(500 * 2).fill(8000)], 500 / RATE);
    await settle();
    expect(backend.writes.length).toBe(writesBefore);

    // The opener is finished with and closes. The track must survive, because the inheritor is the
    // one using it now.
    const flushesBefore = backend.flushes;
    const closesBefore = backend.closes;
    opener.close?.();
    await settle();

    expect(backend.closes).toBe(closesBefore);
    expect(backend.flushes).toBe(flushesBefore);

    // And the inheritor can still play through it, without reopening.
    scheduleChunk(inheritor, 0.2);
    await settle();
    expect(backend.writes.length).toBeGreaterThan(writesBefore);
    expect(backend.opens.length).toBe(1);
  });

  it("releases the shared track to its successor without flushing it", async () => {
    const backend = createBackend();
    const outgoing = createNativeLocalSidSink(RATE, backend)!;
    scheduleChunk(outgoing, 0.2);
    await settle();
    const flushesBefore = backend.flushes;
    const closesBefore = backend.closes;

    outgoing.releaseForHandover!();
    await settle();

    expect(backend.flushes).toBe(flushesBefore);
    expect(backend.closes).toBe(closesBefore);
  });
});
