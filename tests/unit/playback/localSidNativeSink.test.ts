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
    readAudioStats: async () => ({ bufferedMs: backend.bufferedMs, underruns: backend.underruns }),
  };
  return backend;
};

const RATE = 48000;
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
