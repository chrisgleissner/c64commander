/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Scrubbing, under abuse.
 *
 * Every defect this file guards against was found by dragging the bar on a real device, and every one
 * of them looked like "the song stopped": a seek whose acknowledgement never came left `seekPending`
 * set, and while that is set every rendered chunk is discarded, so playback goes silent for the rest of
 * the tune. Others were subtler — running off the end of a cached lead-in reported the tune as
 * finished; a seek past the lead-in served the cache anyway and resumed from the wrong place.
 *
 * Single-case tests kept missing these because they only appear under sequences: back, forward, back
 * again, faster than each seek completes. So this drives sequences, and after every step asserts the
 * invariants that must hold no matter what the listener does:
 *
 *   1. the tune is never reported finished unless it really ended;
 *   2. playback is never left permanently gated — either a seek is genuinely in flight, or it is not;
 *   3. the reported position is the one asked for, not one read back from a stale clock;
 *   4. nothing accumulates without bound.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocalSidEngine, type LocalSidAudioSink, type LocalSidWorkerLike } from "@/lib/playback/localSidEngine";
import type { LocalSidMainToWorker, LocalSidWorkerToMain } from "@/lib/playback/localSidWorkerProtocol";
import type {
  AudioScheduleBuffer,
  AudioScheduleSink,
  AudioScheduleSource,
} from "@/lib/playback/localSidChunkScheduler";
import { __resetPhoneAudioOwnership } from "@/lib/audio/phoneAudioOwnership";
import { __resetRenderThroughput } from "@/lib/playback/renderThroughput";

vi.mock("@/lib/roms/romStore", () => ({
  loadStoredRoms: () => ({ kernal: new Uint8Array(8192), basic: new Uint8Array(8192) }),
  hasCompleteRomSet: () => true,
}));

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
/** Long enough that a seek can plausibly land outside what is rendered. */
const TUNE_SECONDS = 120;

class FakeWorker implements LocalSidWorkerLike {
  readonly sent: LocalSidMainToWorker[] = [];
  private handler: ((event: MessageEvent<LocalSidWorkerToMain>) => void) | null = null;
  postMessage(message: LocalSidMainToWorker): void {
    this.sent.push(message);
  }
  addEventListener(type: "message" | "error" | "messageerror", handler: unknown): void {
    if (type === "message") this.handler = handler as (event: MessageEvent<LocalSidWorkerToMain>) => void;
  }
  terminate(): void {}
  emit(message: LocalSidWorkerToMain): void {
    this.handler?.({ data: message } as MessageEvent<LocalSidWorkerToMain>);
  }
  ofType<T extends LocalSidMainToWorker["type"]>(type: T) {
    return this.sent.filter((m) => m.type === type) as Extract<LocalSidMainToWorker, { type: T }>[];
  }
}

const makeSink = () => {
  const scheduled: number[] = [];
  const sink: AudioScheduleSink = {
    currentTime: 0,
    sampleRate: SAMPLE_RATE,
    createBuffer: (channels: number, frames: number): AudioScheduleBuffer => ({
      getChannelData: () => new Float32Array(frames),
    }),
    createSource: (): AudioScheduleSource => ({
      start: () => scheduled.push(1),
      stop: () => {},
      onended: null,
    }),
  };
  return { sink, scheduled };
};

interface Harness {
  engine: LocalSidEngine;
  worker: FakeWorker;
  warm: () => FakeWorker | null;
  flushes: () => number;
}

const pcmFor = (seconds: number) => new Int16Array(Math.floor(SAMPLE_RATE * seconds) * CHANNELS);

const start = async (): Promise<Harness> => {
  const worker = new FakeWorker();
  let warm: FakeWorker | null = null;
  let handedOut = 0;
  let flushes = 0;
  const { sink } = makeSink();
  const engine = new LocalSidEngine({
    workerFactory: () => {
      handedOut += 1;
      if (handedOut === 1) return worker;
      warm = new FakeWorker();
      return warm;
    },
    chunkSeconds: 0.5,
    targetBufferSeconds: 2,
    audioSinkFactory: (): LocalSidAudioSink => ({
      sink,
      resume: vi.fn(),
      close: vi.fn(),
      flush: () => {
        flushes += 1;
      },
    }),
  });
  const play = engine.play(new ArrayBuffer(8), 0, {}, "soak#0");
  worker.emit({ type: "ready", moduleLoadMs: 1 });
  await Promise.resolve();
  worker.emit({ type: "opened", id: 1, sampleRate: SAMPLE_RATE, channels: CHANNELS, tuneInfo: {} } as never);
  await play;
  return { engine, worker, warm: () => warm, flushes: () => flushes };
};

