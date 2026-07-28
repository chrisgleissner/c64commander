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
/** Mirrors SEEK_ACK_TIMEOUT_MS: how long the engine waits for a seek before reopening the gate. */
const SEEK_ACK_MS = 20_000;

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

/**
 * The gate that actually caused the stalls.
 *
 * `seekPending` suppresses every "chunk" and "end" so audio rendered for the position just left is
 * never scheduled. It is cleared only by a `seeked` reply whose id still matches — so a reply that
 * is lost, or superseded by a newer seek, used to leave it shut. `stopPlayback` did not reopen it,
 * which is why the silence outlived the tune: the next tune's chunks were discarded too, and
 * re-opening in a fresh worker could not help, because the gate is engine state and not the
 * worker's. Scrubbing posts a seek every 350 ms, so this was easy to meet and reported constantly.
 */
describe("LocalSidEngine — the seek gate", () => {
  it("reopens the gate when a seek is never acknowledged", async () => {
    const { engine, workers, clock } = makeEngine();
    await startTune(engine, workers);
    const worker = workers[0];

    // Seek, and let the worker never answer.
    const seek = engine.seekTo(10);
    await vi.advanceTimersByTimeAsync(SEEK_ACK_MS + 1);
    await seek;

    // Audio delivered after the gate reopened must reach the timeline again.
    clock.currentTime = 1;
    deliverChunk(worker);
    expect(engine.getStats().chunksScheduled).toBeGreaterThan(0);
  });

  it("starts a new tune on a fresh worker rather than behind an unfinished seek", async () => {
    const { engine, workers } = makeEngine();
    await startTune(engine, workers);

    // A seek near the end of a long tune: the worker reloads and fast-forwards to get there, in a
    // single call it cannot interrupt. The listener does not wait for it — they skip to the next
    // tune, whose `open` would otherwise sit behind the whole of it.
    void engine.seekTo(200);
    await vi.advanceTimersByTimeAsync(0);

    void engine.play(new ArrayBuffer(64), 0, {});
    await vi.advanceTimersByTimeAsync(0);

    expect(workers[0].terminated).toBe(true);
    expect(workers.length).toBe(2);
  });

  it("does not carry a stuck gate into the next tune", async () => {
    const { engine, workers } = makeEngine();
    await startTune(engine, workers);

    // A seek whose reply never comes, then the listener moves on to another tune.
    void engine.seekTo(10);
    await vi.advanceTimersByTimeAsync(0);
    engine.stopPlayback();

    const play = engine.play(new ArrayBuffer(64), 0, {});
    await vi.advanceTimersByTimeAsync(0);
    const worker = workers[workers.length - 1];
    const opens = worker.sentOfType("open");
    worker.emit({
      type: "opened",
      id: opens[opens.length - 1].id,
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      tuneInfo: null,
      romRequired: false,
    });
    await play;

    const before = engine.getStats().chunksScheduled;
    worker.emit({
      type: "chunk",
      id: opens[opens.length - 1].id,
      pcm: chunk(SAMPLE_RATE),
      samples: SAMPLE_RATE * CHANNELS,
      renderMs: 10,
    });
    // The new tune must be audible; the old tune's abandoned seek is none of its business.
    expect(engine.getStats().chunksScheduled).toBeGreaterThan(before);
  });
});

/**
 * Silence with a reason, and a reason this timer is the wrong judge of.
 *
 * A seek is one call into the one stateful WASM engine: it renders and discards everything between
 * here and the target, queued behind whatever renders are already in flight. Seeking a minute in is
 * a minute of emulation with no message in the meantime, and the buffer is empty throughout —
 * indistinguishable, to a five-second timer, from a worker that has died. On the Pixel 4 that is
 * what a hold-to-seek looked like: a seek every 350 ms, each emptying the buffer, and five seconds
 * later the watchdog discarded a worker that was doing exactly what it had been asked to do. The
 * open and the seek each have a bound of their own, so whichever is outstanding owns the failure.
 */
describe("LocalSidEngine — silence that belongs to a transition", () => {
  it("does not call an unfinished seek a stall, however long it takes", async () => {
    const { engine, workers, clock } = makeEngine();
    await startTune(engine, workers);
    deliverChunk(workers[0]);

    // Seek, and let the worker take its time. The buffer is empty and nothing is being scheduled,
    // which is exactly the shape of a stall — but the seek is why, and the seek is not finished.
    void engine.seekTo(120);
    clock.currentTime = 30;
    await vi.advanceTimersByTimeAsync(STALL_MS * 3);

    expect(workers[0].terminated).toBe(false);
    expect(workers.length).toBe(1);
  });

  it("gives the first chunk after a seek a full window rather than the seek's leftovers", async () => {
    const { engine, workers, clock } = makeEngine();
    await startTune(engine, workers);
    deliverChunk(workers[0]);
    const worker = workers[0];

    void engine.seekTo(60);
    clock.currentTime = 30;
    // Nearly the whole grace period spent seeking, then the worker answers.
    await vi.advanceTimersByTimeAsync(STALL_MS - 500);
    const seekId = worker.sentOfType("seek")[0].id;
    worker.emit({ type: "seeked", id: seekId, positionSeconds: 60 });
    await vi.advanceTimersByTimeAsync(0);

    // A tune that has just repositioned is not a tune that has stalled: the window starts here.
    await vi.advanceTimersByTimeAsync(STALL_MS - 1500);
    expect(worker.terminated).toBe(false);
  });

  it("judges a recovered tune from the restart, not from the silence that caused it", async () => {
    const { engine, workers, clock } = makeEngine();
    await startTune(engine, workers);
    deliverChunk(workers[0]);

    // Stall, and let the watchdog restart the tune.
    clock.currentTime = 30;
    await vi.advanceTimersByTimeAsync(STALL_MS + 1500);
    expect(workers.length).toBe(2);
    const second = workers[1];
    second.emit({ type: "ready", moduleLoadMs: 1 });
    await vi.advanceTimersByTimeAsync(0);
    const opens = second.sentOfType("open");
    second.emit({
      type: "opened",
      id: opens[0].id,
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      tuneInfo: null,
      romRequired: false,
    });
    await vi.advanceTimersByTimeAsync(0);
    const seeks = second.sentOfType("seek");
    if (seeks.length > 0) {
      second.emit({ type: "seeked", id: seeks[0].id, positionSeconds: seeks[0].positionSeconds });
    }
    await vi.advanceTimersByTimeAsync(0);

    // The restart is itself seconds of quiet, and re-opening restarts the window (as does the seek
    // acknowledgement above). Judged from before it, the very next tick called a second stall —
    // and with the tune's one recovery already spent, a restart that had just worked was abandoned
    // about half a second after succeeding, which is what the device log showed.
    await vi.advanceTimersByTimeAsync(2000);
    expect(second.terminated).toBe(false);
    expect(workers.length).toBe(2);
  });
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
