/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocalSidEngine, type LocalSidAudioSink, type LocalSidWorkerLike } from "@/lib/playback/localSidEngine";
import type { LocalSidMainToWorker, LocalSidWorkerToMain } from "@/lib/playback/localSidWorkerProtocol";
import type { AudioScheduleSink, AudioScheduleSource } from "@/lib/playback/localSidChunkScheduler";
import { __resetPhoneAudioOwnership } from "@/lib/audio/phoneAudioOwnership";

vi.mock("@/lib/roms/romStore", () => ({
  loadStoredRoms: () => ({ kernal: new Uint8Array(8192), basic: new Uint8Array(8192) }),
  hasCompleteRomSet: () => true,
}));

/**
 * A seek that lands past what has been rendered, while the pre-render is on its way there.
 *
 * That path deliberately does NOT reposition the live renderer: sending it to the target would
 * re-render the whole tune a second time, which is the cost the pre-render exists to avoid. The
 * consequence is that the live renderer stays sitting at the position the listener just left, and
 * everything it produces from then until the wait ends is that old audio.
 *
 * Nothing stopped it being played. Flushing the queue at the moment of the seek only dropped what
 * was already queued; the renderer refilled it within a chunk. So the listener heard the part of the
 * tune they had seeked away from while the clock, the progress bar and the status all described the
 * target — and the engine's playhead, which is what the transport clock is anchored to, ran on from
 * the target while entirely different audio sounded.
 */

const SAMPLE_RATE = 44100;
const CHANNELS = 2;

class FakeWorker implements LocalSidWorkerLike {
  readonly sent: LocalSidMainToWorker[] = [];
  terminated = false;
  private handler: ((event: MessageEvent<LocalSidWorkerToMain>) => void) | null = null;
  postMessage(message: LocalSidMainToWorker): void {
    this.sent.push(message);
  }
  addEventListener(type: "message" | "error" | "messageerror", handler: unknown): void {
    if (type === "message") this.handler = handler as (event: MessageEvent<LocalSidWorkerToMain>) => void;
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(message: LocalSidWorkerToMain): void {
    this.handler?.({ data: message } as MessageEvent<LocalSidWorkerToMain>);
  }
  ofType<T extends LocalSidMainToWorker["type"]>(type: T) {
    return this.sent.filter((m) => m.type === type);
  }
}

class TestSource implements AudioScheduleSource {
  onended: (() => void) | null = null;
  start(): void {}
  stop(): void {}
}

const makeSink = () => {
  const scheduled: Float32Array[] = [];
  let currentTime = 0;
  const sink: AudioScheduleSink = {
    get currentTime() {
      return currentTime;
    },
    get sampleRate() {
      return SAMPLE_RATE;
    },
    createBuffer: (channels: number, frames: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(frames));
      return { getChannelData: (c: number) => data[c]!, __data: data } as unknown as AudioBuffer;
    },
    createSource: (buffer: AudioBuffer) => {
      scheduled.push((buffer as unknown as { __data: Float32Array[] }).__data[0]!);
      return new TestSource();
    },
  };
  return { sink, scheduled, advance: (seconds: number) => (currentTime += seconds) };
};

/** PCM whose every sample carries `value`, so what reached the speaker is identifiable. */
const pcmOf = (seconds: number, value: number) => {
  const pcm = new Int16Array(Math.round(SAMPLE_RATE * seconds) * CHANNELS);
  pcm.fill(value);
  return pcm;
};