/** Advance the current tune's pre-render to `seconds` of coverage. */
const renderTo = (h: Harness, seconds: number) => {
  const id = (h.engine as unknown as { prerenderId: number }).prerenderId;
  h.worker.emit({
    type: "prerender-chunk",
    id,
    pcm: pcmFor(seconds),
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    seconds,
  } as never);
};

/** Acknowledge whatever seek the worker was last asked for, as the real one eventually does. */
const acknowledgeSeek = (h: Harness) => {
  const posted = h.worker.ofType("seek").at(-1) as { id: number } | undefined;
  if (posted) h.worker.emit({ type: "seeked", id: posted.id } as never);
};

interface EngineState {
  seekPending: number | null;
  endReceived: boolean;
  cachedTunes: number;
  pendingWarms: number;
}
const stateOf = (h: Harness) => h.engine.debugState() as unknown as EngineState;

/** The invariants, checked after every step of every sequence. */
const assertInvariants = (h: Harness, note: string) => {
  const state = stateOf(h);
  // A tune that has not run out must never be reported finished — that is a track skipping itself.
  expect(state.endReceived, `endReceived after ${note}`).toBe(false);
  // Nothing may accumulate without bound: the cache window is three tunes, warms are one at a time.
  expect(state.cachedTunes, `cachedTunes after ${note}`).toBeLessThanOrEqual(3);
  expect(state.pendingWarms, `pendingWarms after ${note}`).toBeLessThanOrEqual(2);
};

