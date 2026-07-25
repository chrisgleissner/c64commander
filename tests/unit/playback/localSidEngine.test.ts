/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { LocalSidEngine, type LocalSidAudioSink, type LocalSidWorkerLike } from "@/lib/playback/localSidEngine";
import type { LocalSidMainToWorker, LocalSidWorkerToMain } from "@/lib/playback/localSidWorkerProtocol";
import type { AudioScheduleSink, AudioScheduleSource } from "@/lib/playback/localSidChunkScheduler";

/** A fake worker: records what the engine posts, lets the test push responses. */
class FakeWorker implements LocalSidWorkerLike {
  readonly sent: LocalSidMainToWorker[] = [];
  readonly transfers: (Transferable[] | undefined)[] = [];
  terminated = false;
  private handler: ((event: MessageEvent<LocalSidWorkerToMain>) => void) | null = null;

  postMessage(message: LocalSidMainToWorker, transfer?: Transferable[]): void {
    this.sent.push(message);
    this.transfers.push(transfer);
  }
  addEventListener(_type: "message", handler: (event: MessageEvent<LocalSidWorkerToMain>) => void): void {
    this.handler = handler;
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Deliver a worker→main message to the engine. */
  emit(message: LocalSidWorkerToMain): void {
    this.handler?.({ data: message } as MessageEvent<LocalSidWorkerToMain>);
  }
  sentOfType<T extends LocalSidMainToWorker["type"]>(type: T): Extract<LocalSidMainToWorker, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<LocalSidMainToWorker, { type: T }>[];
  }
}

/** A controllable audio sink: manual clock + exposed sources so tests can fire onended. */
class FakeAudioSink {
  currentTime = 0;
  readonly sources: TestSource[] = [];
  closed = false;
  constructor(readonly sampleRate: number) {}
}

class TestSource implements AudioScheduleSource {
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopped = false;
  start(when: number): void {
    this.startedAt = when;
  }
  stop(): void {
    this.stopped = true;
  }
  end(): void {
    this.onended?.();
  }
}

/** Wire the engine to a fresh fake worker + fake sink, returning handles. */
const makeEngine = (opts?: { chunkSeconds?: number; targetBufferSeconds?: number }) => {
  const worker = new FakeWorker();
  let audioSink: FakeAudioSink | null = null;
  const engine = new LocalSidEngine({
    workerFactory: () => worker,
    chunkSeconds: opts?.chunkSeconds ?? 0.5,
    targetBufferSeconds: opts?.targetBufferSeconds ?? 1.0,
    audioSinkFactory: (sampleRate: number): LocalSidAudioSink => {
      const fake = new FakeAudioSink(sampleRate);
      audioSink = fake;
      return {
        sink: buildScheduleSink(fake),
        resume: vi.fn(),
        close: () => {
          fake.closed = true;
        },
      };
    },
  });
  return { engine, worker, getAudioSink: () => audioSink };
};

/** Build an AudioScheduleSink backed by a FakeAudioSink (kept simple + correct). */
const buildScheduleSink = (fake: FakeAudioSink): AudioScheduleSink => ({
  get currentTime() {
    return fake.currentTime;
  },
  get sampleRate() {
    return fake.sampleRate;
  },
  createBuffer: (_channels: number, frames: number) => ({
    getChannelData: () => new Float32Array(frames),
  }),
  createSource: () => {
    const s = new TestSource();
    fake.sources.push(s);
    return s;
  },
});

/** An interleaved stereo chunk of `frames` samples-per-channel. */
const chunk = (frames: number): Int16Array => new Int16Array(frames * 2);

/** Flush microtasks + a macrotask — `play()` awaits `load()`, so `open` posts a tick late. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

interface OpenedOverrides {
  id?: number;
  sampleRate?: number;
  channels?: number;
  tuneInfo?: Record<string, unknown> | null;
  romRequired?: boolean;
}

/** Drive the full ready → (open posted) → opened handshake with the needed flushes. */
async function completeOpen(worker: FakeWorker, overrides: OpenedOverrides = {}): Promise<void> {
  worker.emit({ type: "ready", moduleLoadMs: 1 });
  await flush(); // let play()'s `await load()` resume and post `open`
  worker.emit({
    type: "opened",
    id: overrides.id ?? 1,
    sampleRate: overrides.sampleRate ?? 48000,
    channels: overrides.channels ?? 2,
    tuneInfo: overrides.tuneInfo ?? null,
    romRequired: overrides.romRequired ?? false,
  });
}

