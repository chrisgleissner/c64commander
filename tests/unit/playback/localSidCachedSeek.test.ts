/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LocalSidEngine,
  type LocalSidAudioSink,
  type LocalSidWorkerLike,
} from "@/lib/playback/localSidEngine";
import type { LocalSidMainToWorker, LocalSidWorkerToMain } from "@/lib/playback/localSidWorkerProtocol";
import type { AudioScheduleSink, AudioScheduleSource } from "@/lib/playback/localSidChunkScheduler";
import { __resetPhoneAudioOwnership } from "@/lib/audio/phoneAudioOwnership";
import { savePlaybackCrossfadeMs } from "@/lib/config/appSettings";

vi.mock("@/lib/roms/romStore", () => ({
  loadStoredRoms: () => ({ kernal: new Uint8Array(8192), basic: new Uint8Array(8192) }),
}));

/**
 * The engine's cached-seek path, end to end.
 *
 * The cache had a unit test for its own slice arithmetic, which is not the same
 * thing: what the pre-render actually buys is `seekTo` short-circuiting to the
 * buffer and `pump` draining it into the scheduler, with no worker round-trip.
 * None of that was covered, so a seek that silently fell back to re-rendering —
 * the exact regression the feature exists to prevent — would still have passed.
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

/** Records every buffer the scheduler hands to Web Audio. */
const makeSink = () => {
  const written: Float32Array[] = [];
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
      return {
        getChannelData: (c: number) => data[c]!,
        // Captured on creation so the assertions can read what was scheduled.
        __data: data,
      } as unknown as AudioBuffer;
    },
    createSource: (buffer: AudioBuffer) => {
      written.push(((buffer as unknown as { __data: Float32Array[] }).__data)[0]!);
      return new TestSource();
    },
  };
  return { sink, written, advance: (seconds: number) => (currentTime += seconds) };
};

