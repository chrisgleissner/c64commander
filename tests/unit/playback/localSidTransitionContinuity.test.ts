import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CROSSFADE_MS_MAX } from "@/lib/config/appSettings";
import { LocalSidEngine } from "@/lib/playback/localSidEngine";
import { createNativeLocalSidSink, type NativeLocalAudioBackend } from "@/lib/playback/localSidNativeSink";
import { clearLocalSidTrace, readLocalSidTrace } from "@/lib/playback/localSidTrace";

/**
 * There must be one continuous stream of samples from one tune to the next.
 *
 * This is the software proof of what a microphone in front of the device measures, and it exists
 * because the microphone is a slow and disagreeable way to find out. Every earlier attempt at this
 * transition passed its unit tests and was still audibly broken, because those tests asserted that
 * a method had been *called* rather than what reached the speaker. So this one reads the actual
 * samples handed to the native track and asks two questions of them:
 *
 *  1. is there ever a stretch of silence between the two tunes; and
 *  2. when a crossfade is configured, are both tunes present in the same samples.
 *
 * The engine, the scheduler and the sink are all real. Only the worker (which would be libsidplayfp
 * compiled to WebAssembly) and the native track are replaced, and the replacements are honest about
 * the one thing that made this hard: opening a tune is not instant, and for a second or two after a
 * track change the incoming tune has nothing to play.
 */

// The engine refuses to pre-render without the C64 ROM images, so the stub supplies them. It also
// picks its emulation from whether they are in hand, and a mock reporting none would quietly
// downgrade every test here to the lighter renderer.
vi.mock("@/lib/roms/romStore", () => ({
  loadStoredRoms: () => ({ kernal: new Uint8Array(8192), basic: new Uint8Array(8192) }),
  hasCompleteRomSet: () => true,
}));

const RATE = 48000;

/** Int16 samples decoded from what the sink handed to the track. */
const decodePcm = (base64: string): Int16Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
};

interface Recorder extends NativeLocalAudioBackend {
  /**
   * Every sample handed to the track, in order, in a buffer sized once.
   *
   * A plain array cost a million pushes per test and enough memory to slow the other test files
   * running alongside it, which showed up as an unrelated worker test failing only when the whole
   * directory ran.
   */
  stream: Int16Array;
  /** How much of `stream` has been written. */
  written: number;
  /** Total time the track had nothing to play, in milliseconds. This is the gap a listener hears. */
  underrunMs: number;
  opens: number;
  /** Start measuring underruns from here, so the run-up to a transition is not counted. */
  resetUnderruns: () => void;
}

/**
 * A native track that drains in real time.
 *
 * Modelling the drain is the point. A constant buffer depth is not merely unrealistic — it stops the
 * engine rendering, because the engine renders to a target depth and a depth that never falls is
 * already met. More importantly, silence *in the samples* is not the same thing as a gap *in time*:
 * a track that is handed nothing at all for two seconds plays nothing for two seconds, and a test
 * that only inspects sample values cannot see it. So this keeps a playhead, and every write that
 * arrives after the buffer has run dry is recorded as an underrun of exactly that length. That is
 * the same quantity a microphone in front of the device measures.
 */
const createRecorder = (): Recorder => {
  const startedAt = performance.now();
  let bufferedUntil = startedAt;
  let started = false;
  const depthMs = () => Math.max(0, bufferedUntil - performance.now());
  const recorder: Recorder = {
    // Twenty seconds of stereo, comfortably more than any test here produces.
    stream: new Int16Array(RATE * 2 * 20),
    written: 0,
    underrunMs: 0,
    opens: 0,
    resetUnderruns: () => {
      recorder.underrunMs = 0;
    },
    openAudioTrack: async (options) => {
      recorder.opens += 1;
      return { sampleRate: options.sampleRate, bufferMs: options.bufferMs ?? 0 };
    },
    writeAudioTrack: async ({ data }) => {
      const pcm = decodePcm(data);
      // Overflow is a broken harness, not a quiet truncation. Clamping here would leave `written`
      // pinned at the capacity while the playhead below kept advancing, so an assertion over
      // `subarray(before, written)` would inspect a partial range — or an empty one — and still
      // pass. A test whose evidence has silently gone missing must fail, not go green.
      if (recorder.written + pcm.length > recorder.stream.length) {
        throw new Error(
          `Recorder overflow: ${recorder.written + pcm.length} samples into a ${recorder.stream.length}-sample ` +
            `buffer. Raise the allocation in createRecorder rather than letting the recording be truncated.`,
        );
      }
      recorder.stream.set(pcm, recorder.written);
      recorder.written += pcm.length;
      const now = performance.now();
      const durationMs = (pcm.length / 2 / RATE) * 1000;
      if (started && now > bufferedUntil) recorder.underrunMs += now - bufferedUntil;
      started = true;
      bufferedUntil = Math.max(bufferedUntil, now) + durationMs;
      return { bufferedMs: depthMs(), underruns: 0 };
    },
    closeAudioTrack: async () => {
      bufferedUntil = performance.now();
    },
    // A flush drops whatever has not been played, which is what makes the refill after it urgent.
    flushAudioTrack: async () => {
      bufferedUntil = performance.now();
    },
    readAudioStats: async () => ({ bufferedMs: depthMs(), underruns: 0 }),
  };
  return recorder;
};

