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
 * a blend — anything else is indistinguishable from the overlap bug above.
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

  it("fades the outgoing tune out when a blend is configured", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem("c64u_playback_crossfade_ms", "1500");
      const faded: number[] = [];
      const sink = {
        currentTime: 0,
        sampleRate: 48000,
        createBuffer: (channels: number, frames: number) => {
          const data = Array.from({ length: channels }, () => new Float32Array(frames));
          return { getChannelData: (c: number) => data[c]! } as unknown as AudioBuffer;
        },
        createSource: () => ({ start() {}, stop() {}, onended: null }) as never,
      };
      let closed = false;
      const engine = new LocalSidEngine({
        workerFactory: () => new FakeWorker() as never,
        audioSinkFactory: (() => ({
          sink,
          resume: () => {},
          fadeOut: (ms: number) => faded.push(ms),
          fadeIn: () => {},
          close: () => {
            closed = true;
          },
        })) as never,
      });

      await engine.play(new ArrayBuffer(8), 0);
      await engine.play(new ArrayBuffer(8), 1);

      expect(faded).toEqual([1500]);
      // Still ringing out, not yet closed...
      expect(closed).toBe(false);
      vi.advanceTimersByTime(1600);
      // ...and closed once the ramp has run, so it cannot linger as a source.
      expect(closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