describe("seeking inside a pre-rendered tune", () => {
  let worker: FakeWorker;
  let written: Float32Array[];

  const makeEngine = () => {
    worker = new FakeWorker();
    const { sink, written: w } = makeSink();
    written = w;
    return new LocalSidEngine({
      workerFactory: () => worker,
      chunkSeconds: 0.5,
      targetBufferSeconds: 1.0,
      audioSinkFactory: (): LocalSidAudioSink => ({ sink, resume: vi.fn(), close: vi.fn() }),
    });
  };

  /** A rendered tune whose samples encode their own index, so slices are identifiable. */
  const renderedPcm = (seconds: number) => {
    const pcm = new Int16Array(SAMPLE_RATE * seconds * CHANNELS);
    for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i % 30000) - 15000;
    return pcm;
  };

  const openAndCache = async (engine: LocalSidEngine, seconds = 4) => {
    const play = engine.play(new ArrayBuffer(8), 0, {});
    worker.emit({ type: "ready", moduleLoadMs: 1 });
    await Promise.resolve();
    worker.emit({ type: "opened", id: 1, sampleRate: SAMPLE_RATE, channels: CHANNELS, tuneInfo: {} } as never);
    await play;
    engine.prerender("tune#0", new ArrayBuffer(8), 0, seconds);
    const prerenderId = engine as unknown as { prerenderId: number };
    worker.emit({
      type: "prerendered",
      id: prerenderId.prerenderId,
      pcm: renderedPcm(seconds),
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      seconds,
    } as never);
  };

  beforeEach(() => {
    __resetPhoneAudioOwnership();
    localStorage.clear();
  });

  it("serves a seek from the buffer instead of asking the worker to re-render", async () => {
    const engine = makeEngine();
    await openAndCache(engine);
    const seeksBefore = worker.ofType("seek").length;
    const rendersBefore = worker.ofType("render").length;

    await engine.seekTo(2);

    // The whole point: no engine round-trip. libsidplayfp cannot rewind, so a
    // worker seek here costs ~150 ms of CPU per second of audio replayed.
    expect(worker.ofType("seek")).toHaveLength(seeksBefore);
    expect(worker.ofType("render")).toHaveLength(rendersBefore);
    // And audio was actually queued, rather than the engine going quiet.
    expect(written.length).toBeGreaterThan(0);
  });

  it("reports the position it was asked for, not one read back from the engine", async () => {
    const engine = makeEngine();
    await openAndCache(engine);

    await engine.seekTo(2);

    expect(engine.getStats().positionSeconds).toBeCloseTo(2, 1);
  });

  it("ends the tune when a seek lands at its end, instead of going silent forever", async () => {
    // The cache is exhausted on the first pump, before anything is scheduled.
    // Waiting for chunks that will never exist left the engine silent, still
    // "active", and never firing onEnded.
    const onEnded = vi.fn();
    const engine = makeEngine();
    worker = new FakeWorker();
    const { sink } = makeSink();
    const e2 = new LocalSidEngine({
      workerFactory: () => worker,
      chunkSeconds: 0.5,
      targetBufferSeconds: 1.0,
      audioSinkFactory: (): LocalSidAudioSink => ({ sink, resume: vi.fn(), close: vi.fn() }),
    });
    const play = e2.play(new ArrayBuffer(8), 0, { onEnded });
    worker.emit({ type: "ready", moduleLoadMs: 1 });
    await Promise.resolve();
    worker.emit({ type: "opened", id: 1, sampleRate: SAMPLE_RATE, channels: CHANNELS, tuneInfo: {} } as never);
    await play;
    e2.prerender("tune#0", new ArrayBuffer(8), 0, 4);
    worker.emit({
      type: "prerendered",
      id: (e2 as unknown as { prerenderId: number }).prerenderId,
      pcm: renderedPcm(4),
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      seconds: 4,
    } as never);

    await e2.seekTo(4);

    expect(onEnded).toHaveBeenCalledTimes(1);
    void engine;
  });

  it("stops serving from the cache once playback is torn down", async () => {
    const engine = makeEngine();
    await openAndCache(engine);
    await engine.seekTo(1);

    engine.stopPlayback();

    // A stale cache cursor surviving a stop would let the next tune play the
    // previous one's audio.
    expect(engine.isActive()).toBe(false);
  });

  it("keeps the listener's volume across a crossfade", async () => {
    // `fadeIn` cancels whatever `setGain` scheduled, so a fade to a hardcoded 1
    // undid the level the listener had chosen: the volume control worked until
    // the next crossfade, then jumped back to full.
    const gains: number[] = [];
    const fades: Array<{ ms: number; to: number | undefined }> = [];
    worker = new FakeWorker();
    const { sink } = makeSink();
    const engine = new LocalSidEngine({
      workerFactory: () => worker,
      audioSinkFactory: (): LocalSidAudioSink => ({
        sink,
        resume: vi.fn(),
        close: vi.fn(),
        setGain: (value: number) => gains.push(value),
        fadeIn: (ms: number, to?: number) => fades.push({ ms, to }),
      }),
    });
    engine.setVolume(0.3);

    savePlaybackCrossfadeMs(600);
    const play = engine.play(new ArrayBuffer(8), 0, {});
    worker.emit({ type: "ready", moduleLoadMs: 1 });
    await Promise.resolve();
    worker.emit({ type: "opened", id: 1, sampleRate: SAMPLE_RATE, channels: CHANNELS, tuneInfo: {} } as never);
    await play;

    expect(gains).toContain(0.3);
    expect(fades).toHaveLength(1);
    expect(fades[0]!.to).toBeCloseTo(0.3, 5);
  });

  it("does not report a failed pre-render as failed playback", async () => {
    // The pre-render runs on its own worker for a tune that is very likely
    // playing perfectly. Reporting its failure as a playback error told the
    // user, and the logs, that a working tune had failed.
    const onError = vi.fn();
    const engine = makeEngine();
    const play = engine.play(new ArrayBuffer(8), 0, { onError });
    worker.emit({ type: "ready", moduleLoadMs: 1 });
    await Promise.resolve();
    worker.emit({ type: "opened", id: 1, sampleRate: SAMPLE_RATE, channels: CHANNELS, tuneInfo: {} } as never);
    await play;

    worker.emit({ type: "error", id: 99, code: "prerender", message: "ROMs required" } as never);

    expect(onError).not.toHaveBeenCalled();
  });
});