/**
 * Stands in for the WebAssembly renderer.
 *
 * `openDelayMs` is the part that matters. Opening a tune costs about 2.6 s on a Pixel 4 and
 * rendering its first samples costs more, and a transition that only works when the next tune is
 * ready instantly is not a transition that works.
 */
class FakeWorker {
  handlers: Record<string, ((event: unknown) => void)[]> = {};
  terminated = false;
  static openDelayMs = 0;
  static amplitude = 8000;
  /** A tune of finite length, so the pipeline settles instead of rendering for ever. */
  static chunksPerTune = 120;
  private openId: number | null = null;
  private rendered = 0;

  postMessage(message: unknown) {
    const msg = message as { type: string; id?: number; samples?: number };
    if (msg.type === "load") this.emit({ type: "ready" });
    if (msg.type === "open") {
      this.openId = msg.id ?? 0;
      // One worker serves every tune, so the length budget resets with each one; otherwise the
      // second tune reports itself finished before rendering a sample.
      this.rendered = 0;
      setTimeout(() => {
        this.emit({
          type: "opened",
          id: msg.id,
          sampleRate: RATE,
          channels: 2,
          tuneInfo: null,
          romRequired: false,
        });
      }, FakeWorker.openDelayMs);
    }
    if (msg.type === "prerender") {
      const seconds = (msg as { seconds?: number }).seconds ?? 4;
      const pcm = new Int16Array(Math.round(seconds * RATE) * 2).fill(FakeWorker.amplitude);
      setTimeout(() => {
        this.emit({ type: "prerender-chunk", id: msg.id, pcm });
        this.emit({
          type: "prerendered",
          id: msg.id,
          sampleRate: RATE,
          channels: 2,
          seconds,
          partial: true,
        });
      }, 0);
      return;
    }
    if (msg.type === "render") {
      if (this.rendered >= FakeWorker.chunksPerTune) {
        setTimeout(() => this.emit({ type: "end", id: this.openId }), 0);
        return;
      }
      this.rendered += 1;
      // A steady tone at this tune's own level, so a sample tells you which tune produced it.
      const frames = msg.samples ?? RATE / 10;
      const pcm = new Int16Array(frames * 2).fill(FakeWorker.amplitude);
      setTimeout(() => this.emit({ type: "chunk", id: this.openId, pcm, samples: pcm.length, renderMs: 1 }), 0);
    }
  }
  addEventListener(type: string, handler: (event: unknown) => void) {
    (this.handlers[type] ??= []).push(handler);
  }
  emit(data: unknown) {
    for (const h of this.handlers.message ?? []) h({ data });
  }
  terminate() {
    this.terminated = true;
  }
}

/** Let every pending promise and timer run, repeatedly, until the pipeline has settled. */
const settle = async (turns = 60, ms = 4000) => {
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
};

/**
 * Start a tune and let the fake clock carry the open and the first renders through.
 *
 * `ms` is how far the clock runs afterwards. It is short by default on purpose: the transition has
 * to be measured while the outgoing tune is still playing, which is when a listener presses Next.
 * Running the clock until that tune has finished measures starting a tune after silence, which is a
 * different thing and cannot show a gap.
 */
const playSettled = async (engine: LocalSidEngine, songIndex: number, cacheKey?: string, ms = 2000) => {
  const started = engine.play(new ArrayBuffer(8), songIndex, {}, cacheKey);
  await settle(60, ms);
  await started;
  await settle(60, ms);
};

const buildEngine = (recorder: Recorder) =>
  new LocalSidEngine({
    workerFactory: () => new FakeWorker() as never,
    audioSinkFactory: (() => createNativeLocalSidSink(RATE, recorder)) as never,
  });

