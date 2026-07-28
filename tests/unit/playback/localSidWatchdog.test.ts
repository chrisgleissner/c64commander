/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The on-device engine's liveness watchdog.
 *
 * The render loop has no supervisor of its own: `pump()` asks the worker for a chunk, the chunk is
 * scheduled, and that chunk finishing pumps the next. A worker that stops answering `render`
 * therefore starves the scheduler silently — `endReceived` stays false, so the tune never "ends"
 * either, and the engine sits with `isActive()` true producing nothing while the Play page's wall
 * clock counts on. Measured on a Pixel 4 against a c64u: after a burst of hold-to-seek gestures the
 * scrubbed tune was silent for the rest of its duration.
 *
 * These tests drive that starvation directly — the fake sink's clock is the audio clock, so
 * advancing it past what has been scheduled *is* the buffer draining — and pin both halves of the
 * contract: it fires when the engine has genuinely gone quiet, and it stays out of the way in every
 * situation where silence is correct.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { LocalSidEngine, type LocalSidAudioSink, type LocalSidWorkerLike } from "@/lib/playback/localSidEngine";
import type { LocalSidMainToWorker, LocalSidWorkerToMain } from "@/lib/playback/localSidWorkerProtocol";
import type { AudioScheduleSink, AudioScheduleSource } from "@/lib/playback/localSidChunkScheduler";

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const STALL_MS = 5000;

class FakeWorker implements LocalSidWorkerLike {
  readonly sent: LocalSidMainToWorker[] = [];
  terminated = false;
  private handler: ((event: MessageEvent<LocalSidWorkerToMain>) => void) | null = null;
  postMessage(message: LocalSidMainToWorker): void {
    this.sent.push(message);
  }
  addEventListener(type: string, handler: (...args: never[]) => void): void {
    if (type === "message") this.handler = handler as typeof this.handler;
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(message: LocalSidWorkerToMain): void {
    this.handler?.({ data: message } as MessageEvent<LocalSidWorkerToMain>);
  }
  sentOfType<T extends LocalSidMainToWorker["type"]>(type: T): Extract<LocalSidMainToWorker, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<LocalSidMainToWorker, { type: T }>[];
  }
}

class TestSource implements AudioScheduleSource {
  onended: (() => void) | null = null;
  start(): void {}
  stop(): void {}
}

/** The audio clock. Advancing it is what drains the scheduler's buffer. */
class FakeClock {
  currentTime = 0;
}

const buildSink = (clock: FakeClock): AudioScheduleSink => ({
  get currentTime() {
    return clock.currentTime;
  },
  get sampleRate() {
    return SAMPLE_RATE;
  },
  createBuffer: (_channels: number, frames: number) => ({ getChannelData: () => new Float32Array(frames) }),
  createSource: () => new TestSource(),
});

/** An engine wired to a fresh worker per `ensureWorker`, so a restart is observable. */
const makeEngine = () => {
  const workers: FakeWorker[] = [];
  const clock = new FakeClock();
  const engine = new LocalSidEngine({
    workerFactory: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    chunkSeconds: 0.5,
    targetBufferSeconds: 1.0,
    audioSinkFactory: (): LocalSidAudioSink => ({ sink: buildSink(clock), resume: vi.fn(), close: vi.fn() }),
  });
  return { engine, workers, clock, latest: () => workers[workers.length - 1] };
};

const chunk = (frames: number) => new Int16Array(frames * CHANNELS);

/** play → ready → opened, leaving the engine live with a scheduler. */
const startTune = async (engine: LocalSidEngine, workers: FakeWorker[]) => {
  const play = engine.play(new ArrayBuffer(64), 0, {});
  await vi.advanceTimersByTimeAsync(0);
  workers[workers.length - 1].emit({ type: "ready", moduleLoadMs: 1 });
  await vi.advanceTimersByTimeAsync(0);
  workers[workers.length - 1].emit({
    type: "opened",
    id: 1,
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    tuneInfo: null,
    romRequired: false,
  });
  await play;
};