describe("scrubbing under abuse", () => {
  beforeEach(() => {
    __resetPhoneAudioOwnership();
    __resetRenderThroughput();
    localStorage.clear();
  });

  const sequences: { name: string; targets: number[] }[] = [
    { name: "forward in small steps", targets: [5, 10, 15, 20] },
    { name: "backward in small steps", targets: [20, 15, 10, 5] },
    { name: "alternating either side of the render head", targets: [5, 40, 6, 45, 7] },
    { name: "jump to the far end and back", targets: [110, 2, 108, 3] },
    { name: "hammering one spot", targets: [30, 30, 30, 30, 30] },
    { name: "walking the whole tune", targets: [10, 30, 50, 70, 90, 110] },
    { name: "back to the very start repeatedly", targets: [0, 50, 0, 60, 0] },
    { name: "tiny nudges", targets: [12, 12.2, 12.4, 12.1, 11.9] },
  ];

  for (const { name, targets } of sequences) {
    it(`survives ${name}, serving from the cache`, async () => {
      const h = await start();
      // Fully rendered: every seek should be answerable from the buffer.
      h.engine.prerender("soak#0", new ArrayBuffer(8), 0, TUNE_SECONDS);
      renderTo(h, TUNE_SECONDS);
      const id = (h.engine as unknown as { prerenderId: number }).prerenderId;
      h.worker.emit({
        type: "prerendered",
        id,
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        seconds: TUNE_SECONDS,
      } as never);

      for (const target of targets) {
        await h.engine.seekTo(target);
        assertInvariants(h, `seek to ${target}`);
        expect(h.engine.getStats().positionSeconds).toBeCloseTo(target, 1);
      }
      // Never gated shut at the end of the run: that is the failure a listener hears as silence.
      expect(stateOf(h).seekPending).toBeNull();
    });

    it(`survives ${name}, with only part of the tune rendered`, async () => {
      const h = await start();
      h.engine.prerender("soak#0", new ArrayBuffer(8), 0, TUNE_SECONDS);
      renderTo(h, 25);

      for (const target of targets) {
        const seek = h.engine.seekTo(target);
        // The real worker answers eventually; a test that never answers is testing the timeout.
        acknowledgeSeek(h);
        await seek;
        assertInvariants(h, `seek to ${target} (partly rendered)`);
      }
      // Either the seek landed, or it is waiting for the renderer — never stuck in between.
      const awaiting = h.engine.getAwaitedSeekSeconds();
      expect(awaiting === null || awaiting >= 0).toBe(true);
    });

    it(`survives ${name} faster than the worker answers`, async () => {
      // The case single tests never covered: a new seek arrives before the last is acknowledged, which
      // is exactly what a drag does. A superseded seek must be resolved, not dropped — its resolver
      // also gates chunk delivery.
      const h = await start();
      for (const target of targets) void h.engine.seekTo(target);
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      acknowledgeSeek(h);
      for (let i = 0; i < 10; i += 1) await Promise.resolve();

      assertInvariants(h, `unacknowledged ${name}`);
      expect(stateOf(h).seekPending).toBeNull();
    });
  }

  it("holds at the target rather than drifting on while the renderer catches up", async () => {
    // Letting playback carry on from the old position meant the listener heard one place while the bar
    // showed another, with no way to tell whether the drag had done anything.
    const h = await start();
    h.engine.prerender("soak#0", new ArrayBuffer(8), 0, TUNE_SECONDS);
    renderTo(h, 20);
    const flushesBefore = h.flushes();

    await h.engine.seekTo(80);

    expect(h.engine.getAwaitedSeekSeconds()).toBeCloseTo(80, 1);
    // Queued audio for the old position is dropped, so nothing from before the drag is heard.
    expect(h.flushes()).toBeGreaterThan(flushesBefore);
  });

  it("resumes the moment the renderer passes the awaited position", async () => {
    const h = await start();
    h.engine.prerender("soak#0", new ArrayBuffer(8), 0, TUNE_SECONDS);
    renderTo(h, 20);
    await h.engine.seekTo(40);
    expect(h.engine.getAwaitedSeekSeconds()).toBeCloseTo(40, 1);

    renderTo(h, 45);

    expect(h.engine.getAwaitedSeekSeconds()).toBeNull();
    assertInvariants(h, "resume after catch-up");
  });

  it("does not wait when the position is already rendered", async () => {
    const h = await start();
    h.engine.prerender("soak#0", new ArrayBuffer(8), 0, TUNE_SECONDS);
    renderTo(h, 60);

    await h.engine.seekTo(30);

    expect(h.engine.getAwaitedSeekSeconds()).toBeNull();
    expect(h.engine.getStats().positionSeconds).toBeCloseTo(30, 1);
  });

  it("replaces an awaited position when the listener drags again", async () => {
    const h = await start();
    h.engine.prerender("soak#0", new ArrayBuffer(8), 0, TUNE_SECONDS);
    renderTo(h, 15);

    await h.engine.seekTo(90);
    await h.engine.seekTo(50);

    // The newest drag wins; the old target must not resurrect when the renderer passes it.
    expect(h.engine.getAwaitedSeekSeconds()).toBeCloseTo(50, 1);
    renderTo(h, 55);
    expect(h.engine.getAwaitedSeekSeconds()).toBeNull();
    expect(stateOf(h).endReceived).toBe(false);
  });

  it("reports how far it has rendered, so the wait can be shown", async () => {
    const h = await start();
    h.engine.prerender("soak#0", new ArrayBuffer(8), 0, TUNE_SECONDS);
    renderTo(h, 12);
    expect(h.engine.getRenderedSeconds()).toBeCloseTo(12, 1);
    renderTo(h, 34);
    expect(h.engine.getRenderedSeconds()).toBeCloseTo(34, 1);
  });

  it("keeps the reported position on the target through a burst of drags", async () => {
    const h = await start();
    h.engine.prerender("soak#0", new ArrayBuffer(8), 0, TUNE_SECONDS);
    renderTo(h, TUNE_SECONDS);
    const id = (h.engine as unknown as { prerenderId: number }).prerenderId;
    h.worker.emit({
      type: "prerendered",
      id,
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      seconds: TUNE_SECONDS,
    } as never);

    // Fifty drags, alternating direction, as fast as they can be issued.
    for (let i = 0; i < 50; i += 1) {
      const target = i % 2 === 0 ? 10 + i : 100 - i;
      await h.engine.seekTo(target);
      expect(h.engine.getStats().positionSeconds).toBeCloseTo(target, 1);
    }
    assertInvariants(h, "fifty drags");
    expect(stateOf(h).seekPending).toBeNull();
  });

  it("does not leak worker seeks when every drag is answerable from the buffer", async () => {
    // The pre-render exists so that scrubbing costs nothing. A seek that quietly fell back to the
    // worker would still work and would still be a regression — the tune would go silent for seconds.
    const h = await start();
    h.engine.prerender("soak#0", new ArrayBuffer(8), 0, TUNE_SECONDS);
    renderTo(h, TUNE_SECONDS);
    const id = (h.engine as unknown as { prerenderId: number }).prerenderId;
    h.worker.emit({
      type: "prerendered",
      id,
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      seconds: TUNE_SECONDS,
    } as never);
    const before = h.worker.ofType("seek").length;

    for (const target of [5, 60, 20, 90, 1, 115]) await h.engine.seekTo(target);

    expect(h.worker.ofType("seek")).toHaveLength(before);
  });

  it("keeps the tune's cache key through the teardown that opening performs", async () => {
    // Opening a tune tears the previous one down, and that teardown clears the key. Assigning it once,
    // before the open, left it null for the whole tune — and with it null the cache cannot be found by
    // any of the three things that need it: the progress bar's rendered fill, a seek that could have
    // been instant, and the seek that waits for the renderer instead of racing it. All three silently
    // took their slow path, which on the device was a stuck seek and a frozen fill.
    const h = await start();

    expect((h.engine.debugState() as unknown as { currentKey: string | null }).currentKey).toBe("soak#0");
  });
});