describe("a seek waiting for the pre-render to reach it", () => {
  let worker: FakeWorker;
  let prerenderWorker: FakeWorker;
  let scheduled: Float32Array[];
  let flushes: number;
  let advance: (seconds: number) => number;

  const makeEngine = () => {
    worker = new FakeWorker();
    let handedOut = 0;
    const factory = () => {
      handedOut += 1;
      if (handedOut === 1) return worker;
      prerenderWorker = new FakeWorker();
      return prerenderWorker;
    };
    const { sink, scheduled: s, advance: adv } = makeSink();
    scheduled = s;
    advance = adv;
    flushes = 0;
    return new LocalSidEngine({
      workerFactory: factory,
      chunkSeconds: 0.5,
      targetBufferSeconds: 1.0,
      audioSinkFactory: (): LocalSidAudioSink => ({
        sink,
        resume: vi.fn(),
        close: vi.fn(),
        flush: () => {
          flushes += 1;
        },
      }),
    });
  };

  /** Open a tune and start a pre-render of it, without letting the pre-render reach anything yet. */
  const openWithPrerenderRunning = async (engine: LocalSidEngine) => {
    const play = engine.play(new ArrayBuffer(8), 0, {}, "tune#0");
    worker.emit({ type: "ready", moduleLoadMs: 1 });
    await Promise.resolve();
    worker.emit({ type: "opened", id: 1, sampleRate: SAMPLE_RATE, channels: CHANNELS, tuneInfo: {} } as never);
    await play;
    // A whole-tune pre-render, far longer than the seek target, so the target is genuinely ahead of
    // the render head when the seek is made.
    engine.prerender("tune#0", new ArrayBuffer(8), 0, 300);
  };

  const prerenderId = (engine: LocalSidEngine) => (engine as unknown as { prerenderId: number }).prerenderId;
  const activeId = (engine: LocalSidEngine) => (engine as unknown as { activeId: number }).activeId;

  beforeEach(() => {
    __resetPhoneAudioOwnership();
    localStorage.clear();
  });

  it("takes the waiting path rather than re-rendering, and silences the queue", async () => {
    const engine = makeEngine();
    await openWithPrerenderRunning(engine);
    const seeksBefore = worker.ofType("seek").length;

    await engine.seekTo(200);

    // No worker seek: that is the whole point of waiting for a render already on its way.
    expect(worker.ofType("seek")).toHaveLength(seeksBefore);
    expect(engine.getPendingSeek()).toMatchObject({ targetSeconds: 200 });
    expect(flushes).toBeGreaterThan(0);
  });

  it("does not play the position the listener seeked away from while it waits", async () => {
    const engine = makeEngine();
    await openWithPrerenderRunning(engine);
    await engine.seekTo(200);
    const scheduledBefore = scheduled.length;

    // A chunk the live renderer had in flight when the seek was made. It is audio from the OLD
    // position, so scheduling it plays exactly the wrong part of the tune.
    worker.emit({
      type: "chunk",
      id: activeId(engine),
      pcm: pcmOf(0.5, 1234),
      samples: SAMPLE_RATE * 0.5 * CHANNELS,
      renderMs: 100,
    } as never);

    expect(scheduled).toHaveLength(scheduledBefore);
  });

  it("stops asking the live renderer for work it would only discard", async () => {
    const engine = makeEngine();
    await openWithPrerenderRunning(engine);
    await engine.seekTo(200);
    const rendersBefore = worker.ofType("render").length;

    worker.emit({
      type: "chunk",
      id: activeId(engine),
      pcm: pcmOf(0.5, 1234),
      samples: SAMPLE_RATE * 0.5 * CHANNELS,
      renderMs: 100,
    } as never);

    // Both renderers run on their own thread but share the device. Rendering audio that is thrown
    // away lengthens the wait the listener is watching.
    expect(worker.ofType("render")).toHaveLength(rendersBefore);
  });

  it("does not end the tune when the live renderer runs off the old position", async () => {
    const onEnded = vi.fn();
    const engine = makeEngine();
    const play = engine.play(new ArrayBuffer(8), 0, { onEnded }, "tune#0");
    worker.emit({ type: "ready", moduleLoadMs: 1 });
    await Promise.resolve();
    worker.emit({ type: "opened", id: 1, sampleRate: SAMPLE_RATE, channels: CHANNELS, tuneInfo: {} } as never);
    await play;
    engine.prerender("tune#0", new ArrayBuffer(8), 0, 300);
    await engine.seekTo(200);

    worker.emit({ type: "end", id: activeId(engine) } as never);

    // The tune the listener is waiting for has not finished; ending it here would skip a track
    // mid-wait, from a position they had already left.
    expect(onEnded).not.toHaveBeenCalled();
  });

  it("resumes at the target the moment the pre-render covers it", async () => {
    const engine = makeEngine();
    await openWithPrerenderRunning(engine);
    await engine.seekTo(2);
    expect(scheduled).toHaveLength(0);

    // The pre-render passes the target.
    prerenderWorker.emit({
      type: "prerender-chunk",
      id: prerenderId(engine),
      pcm: pcmOf(4, 4321),
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      seconds: 4,
    } as never);

    expect(engine.getPendingSeek()).toBeNull();
    expect(scheduled.length).toBeGreaterThan(0);
    // And from the position asked for: the playhead is what the transport clock is anchored to.
    expect(engine.getStats().positionSeconds).toBeCloseTo(2, 1);
  });

  it("waits for a cushion past the target rather than resuming with nothing behind it", async () => {
    // The chunk that crosses the target leaves nothing after it, so resuming exactly there starts
    // playback with no headroom: the speaker consumes a second per second and the renderer is only
    // just ahead.
    const engine = makeEngine();
    await openWithPrerenderRunning(engine);
    await engine.seekTo(2);

    // Covers the target, but only just.
    prerenderWorker.emit({
      type: "prerender-chunk",
      id: prerenderId(engine),
      pcm: pcmOf(2.1, 1111),
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      seconds: 2.1,
    } as never);

    expect(engine.getPendingSeek()).not.toBeNull();
    expect(scheduled).toHaveLength(0);
  });

  it("keeps following the pre-render instead of handing back to a renderer that must start over", async () => {
    // The defect this replaces, measured on a Pixel 4: after seventy seconds of waiting the listener
    // got about a second of music and then another minute of silence. The buffer that satisfies the
    // seek ends barely past the target, and handing back to the live renderer there asks a renderer
    // that cannot rewind to reach three minutes in — the whole tune again, with the audio gated shut.
    const engine = makeEngine();
    await openWithPrerenderRunning(engine);
    await engine.seekTo(2);
    const seeksBefore = worker.ofType("seek").length;

    prerenderWorker.emit({
      type: "prerender-chunk",
      id: prerenderId(engine),
      pcm: pcmOf(8, 4321),
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      seconds: 8,
    } as never);
    const afterResume = scheduled.length;
    expect(afterResume).toBeGreaterThan(0);
    // No hand-off: the thread already producing this audio keeps producing it.
    expect(worker.ofType("seek")).toHaveLength(seeksBefore);
    expect(engine.debugState()).toMatchObject({ followingPrerender: true });

    // Playback drains what it has, then the next chunk extends the very buffer it is reading from.
    advance(6);
    prerenderWorker.emit({
      type: "prerender-chunk",
      id: prerenderId(engine),
      pcm: pcmOf(8, 4321),
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      seconds: 16,
    } as never);

    expect(scheduled.length).toBeGreaterThan(afterResume);
  });

  it("adopts the finished render, so running off its end is the end of the tune", async () => {
    const onEnded = vi.fn();
    const engine = makeEngine();
    const play = engine.play(new ArrayBuffer(8), 0, { onEnded }, "tune#0");
    worker.emit({ type: "ready", moduleLoadMs: 1 });
    await Promise.resolve();
    worker.emit({ type: "opened", id: 1, sampleRate: SAMPLE_RATE, channels: CHANNELS, tuneInfo: {} } as never);
    await play;
    engine.prerender("tune#0", new ArrayBuffer(8), 0, 8);
    await engine.seekTo(2);
    prerenderWorker.emit({
      type: "prerender-chunk",
      id: prerenderId(engine),
      pcm: pcmOf(8, 4321),
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      seconds: 8,
    } as never);
    expect(engine.debugState()).toMatchObject({ followingPrerender: true });

    prerenderWorker.emit({
      type: "prerendered",
      id: prerenderId(engine),
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      seconds: 8,
    } as never);

    // The buffer has stopped growing, so what is in hand is the whole of it.
    expect(engine.debugState()).toMatchObject({ followingPrerender: false, cached: { partial: false } });
    // And it is played to the end rather than handed to the live renderer.
    expect(worker.ofType("seek")).toHaveLength(0);
  });

  it("stops following a render that finished with nothing to show for it", async () => {
    // Otherwise the flag stays set and the pump waits for a chunk that can no longer arrive. The
    // only thing that would notice is the stall watchdog, seconds later and by killing the worker.
    const engine = makeEngine();
    await openWithPrerenderRunning(engine);
    await engine.seekTo(2);
    prerenderWorker.emit({
      type: "prerender-chunk",
      id: prerenderId(engine),
      pcm: pcmOf(8, 4321),
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      seconds: 8,
    } as never);
    expect(engine.debugState()).toMatchObject({ followingPrerender: true });
    const seeksBefore = worker.ofType("seek").length;

    // The accumulated buffer was taken away before the completion arrived — a second pre-render
    // starting for another tune does exactly this.
    (engine as unknown as { prerenderAccumulated: Int16Array }).prerenderAccumulated = new Int16Array(0);
    prerenderWorker.emit({
      type: "prerendered",
      id: prerenderId(engine),
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      seconds: 8,
    } as never);

    expect(engine.debugState()).toMatchObject({ followingPrerender: false });
    // And it went back to the live renderer rather than waiting on a thread that has finished.
    expect(worker.ofType("seek").length).toBeGreaterThan(seeksBefore);
  });

  it("sends the live renderer after the target when the pre-render dies before its first chunk", async () => {
    // The listener has been promised a position that nothing is now working towards, and with no
    // chunk delivered there is no cache to resume from either. Left alone this was silence until the
    // stall watchdog noticed, seconds later and by discarding the worker.
    const engine = makeEngine();
    await openWithPrerenderRunning(engine);
    await engine.seekTo(120);
    expect(engine.getPendingSeek()).not.toBeNull();
    const seeksBefore = worker.ofType("seek").length;

    (engine as unknown as { onPrerenderWorkerFailure(reason: string): void }).onPrerenderWorkerFailure("thread gone");

    expect(engine.getPendingSeek()).toBeNull();
    expect(worker.ofType("seek").length).toBeGreaterThan(seeksBefore);
    expect(worker.ofType("seek").at(-1)).toMatchObject({ positionSeconds: 120 });
  });

  it("hands back to the live renderer if the pre-render thread dies mid-follow", async () => {
    // No further chunk can extend the buffer being played from, so the only remaining source of the
    // rest of the tune is the live renderer — expensive, and better than falling silent.
    const engine = makeEngine();
    await openWithPrerenderRunning(engine);
    await engine.seekTo(2);
    prerenderWorker.emit({
      type: "prerender-chunk",
      id: prerenderId(engine),
      pcm: pcmOf(8, 4321),
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      seconds: 8,
    } as never);
    const seeksBefore = worker.ofType("seek").length;

    (engine as unknown as { onPrerenderWorkerFailure(reason: string): void }).onPrerenderWorkerFailure("thread gone");

    expect(engine.debugState()).toMatchObject({ followingPrerender: false });
    expect(worker.ofType("seek").length).toBeGreaterThan(seeksBefore);
    expect(worker.ofType("seek").at(-1)).toMatchObject({ positionSeconds: 8 });
  });

  /**
   * Two waits look identical from outside, and both are legitimate.
   *
   * One is waiting for the pre-render to reach the target, which the progress bar reports. The other
   * is the worker re-rendering the tune to get there — silent, unreported, and fifteen to twenty
   * seconds on a Pixel 4. Anything that treats a motionless playhead as a fault has to be able to tell
   * either from a genuine stall, or the auto-advance deadline runs down through a slow seek and skips
   * the track the listener is waiting to hear.
   */
  describe("isSeeking", () => {
    it("is false while a tune is simply playing", async () => {
      const engine = makeEngine();
      await openWithPrerenderRunning(engine);

      expect(engine.isSeeking()).toBe(false);
    });

    it("is true while a seek waits for the pre-render", async () => {
      const engine = makeEngine();
      await openWithPrerenderRunning(engine);
      await engine.seekTo(200);

      expect(engine.isSeeking()).toBe(true);
    });

    it("is true while the worker is re-rendering towards a seek", async () => {
      // No pre-render running, so the seek falls through to the worker: nothing on screen says so.
      const engine = makeEngine();
      const play = engine.play(new ArrayBuffer(8), 0, {}, "tune#0");
      worker.emit({ type: "ready", moduleLoadMs: 1 });
      await Promise.resolve();
      worker.emit({ type: "opened", id: 1, sampleRate: SAMPLE_RATE, channels: CHANNELS, tuneInfo: {} } as never);
      await play;

      void engine.seekTo(120);
      await Promise.resolve();

      expect(engine.getPendingSeek()).toBeNull();
      expect(engine.isSeeking()).toBe(true);
    });

    it("is false again once the worker acknowledges", async () => {
      const engine = makeEngine();
      const play = engine.play(new ArrayBuffer(8), 0, {}, "tune#0");
      worker.emit({ type: "ready", moduleLoadMs: 1 });
      await Promise.resolve();
      worker.emit({ type: "opened", id: 1, sampleRate: SAMPLE_RATE, channels: CHANNELS, tuneInfo: {} } as never);
      await play;

      const seek = engine.seekTo(120);
      await Promise.resolve();
      const posted = worker.ofType("seek").at(-1) as { id: number } | undefined;
      worker.emit({ type: "seeked", id: posted!.id } as never);
      await seek;

      expect(engine.isSeeking()).toBe(false);
    });
  });
});