/** One second of audio on the timeline, so there is something to starve. */
const deliverChunk = (worker: FakeWorker) => {
  worker.emit({ type: "chunk", id: 1, pcm: chunk(SAMPLE_RATE), samples: SAMPLE_RATE * CHANNELS, renderMs: 10 });
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LocalSidEngine — liveness watchdog", () => {
  it("re-opens a stalled tune and resumes where it fell silent", async () => {
    const { engine, workers, clock } = makeEngine();
    await startTune(engine, workers);
    const first = workers[0];
    deliverChunk(first);

    // The worker goes quiet: the audio clock runs past everything scheduled, so the buffer empties
    // and no further chunk arrives to pump the next one.
    clock.currentTime = 30;
    await vi.advanceTimersByTimeAsync(STALL_MS + 1500);

    expect(first.terminated).toBe(true);
    expect(workers.length).toBe(2);

    // The replacement worker is driven through the same handshake the engine expects.
    const second = workers[1];
    second.emit({ type: "ready", moduleLoadMs: 1 });
    await vi.advanceTimersByTimeAsync(0);
    const opens = second.sentOfType("open");
    expect(opens.length).toBe(1);
    second.emit({
      type: "opened",
      id: opens[0].id,
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      tuneInfo: null,
      romRequired: false,
    });
    await vi.advanceTimersByTimeAsync(0);

    // Resumed where it stopped rather than restarted from the top.
    const seeks = second.sentOfType("seek");
    expect(seeks.length).toBe(1);
    expect(seeks[0].positionSeconds).toBeGreaterThan(0);
  });

  it("leaves a healthy tune alone", async () => {
    const { engine, workers, clock } = makeEngine();
    await startTune(engine, workers);
    const worker = workers[0];

    // Audio keeps arriving as the clock advances — exactly what a working pipeline looks like.
    for (let second = 0; second < 12; second += 1) {
      deliverChunk(worker);
      clock.currentTime += 1;
      await vi.advanceTimersByTimeAsync(1000);
    }

    expect(worker.terminated).toBe(false);
    expect(workers.length).toBe(1);
  });

  it("leaves a paused tune alone, however long the pause", async () => {
    const { engine, workers, clock } = makeEngine();
    await startTune(engine, workers);
    deliverChunk(workers[0]);
    await engine.pause();

    // A pause is silence by request. The buffer is empty and nothing is being scheduled, which is
    // the same shape as a stall and must not be mistaken for one.
    clock.currentTime = 30;
    await vi.advanceTimersByTimeAsync(STALL_MS * 4);

    expect(workers[0].terminated).toBe(false);
    expect(workers.length).toBe(1);
  });

  it("gives a resumed tune the same grace a fresh start gets", async () => {
    const { engine, workers, clock } = makeEngine();
    await startTune(engine, workers);
    deliverChunk(workers[0]);
    await engine.pause();
    clock.currentTime = 30;
    await vi.advanceTimersByTimeAsync(STALL_MS * 4);
    await engine.resume();

    // Judged on how long it has been quiet SINCE resuming, not on the length of the pause.
    await vi.advanceTimersByTimeAsync(STALL_MS - 1500);
    expect(workers.length).toBe(1);
  });

  it("leaves a finished tune alone", async () => {
    const { engine, workers, clock } = makeEngine();
    await startTune(engine, workers);
    deliverChunk(workers[0]);
    workers[0].emit({ type: "end", id: 1 });

    // A tune that has run out is supposed to stop producing audio.
    clock.currentTime = 30;
    await vi.advanceTimersByTimeAsync(STALL_MS * 3);

    expect(workers[0].terminated).toBe(false);
    expect(workers.length).toBe(1);
  });

  it("leaves a tune alone while it still has audio queued", async () => {
    const { engine, workers } = makeEngine();
    await startTune(engine, workers);
    deliverChunk(workers[0]);

    // The clock does not advance, so a full second stays buffered ahead of it. Nothing new is
    // scheduled in that time, but nothing needs to be.
    await vi.advanceTimersByTimeAsync(STALL_MS * 3);

    expect(workers[0].terminated).toBe(false);
    expect(workers.length).toBe(1);
  });

  it("gives a tune one recovery, not an endless restart loop", async () => {
    const { engine, workers, clock } = makeEngine();
    await startTune(engine, workers);
    deliverChunk(workers[0]);

    clock.currentTime = 30;
    await vi.advanceTimersByTimeAsync(STALL_MS + 1500);
    expect(workers.length).toBe(2);

    // The replacement never answers either, so it stalls a second time.
    clock.currentTime = 90;
    await vi.advanceTimersByTimeAsync(STALL_MS * 4);

    // Still two: the second stall is left to the playlist's own advance rather than spending the
    // rest of the track restarting.
    expect(workers.length).toBe(2);
  });

  it("says it has given up, so the playlist can move on", async () => {
    const { engine, workers, clock } = makeEngine();
    const onUnrecoverable = vi.fn();

    const play = engine.play(new ArrayBuffer(64), 0, { onUnrecoverable });
    await vi.advanceTimersByTimeAsync(0);
    workers[0].emit({ type: "ready", moduleLoadMs: 1 });
    await vi.advanceTimersByTimeAsync(0);
    workers[0].emit({
      type: "opened",
      id: 1,
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      tuneInfo: null,
      romRequired: false,
    });
    await play;
    deliverChunk(workers[0]);

    // First stall: the engine tries to repair itself and says nothing yet.
    clock.currentTime = 30;
    await vi.advanceTimersByTimeAsync(STALL_MS + 1500);
    expect(onUnrecoverable).not.toHaveBeenCalled();

    // The replacement never answers either, so the tune is beyond saving. Silence for the rest of
    // its length is the worst outcome, so the engine says so and the caller advances.
    clock.currentTime = 90;
    await vi.advanceTimersByTimeAsync(STALL_MS * 3);
    expect(onUnrecoverable).toHaveBeenCalled();
  });

  it("stops supervising once playback stops", async () => {
    const { engine, workers, clock } = makeEngine();
    await startTune(engine, workers);
    deliverChunk(workers[0]);
    engine.stopPlayback();

    clock.currentTime = 30;
    await vi.advanceTimersByTimeAsync(STALL_MS * 3);

    // Nothing is playing, so there is nothing to rescue — and no timer left ticking.
    expect(workers.length).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