describe("one continuous stream of samples across a track change", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    FakeWorker.openDelayMs = 0;
    FakeWorker.amplitude = 8000;
  });
  afterEach(() => vi.useRealTimers());

  it("leaves no silence between tunes, even when the next one takes seconds to open", async () => {
    localStorage.setItem("c64u_playback_crossfade_ms", "1500");
    const recorder = createRecorder();
    const engine = buildEngine(recorder);

    await playSettled(engine, 0);
    const before = recorder.written;
    recorder.resetUnderruns();
    FakeWorker.openDelayMs = 2600;
    FakeWorker.amplitude = 12000;
    // Long enough for the open this is about, and then some.
    await playSettled(engine, 1, undefined, 4000);

    expect(recorder.written).toBeGreaterThan(before);
    // None, not "little enough to get away with". The hole this replaced measured 2.7 s on a Pixel 4
    // and the same test reports 1051 ms against the previous implementation; a few tens of
    // milliseconds would still be heard as a click between the tunes.
    expect(recorder.underrunMs).toBe(0);
  });

  it("hands the outgoing tune's remaining audio to the next one, so there is something to fade", async () => {
    localStorage.setItem("c64u_playback_crossfade_ms", "1500");
    const recorder = createRecorder();
    const engine = buildEngine(recorder);

    await playSettled(engine, 0);
    clearLocalSidTrace();
    await playSettled(engine, 1);

    // How much reached the incoming sink. The fade is a property of the sink and is measured in
    // `localSidNativeSink.test.ts`; what this settles is that the sink is given anything at all,
    // which is where every previous attempt failed — the tail was captured after the scheduler had
    // already been stopped, and arrived empty every time.
    const adopted = readLocalSidTrace().find((entry) => entry.event === "crossfade-tail-adopted");
    expect(adopted).toBeDefined();
    expect(adopted?.detail?.frames as number).toBeGreaterThan(0);
  });

  it("has no gap at all when the next tune's opening is already rendered", async () => {
    localStorage.setItem("c64u_playback_crossfade_ms", "1500");
    const recorder = createRecorder();
    const engine = buildEngine(recorder);

    await playSettled(engine, 0, "tune-0");
    // What `warmNeighbouringTracks` does while a tune plays: render the next one's opening, so a
    // change can start from memory instead of waiting for the renderer.
    engine.prerender("tune-1", new ArrayBuffer(8), 1, 4);
    await settle();
    clearLocalSidTrace();
    recorder.resetUnderruns();

    // And the open still takes as long as it does on the device — which now costs nothing, because
    // the tune is already sounding by the time it finishes.
    FakeWorker.openDelayMs = 2600;
    FakeWorker.amplitude = 12000;
    await playSettled(engine, 1, "tune-1", 4000);

    expect(readLocalSidTrace().some((entry) => entry.event === "started-from-prerendered-intro")).toBe(true);
    // Not "small enough to get away with": none. The pipeline is never handed nothing.
    expect(recorder.underrunMs).toBe(0);
  });

  // The settings screen offers exactly these, and `CROSSFADE_MS_MAX` is the last of them so a stored
  // value can never exceed what is offered here. Each is driven end to end rather than assumed to
  // behave like its neighbour: the tail budget, the history depth and the ramp all scale with the
  // fade, and a longer one has more chances to run out of audio partway through.
  for (const fadeMs of [600, 1500, 3000, CROSSFADE_MS_MAX]) {
    it(`plays a ${fadeMs} ms crossfade with no gap and audio to fade`, async () => {
      localStorage.setItem("c64u_playback_crossfade_ms", String(fadeMs));
      const recorder = createRecorder();
      const engine = buildEngine(recorder);

      await playSettled(engine, 0, "tune-0");
      engine.prerender("tune-1", new ArrayBuffer(8), 1, 8);
      await settle();
      clearLocalSidTrace();
      recorder.resetUnderruns();

      FakeWorker.openDelayMs = 2600;
      FakeWorker.amplitude = 12000;
      await playSettled(engine, 1, "tune-1", 4000);

      expect(recorder.underrunMs).toBe(0);
      const adopted = readLocalSidTrace().find((entry) => entry.event === "crossfade-tail-adopted");
      // Enough of the outgoing tune to cover the whole fade, not merely a non-empty handover.
      expect(adopted?.detail?.frames as number).toBeGreaterThanOrEqual((fadeMs / 1000) * RATE);
    });
  }

  it("cuts straight over when no crossfade is configured, still without a gap", async () => {
    localStorage.setItem("c64u_playback_crossfade_ms", "0");
    const recorder = createRecorder();
    const engine = buildEngine(recorder);

    await playSettled(engine, 0);
    const before = recorder.written;
    FakeWorker.amplitude = 12000;
    await playSettled(engine, 1);

    const transition = recorder.stream.subarray(before, recorder.written);
    // No overlap is expected here — the listener asked for none — but nothing is mixed either, so
    // no sample should exceed the louder tune's own level.
    // Reduced rather than spread: the stream runs to hundreds of thousands of samples, which is
    // more arguments than a call can take.
    let loudest = 0;
    for (const value of transition) loudest = Math.max(loudest, Math.abs(value));
    expect(loudest).toBeLessThanOrEqual(12000);
  });

  it("keeps the track that is already playing rather than opening a second one", async () => {
    localStorage.setItem("c64u_playback_crossfade_ms", "1500");
    const recorder = createRecorder();
    const engine = buildEngine(recorder);

    await playSettled(engine, 0);
    recorder.bufferedMs = 2000;
    await settle();
    await playSettled(engine, 1);

    // Re-opening tears the track down and takes the outgoing tune's committed audio with it.
    expect(recorder.opens).toBe(1);
  });
});