/**
 * Skipping to the next tune while a seek is still waiting for the pre-render.
 *
 * The pending seek belongs to the tune that was playing. Opening a different tune does not clear
 * it, and it gates three things at once: `pump()` refuses to ask for chunks, the chunk and end
 * handlers discard whatever does arrive, and the stall watchdog is deliberately disabled while a
 * seek is outstanding. Together that is a tune which plays the start-up buffer already scheduled,
 * about half a second, and is then silent for good — with nothing to notice, so no recovery and no
 * advance to the next track. Stop and Play clears it, because `stop()` does reset the field.
 */
describe("skipping while a seek is still waiting", () => {
  let worker: FakeWorker;
  let scheduled: Float32Array[];

  const makeEngine = () => {
    worker = new FakeWorker();
    let handedOut = 0;
    const factory = () => {
      handedOut += 1;
      if (handedOut === 1) return worker;
      return new FakeWorker();
    };
    const { sink, scheduled: s } = makeSink();
    scheduled = s;
    return new LocalSidEngine({
      workerFactory: factory,
      chunkSeconds: 0.5,
      targetBufferSeconds: 1.0,
      audioSinkFactory: (): LocalSidAudioSink => ({
        sink,
        resume: vi.fn(),
        close: vi.fn(),
        flush: vi.fn(),
      }),
    });
  };

  const open = async (engine: LocalSidEngine, key: string, first: boolean) => {
    const before = worker.ofType("open").length;
    const play = engine.play(new ArrayBuffer(8), 0, {}, key);
    if (first) {
      worker.emit({ type: "ready", moduleLoadMs: 1 });
    }
    // `play()` awaits the module load before it posts anything, so the message is not there yet.
    // Wait for it rather than guessing, and read the id the engine actually used rather than
    // counting opens: a pre-render consumes one from the same sequence.
    for (let tick = 0; tick < 20 && worker.ofType("open").length === before; tick += 1) {
      await Promise.resolve();
    }
    const opens = worker.ofType("open");
    const openId = (opens[opens.length - 1] as unknown as { id: number }).id;
    worker.emit({ type: "opened", id: openId, sampleRate: SAMPLE_RATE, channels: CHANNELS, tuneInfo: {} } as never);
    await play;
  };

  beforeEach(() => {
    __resetPhoneAudioOwnership();
    localStorage.clear();
  });

  it("does not leave the next tune gated by the previous tune's pending seek", async () => {
    const engine = makeEngine();
    await open(engine, "tune#0", true);
    engine.prerender("tune#0", new ArrayBuffer(8), 0, 300);

    // Seek past the render head: this is the path that parks a pending seek and waits. Asserted on
    // the stored seek, not merely on `isSeeking()`, because the whole test is about what happens to
    // that stored value — a setup that quietly took the re-render path instead would prove nothing.
    await engine.seekTo(120);
    expect(engine.getPendingSeek()).toMatchObject({ targetSeconds: 120 });

    // Now skip. The listener has left that tune, and with it the position they were waiting for.
    await open(engine, "tune#1", false);

    // Nothing about the new tune is waiting for anything.
    expect(engine.isSeeking()).toBe(false);

    // And it actually plays: chunks asked for, chunks delivered, audio scheduled.
    const before = scheduled.length;
    const opens = worker.ofType("open");
    worker.emit({
      type: "chunk",
      id: (opens[opens.length - 1] as unknown as { id: number }).id,
      pcm: pcmOf(0.5, 1000),
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
    } as never);
    expect(scheduled.length).toBeGreaterThan(before);
  });

  it("lets the stall watchdog judge the new tune again", async () => {
    // The watchdog stands down while a seek is outstanding, which is right for the tune that is
    // seeking and wrong for every tune after it: a leftover left the new tune with nothing watching
    // it at all, which is why the silence never repaired itself.
    const engine = makeEngine();
    await open(engine, "tune#0", true);
    engine.prerender("tune#0", new ArrayBuffer(8), 0, 300);
    await engine.seekTo(120);
    await open(engine, "tune#1", false);

    const state = engine.debugState() as unknown as { pendingSeek: unknown };
    expect(state.pendingSeek).toBeNull();
  });
});