describe("LocalSidEngine", () => {
  it("loads the WASM module once and resolves on ready", async () => {
    const { engine, worker } = makeEngine();
    const p = engine.load();
    expect(worker.sentOfType("load").length).toBe(1);
    worker.emit({ type: "ready", moduleLoadMs: 42 });
    await expect(p).resolves.toBeUndefined();
    // Second load is a no-op (module already ready).
    await engine.load();
    expect(worker.sentOfType("load").length).toBe(1);
  });

  it("opens a tune, prefetches to the target buffer, and schedules gaplessly", async () => {
    const { engine, worker, getAudioSink } = makeEngine({ chunkSeconds: 0.5, targetBufferSeconds: 1.0 });
    const play = engine.play(new ArrayBuffer(120), 0, {});
    await completeOpen(worker, { tuneInfo: { title: "Test" } });
    const result = await play;
    expect(result).toMatchObject({ romRequired: false, started: true, sampleRate: 48000, channels: 2 });

    // Prefetch: two renders queued (0.5s each fills the 1.0s target).
    expect(worker.sentOfType("render").length).toBe(2);

    // Deliver both chunks → both scheduled back-to-back on the sink.
    worker.emit({ type: "chunk", id: 1, pcm: chunk(24000), samples: 48000, renderMs: 30 });
    worker.emit({ type: "chunk", id: 1, pcm: chunk(24000), samples: 48000, renderMs: 30 });
    const sink = getAudioSink()!;
    expect(sink.sources.length).toBe(2);
    expect(sink.sources[0].startedAt).toBeCloseTo(0.15, 6); // start padding
    expect(sink.sources[1].startedAt).toBeCloseTo(0.65, 6); // gapless
    expect(engine.getStats().audioUnderruns).toBe(0);
  });

  it("transfers the SID bytes to the worker (single owner)", async () => {
    const { engine, worker } = makeEngine();
    const bytes = new ArrayBuffer(64);
    const p = engine.play(bytes, 0, {});
    await completeOpen(worker);
    const openIndex = worker.sent.findIndex((m) => m.type === "open");
    expect(worker.transfers[openIndex]).toEqual([bytes]);
    await p;
  });

  it("does NOT start audio for a ROM-dependent tune; reports romRequired", async () => {
    const { engine, worker, getAudioSink } = makeEngine();
    const play = engine.play(new ArrayBuffer(64), 0, {});
    await completeOpen(worker, { romRequired: true });
    const result = await play;
    expect(result).toMatchObject({ romRequired: true, started: false });
    expect(getAudioSink()).toBeNull(); // no audio sink was created
    expect(worker.sentOfType("render").length).toBe(0);
  });

  it("refills the buffer as chunks drain (clock-driven prefetch)", async () => {
    const { engine, worker, getAudioSink } = makeEngine({ chunkSeconds: 0.5, targetBufferSeconds: 1.0 });
    const play = engine.play(new ArrayBuffer(64), 0, {});
    await completeOpen(worker);
    await play;

    worker.emit({ type: "chunk", id: 1, pcm: chunk(24000), samples: 48000, renderMs: 20 });
    worker.emit({ type: "chunk", id: 1, pcm: chunk(24000), samples: 48000, renderMs: 20 });
    const before = worker.sentOfType("render").length;
    const sink = getAudioSink()!;

    // Advance the clock past chunk 1 and fire its end → engine pulls the next.
    sink.currentTime = 0.65;
    sink.sources[0].end();
    expect(worker.sentOfType("render").length).toBeGreaterThan(before);
  });

  it("fires onEnded only after the last chunk drains following worker 'end'", async () => {
    const onEnded = vi.fn();
    const { engine, worker, getAudioSink } = makeEngine({ chunkSeconds: 0.5, targetBufferSeconds: 1.0 });
    const play = engine.play(new ArrayBuffer(64), 0, { onEnded });
    await completeOpen(worker);
    await play;

    worker.emit({ type: "chunk", id: 1, pcm: chunk(24000), samples: 48000, renderMs: 20 });
    worker.emit({ type: "chunk", id: 1, pcm: chunk(24000), samples: 48000, renderMs: 20 });
    worker.emit({ type: "end", id: 1 }); // no more audio coming
    const sink = getAudioSink()!;

    expect(onEnded).not.toHaveBeenCalled();
    sink.sources[0].end();
    expect(onEnded).not.toHaveBeenCalled(); // one still playing
    sink.sources[1].end();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("emits playback position and renderMsPerSec stats", async () => {
    const positions: number[] = [];
    const { engine, worker, getAudioSink } = makeEngine({ chunkSeconds: 0.5, targetBufferSeconds: 1.0 });
    const play = engine.play(new ArrayBuffer(64), 0, { onPosition: (s) => positions.push(s) });
    await completeOpen(worker);
    await play;
    worker.emit({ type: "chunk", id: 1, pcm: chunk(24000), samples: 48000, renderMs: 25 });
    const sink = getAudioSink()!;
    sink.currentTime = 0.4; // 0.25s into the first (0.15..0.65) chunk

    const stats = engine.getStats();
    // 48000 interleaved samples / 2ch / 48000Hz = 0.5s rendered in 25ms → 50 ms/sec.
    expect(stats.renderMsPerSec).toBeCloseTo(25 / 0.5, 3);
    expect(stats.chunksScheduled).toBe(1);
    expect(positions.length).toBeGreaterThan(0);
  });

  it("rejects load on a worker load error and play on an open error", async () => {
    const { engine, worker } = makeEngine();
    const loadP = engine.load();
    worker.emit({ type: "error", code: "load", message: "wasm failed" });
    await expect(loadP).rejects.toThrow(/wasm failed/);

    const { engine: engine2, worker: worker2 } = makeEngine();
    const playP = engine2.play(new ArrayBuffer(8), 0, {});
    worker2.emit({ type: "ready", moduleLoadMs: 1 });
    await flush(); // let play() post `open` (activeId set) before the error arrives
    worker2.emit({ type: "error", code: "open", message: "bad SID", id: 1 });
    await expect(playP).rejects.toThrow(/bad SID/);
  });

  it("ignores chunks for a stale tune id", async () => {
    const { engine, worker, getAudioSink } = makeEngine();
    const play = engine.play(new ArrayBuffer(8), 0, {});
    await completeOpen(worker);
    await play;
    worker.emit({ type: "chunk", id: 999, pcm: chunk(24000), samples: 48000, renderMs: 10 });
    expect(getAudioSink()!.sources.length).toBe(0);
  });

  it("stop() halts sources, closes audio, and tells the worker to close", async () => {
    const { engine, worker, getAudioSink } = makeEngine();
    const play = engine.play(new ArrayBuffer(8), 0, {});
    await completeOpen(worker);
    await play;
    worker.emit({ type: "chunk", id: 1, pcm: chunk(24000), samples: 48000, renderMs: 10 });
    const sink = getAudioSink()!;
    engine.stop();
    expect(sink.sources[0].stopped).toBe(true);
    expect(sink.closed).toBe(true);
    expect(worker.sentOfType("close").length).toBe(1);
  });

  it("dispose() terminates the worker", async () => {
    const { engine, worker } = makeEngine();
    const loadP = engine.load();
    worker.emit({ type: "ready", moduleLoadMs: 1 });
    await loadP;
    engine.dispose();
    expect(worker.terminated).toBe(true);
  });
});

describe("LocalSidEngine — default environment factories", () => {
  it("reports isSupported from Worker + AudioContext availability (false under jsdom)", () => {
    expect(LocalSidEngine.isSupported()).toBe(false);
  });

  it("rejects load() when the environment has no Web Worker", async () => {
    const engine = new LocalSidEngine(); // no injected worker factory
    await expect(engine.load()).rejects.toThrow(/Web Workers/);
  });

  it("builds a real AudioContext sink through the default factory when none is injected", async () => {
    const created: MockAudioContext[] = [];
    class MockSource {
      buffer: unknown = null;
      onended: (() => void) | null = null;
      connect = vi.fn();
      start = vi.fn();
      stop = vi.fn();
    }
    class MockAudioContext {
      currentTime = 0;
      sampleRate: number;
      destination = {};
      closed = vi.fn();
      resumed = vi.fn();
      constructor(opts: { sampleRate: number }) {
        this.sampleRate = opts.sampleRate;
        created.push(this);
      }
      createBuffer(channels: number, frames: number) {
        const data = Array.from({ length: channels }, () => new Float32Array(frames));
        return { getChannelData: (c: number) => data[c] };
      }
      createBufferSource() {
        return new MockSource();
      }
      resume() {
        this.resumed();
        return Promise.resolve();
      }
      close() {
        this.closed();
        return Promise.resolve();
      }
    }
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
    try {
      const worker = new FakeWorker();
      const engine = new LocalSidEngine({ workerFactory: () => worker }); // NO audioSinkFactory → default
      const play = engine.play(new ArrayBuffer(64), 0, {});
      worker.emit({ type: "ready", moduleLoadMs: 1 });
      await flush();
      worker.emit({ type: "opened", id: 1, sampleRate: 44100, channels: 2, tuneInfo: null, romRequired: false });
      const result = await play;
      expect(result.started).toBe(true);
      expect(created).toHaveLength(1);
      expect(created[0].sampleRate).toBe(44100);
      // A chunk drives the adapter's createBuffer / createSource / start path.
      worker.emit({ type: "chunk", id: 1, pcm: new Int16Array(4000), samples: 4000, renderMs: 5 });
      expect(engine.getStats().chunksScheduled).toBe(1);
      engine.stop();
      expect(created[0].closed).toHaveBeenCalled();
    } finally {
      delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    }
  });

  it("rejects play() when the audio sink factory throws", async () => {
    const worker = new FakeWorker();
    const engine = new LocalSidEngine({
      workerFactory: () => worker,
      audioSinkFactory: () => {
        throw new Error("no audio device");
      },
    });
    const play = engine.play(new ArrayBuffer(8), 0, {});
    worker.emit({ type: "ready", moduleLoadMs: 1 });
    await flush();
    worker.emit({ type: "opened", id: 1, sampleRate: 48000, channels: 2, tuneInfo: null, romRequired: false });
    await expect(play).rejects.toThrow(/no audio device/);
  });

  it("routes a worker error during playback (uncorrelated) to onError", async () => {
    const onError = vi.fn();
    const { engine, worker } = makeEngine();
    const play = engine.play(new ArrayBuffer(8), 0, { onError });
    await completeOpen(worker);
    await play;
    worker.emit({ type: "error", code: "render", message: "render blew up" });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("render blew up") }),
    );
  });
});
