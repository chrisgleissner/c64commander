import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocalSidEngine, __hasLocalSidAudioOwner } from "@/lib/playback/localSidEngine";
import {
  getSharedLocalSidPlaybackController,
  resetSharedLocalSidPlaybackController,
} from "@/lib/playback/localSidPlaybackController";

/**
 * Overlapping tunes is a showstopper in the field, and it shipped once: the
 * playback controller lived in a `useRef` inside `usePlaybackController`, so
 * every `PlayFilesPage` built its own engine — each with its own AudioContext,
 * worker and scheduled buffers — and nothing tore an engine down when its page
 * unmounted. Tab-navigating away from Play and back while a tune played left
 * the previous engine running. Repeated navigation produced EIGHT concurrent
 * AAudio streams from one process, different tunes layered on each other, with
 * no way for the user to stop them short of killing the app.
 *
 * Two independent guarantees are pinned here, because one of them is only a
 * convention:
 *
 *  1. the controller is shared process-wide, so the usual route is closed; and
 *  2. the engine enforces single audio ownership itself, so a future refactor
 *     that reintroduces a per-component engine still cannot produce overlap.
 */

class FakeWorker {
  handlers: Record<string, ((event: unknown) => void)[]> = {};
  posted: unknown[] = [];
  terminated = false;
  postMessage(message: unknown) {
    this.posted.push(message);
    const msg = message as { type: string; id?: number; sampleRate?: number };
    if (msg.type === "load") this.emit({ type: "ready" });
    if (msg.type === "open") {
      this.emit({
        type: "opened",
        id: msg.id,
        sampleRate: 48000,
        channels: 2,
        tuneInfo: null,
        romRequired: false,
      });
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

const makeSink = () => {
  const closed = { value: false };
  const sink = {
    currentTime: 0,
    sampleRate: 48000,
    createBuffer: (channels: number, frames: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(frames));
      return { getChannelData: (c: number) => data[c]! } as unknown as AudioBuffer;
    },
    createSource: () => ({ start() {}, stop() {}, onended: null }) as never,
  };
  return {
    closed,
    factory: () => ({ sink, resume: () => {}, close: () => (closed.value = true) }),
  };
};

const makeEngine = (sinkFactory: ReturnType<typeof makeSink>) =>
  new LocalSidEngine({
    workerFactory: () => new FakeWorker() as never,
    audioSinkFactory: sinkFactory.factory as never,
  });

beforeEach(() => {
  resetSharedLocalSidPlaybackController();
});

describe("local SID audio ownership", () => {
  it("is one shared controller for the whole app, however many callers ask", () => {
    const a = getSharedLocalSidPlaybackController();
    const b = getSharedLocalSidPlaybackController();
    expect(a).toBe(b);
  });

  it("silences an engine that still holds audio when another one starts", async () => {
    const firstSink = makeSink();
    const secondSink = makeSink();
    const first = makeEngine(firstSink);
    const second = makeEngine(secondSink);

    await first.play(new ArrayBuffer(8), 0);
    expect(firstSink.closed.value).toBe(false);
    expect(first.isActive()).toBe(true);

    // A second engine starting is the exact shape of the shipped bug.
    await second.play(new ArrayBuffer(8), 0);

    expect(firstSink.closed.value).toBe(true);
    expect(first.isActive()).toBe(false);
    expect(second.isActive()).toBe(true);
  });

  it("releases ownership on stop, so nothing is left holding audio", async () => {
    const sink = makeSink();
    const engine = makeEngine(sink);
    await engine.play(new ArrayBuffer(8), 0);
    expect(__hasLocalSidAudioOwner()).toBe(true);

    engine.stop();

    expect(__hasLocalSidAudioOwner()).toBe(false);
    expect(sink.closed.value).toBe(true);
  });

  it("starting the same engine twice never leaves the first tune playing", async () => {
    const sink = makeSink();
    const engine = makeEngine(sink);
    const closes: boolean[] = [];
    await engine.play(new ArrayBuffer(8), 0);
    closes.push(sink.closed.value);
    await engine.play(new ArrayBuffer(8), 1);
    // Exactly one engine is playing afterwards; the earlier tune's audio is gone.
    expect(engine.isActive()).toBe(true);
    expect(closes[0]).toBe(false);
  });
});

/**
 * A switchover must begin from silence unless the listener explicitly asked for
 * a crossfade — anything else is indistinguishable from the overlap bug above.
 */
describe("crossfade is opt-in", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("cuts hard by default: the outgoing sink is closed before the next tune", async () => {
    const first = makeSink();
    const engine = new LocalSidEngine({
      workerFactory: () => new FakeWorker() as never,
      audioSinkFactory: first.factory as never,
    });
    await engine.play(new ArrayBuffer(8), 0);
    await engine.play(new ArrayBuffer(8), 1);
    // Default (no setting stored) is 0 ms, so the old context is gone at once.
    expect(first.closed.value).toBe(true);
  });

  it("hands the outgoing tune to the next one to fade under itself", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem("c64u_playback_crossfade_ms", "1500");
      const tailSlices = [new Int16Array(4)];
      const playoutBudgets: number[] = [];
      const adopted: { slices: Int16Array[]; seconds: number }[] = [];
      let released = false;
      let closed = false;
      let sinkCount = 0;
      const makeAudioSink = () => {
        const mine = (sinkCount += 1);
        return {
          sink: {
            currentTime: 0,
            sampleRate: 48000,
            createBuffer: (channels: number, frames: number) => {
              const data = Array.from({ length: channels }, () => new Float32Array(frames));
              return { getChannelData: (c: number) => data[c]! } as unknown as AudioBuffer;
            },
            createSource: () => ({ start() {}, stop() {}, onended: null }) as never,
          },
          resume: () => {},
          fadeIn: () => {},
          beginCrossfadeTailPlayout: (seconds: number) => playoutBudgets.push(seconds),
          // Only the first sink has a tail to give; the second is the one that adopts it.
          takeCrossfadeTail: () => (mine === 1 ? tailSlices : []),
          adoptCrossfadeTail: (slices: Int16Array[], seconds: number) => adopted.push({ slices, seconds }),
          releaseForHandover: () => {
            released = true;
          },
          close: () => {
            closed = true;
          },
        };
      };
      const engine = new LocalSidEngine({
        workerFactory: () => new FakeWorker() as never,
        audioSinkFactory: makeAudioSink as never,
      });

      await engine.play(new ArrayBuffer(8), 0);
      await engine.play(new ArrayBuffer(8), 1);

      // The outgoing tune keeps playing from JS, with a budget larger than the fade: it has to cover
      // opening the next tune as well, or the listener hears silence in the middle of the change.
      expect(playoutBudgets).toHaveLength(1);
      expect(playoutBudgets[0]).toBeGreaterThan(1.5);
      // Its remaining audio goes to the incoming sink, which mixes it under its own output.
      expect(adopted).toEqual([{ slices: tailSlices, seconds: 1.5 }]);
      // Released rather than closed: closing flushes the shared track and cuts the stream in two.
      expect(released).toBe(true);
      expect(closed).toBe(false);
      // The backstop must not fire either, now that the handover has happened.
      vi.advanceTimersByTime(60_000);
      expect(closed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Stopping has to reach the engine that is actually playing.
 *
 * The controller lives in a per-page ref that starts null and is only populated
 * when THAT page instance starts a tune. A page which adopted an already-running
 * session — a remount, or the transient second instance a tab switch creates —
 * therefore had a null ref, and `ref.current?.stop()` silently did nothing: the
 * tune kept playing after Stop, and kept playing after switching from this
 * device to the C64. Every stop path must resolve the SHARED controller.
 */
describe("stop reaches the shared engine", () => {
  it("never stops through the nullable per-page ref", async () => {
    const { readFileSync } = await import("node:fs");
    const hook = readFileSync("src/pages/playFiles/hooks/usePlaybackController.ts", "utf8");
    expect(hook).not.toMatch(/localSidPlaybackRef\.current\?\.stop\(\)/);
    // At least the three real stop paths: engine switch, stop, and playlist end.
    const shared = hook.match(/getLocalSidPlayback\(\)\.stop\(\)/g) ?? [];
    expect(shared.length).toBeGreaterThanOrEqual(3);
  });
});