/**
 * The render budget, and what happens when discarded chunks never give their slot back.
 *
 * `pump()` counts a render the moment it posts one and stops posting at `MAX_IN_FLIGHT_RENDERS`.
 * The count is given back when the chunk is *accepted* — but a chunk can be discarded on arrival
 * for three good reasons: it belongs to a tune that has been skipped past, or a seek is in flight,
 * or a seek is waiting on the pre-render. Each of those returned before the decrement, so every
 * discarded chunk permanently spent one slot of the budget.
 *
 * Skipping is what makes it reach the limit: every render still in flight when the next tune opens
 * comes back with the previous tune's id and is dropped. Once the budget is gone `pump()` cannot
 * ask for audio again, the scheduler drains, and the tune goes silent while the transport clock —
 * which is not driven by the renderer — carries on. This is the "plays for half a second, then
 * silence, and only Stop and Play brings it back" report.
 */
describe("the in-flight render budget", () => {
  let worker: FakeWorker;

  const makeEngine = () => {
    worker = new FakeWorker();
    let handedOut = 0;
    const factory = () => {
      handedOut += 1;
      if (handedOut === 1) return worker;
      return new FakeWorker();
    };
    const { sink } = makeSink();
    return new LocalSidEngine({
      workerFactory: factory,
      chunkSeconds: 0.5,
      targetBufferSeconds: 1.0,
      audioSinkFactory: (): LocalSidAudioSink => ({
        sink,
        resume: vi.fn(),
        close: vi.fn(),
        flush: vi.fn(),
      }),
    });
  };

  const open = async (engine: LocalSidEngine, key: string, first: boolean) => {
    const before = worker.ofType("open").length;
    const play = engine.play(new ArrayBuffer(8), 0, {}, key);
    if (first) worker.emit({ type: "ready", moduleLoadMs: 1 });
    for (let tick = 0; tick < 20 && worker.ofType("open").length === before; tick += 1) {
      await Promise.resolve();
    }
    const opens = worker.ofType("open");
    const openId = (opens[opens.length - 1] as unknown as { id: number }).id;
    worker.emit({ type: "opened", id: openId, sampleRate: SAMPLE_RATE, channels: CHANNELS, tuneInfo: {} } as never);
    await play;
  };

  const inFlight = (engine: LocalSidEngine) => (engine as unknown as { inFlightRenders: number }).inFlightRenders;

  beforeEach(() => {
    __resetPhoneAudioOwnership();
    localStorage.clear();
  });

  it("gives the slot back for a chunk that belongs to a tune already skipped past", async () => {
    const engine = makeEngine();
    await open(engine, "tune#0", true);
    const staleId = (worker.ofType("render").at(-1) as unknown as { id: number } | undefined)?.id ?? 1;
    expect(inFlight(engine)).toBeGreaterThan(0);

    // Skip. The renders posted for the previous tune are still on their way.
    await open(engine, "tune#1", false);

    const budgetBefore = inFlight(engine);
    worker.emit({
      type: "chunk",
      id: staleId,
      pcm: pcmOf(0.5, 7),
      samples: SAMPLE_RATE * 0.5 * CHANNELS,
      renderMs: 10,
    } as never);

    // The chunk itself is rightly thrown away — it is the wrong tune's audio — but the render it
    // came from is finished, and the budget has to know that.
    expect(inFlight(engine)).toBeLessThan(budgetBefore);
  });

  it("keeps asking for audio after a skip rather than running out of budget", async () => {
    const engine = makeEngine();
    await open(engine, "tune#0", true);

    // Skip repeatedly, letting each tune's in-flight renders come back late, as they do in life.
    for (let round = 0; round < 6; round += 1) {
      const staleIds = worker.ofType("render").map((m) => (m as unknown as { id: number }).id);
      await open(engine, `tune#${round + 1}`, false);
      for (const id of staleIds.slice(-2)) {
        worker.emit({
          type: "chunk",
          id,
          pcm: pcmOf(0.5, 7),
          samples: SAMPLE_RATE * 0.5 * CHANNELS,
          renderMs: 10,
        } as never);
      }
    }

    // The budget must still have room, or nothing will ever be rendered again.
    const rendersBefore = worker.ofType("render").length;
    (engine as unknown as { pump: () => void }).pump();
    expect(worker.ofType("render").length).toBeGreaterThan(rendersBefore);
  });
});

/**
 * "No silent playback unless the listener asked for silence", enforced at runtime.
 *
 * Every other counter the engine keeps describes supply and demand — frames written, buffer depth,
 * renders in flight — and all of them look healthy while a tune renders a flat line. Two separate
 * defects have now shipped where the app believed it was playing and the room stayed quiet, so the
 * desired state is asserted continuously and restored when it drifts, rather than being assumed
 * from the absence of an error.
 */
describe("silence self-healing", () => {
  let worker: FakeWorker;
  let silentFault: boolean;
  let silenceResets: number;

  const makeEngine = () => {
    worker = new FakeWorker();
    silentFault = false;
    silenceResets = 0;
    let handedOut = 0;
    const factory = () => {
      handedOut += 1;
      if (handedOut === 1) return worker;
      return new FakeWorker();
    };
    const { sink } = makeSink();
    return new LocalSidEngine({
      workerFactory: factory,
      chunkSeconds: 0.5,
      targetBufferSeconds: 4,
      audioSinkFactory: (): LocalSidAudioSink => ({
        sink,
        resume: vi.fn(),
        close: vi.fn(),
        flush: vi.fn(),
        isSilentFault: () => silentFault,
        resetSilence: () => {
          silenceResets += 1;
        },
      }),
    });
  };

  const openTune = async (engine: LocalSidEngine) => {
    const play = engine.play(new ArrayBuffer(8), 0, {}, "tune#0");
    worker.emit({ type: "ready", moduleLoadMs: 1 });
    for (let tick = 0; tick < 20 && worker.ofType("open").length === 0; tick += 1) await Promise.resolve();
    const opens = worker.ofType("open");
    worker.emit({
      type: "opened",
      id: (opens[opens.length - 1] as unknown as { id: number }).id,
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      tuneInfo: {},
    } as never);
    await play;
  };

  const tick = (engine: LocalSidEngine) => (engine as unknown as { checkLiveness: () => void }).checkLiveness();

  beforeEach(() => {
    __resetPhoneAudioOwnership();
    localStorage.clear();
  });

  it("acts when the speaker has been handed a flat signal for too long", async () => {
    const engine = makeEngine();
    await openTune(engine);
    const opensBefore = worker.ofType("open").length;

    silentFault = true;
    tick(engine);

    // Recovery is the same one a stall gets: throw the worker away and re-open the tune.
    expect(silenceResets).toBeGreaterThan(0);
    expect(worker.terminated || worker.ofType("open").length > opensBefore).toBe(true);
  });

  it("leaves a muted tune alone, because that silence is what was asked for", async () => {
    const engine = makeEngine();
    await openTune(engine);
    engine.setMuted(true);

    // Opening a tune resets the clock, so compare against that rather than against zero.
    const resetsAfterOpen = silenceResets;
    silentFault = true;
    tick(engine);

    expect(silenceResets).toBe(resetsAfterOpen);
  });

  it("leaves a tune turned fully down alone for the same reason", async () => {
    const engine = makeEngine();
    await openTune(engine);
    engine.setVolume(0);

    const resetsAfterOpen = silenceResets;
    silentFault = true;
    tick(engine);

    expect(silenceResets).toBe(resetsAfterOpen);
  });

  it("does nothing while the output is audible", async () => {
    const engine = makeEngine();
    await openTune(engine);
    const resetsAfterOpen = silenceResets;
    silentFault = false;
    tick(engine);
    expect(silenceResets).toBe(resetsAfterOpen);
  });

  it("gives a new tune its own silence clock", async () => {
    // The previous tune's quiet ending must not count against the one that follows it.
    const engine = makeEngine();
    await openTune(engine);
    expect(silenceResets).toBeGreaterThan(0);
  });
});
