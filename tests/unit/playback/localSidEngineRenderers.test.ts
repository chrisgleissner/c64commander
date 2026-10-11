/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/roms/romStore", () => ({
  loadStoredRoms: () => ({ kernal: new Uint8Array(8192), basic: new Uint8Array(8192) }),
  hasCompleteRomSet: () => true,
}));
const released = vi.hoisted(() => [] as number[]);
vi.mock("@/lib/playback/sidRenderer/nativePcmRelease", () => ({
  releaseNativePcm: (pcm: { bufferId?: number } | null | undefined) => {
    if (pcm && typeof pcm.bufferId === "number") released.push(pcm.bufferId);
  },
}));

import { LocalSidEngine, type LocalSidAudioSink, type LocalSidWorkerLike } from "@/lib/playback/localSidEngine";
import type { LocalSidMainToWorker, LocalSidWorkerToMain } from "@/lib/playback/localSidWorkerProtocol";
import type { AudioScheduleSink, AudioScheduleSource } from "@/lib/playback/localSidChunkScheduler";
import { __resetPhoneAudioOwnership } from "@/lib/audio/phoneAudioOwnership";
import { saveDebugLoggingEnabled, saveSidEmulationEngine } from "@/lib/config/appSettings";
import { clearLogs, getLogs } from "@/lib/logging";
import {
  __setSidplayEzAvailabilityForTests,
  type SidRendererId,
} from "@/lib/playback/sidRenderer/sidRendererAvailability";
import { isNativePcm, type NativePcmRef, type PcmPayload } from "@/lib/playback/sidRenderer/pcmPayload";
import type { RendererRole } from "@/lib/playback/sidRenderer/rendererFactory";

/**
 * One engine, three renderers: the engine picks the renderer per tune, gives each runtime its own
 * channel, and carries libSidplayEZ's audio as native references through the scheduler and the
 * cache — releasing every native buffer it drops and none it still plays from.
 */

const RATE = 48000;

class FakeChannel implements LocalSidWorkerLike {
  readonly sent: LocalSidMainToWorker[] = [];
  terminated = false;
  private handler: ((event: MessageEvent<LocalSidWorkerToMain>) => void) | null = null;
  constructor(
    readonly renderer: SidRendererId,
    readonly role: RendererRole,
  ) {}
  postMessage(message: LocalSidMainToWorker): void {
    this.sent.push(message);
    if (message.type === "load") queueMicrotask(() => this.emit({ type: "ready", moduleLoadMs: 1 }));
  }
  addEventListener(type: string, handler: unknown): void {
    if (type === "message") this.handler = handler as (event: MessageEvent<LocalSidWorkerToMain>) => void;
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(message: LocalSidWorkerToMain): void {
    this.handler?.({ data: message } as MessageEvent<LocalSidWorkerToMain>);
  }
  last<T extends LocalSidMainToWorker["type"]>(type: T) {
    return this.sent.filter((m) => m.type === type).at(-1) as Extract<LocalSidMainToWorker, { type: T }>;
  }
}

/** A sink that takes PCM as it is, like the native one, recording what it was given. */
const makeSink = () => {
  const scheduled: PcmPayload[] = [];
  let now = 0;
  const sink: AudioScheduleSink = {
    get currentTime() {
      return now;
    },
    get sampleRate() {
      return RATE;
    },
    createBuffer: () => {
      throw new Error("float path not expected");
    },
    createSource: () => {
      throw new Error("float path not expected");
    },
    createPcmSource: (pcm) => {
      scheduled.push(pcm);
      const source: AudioScheduleSource = { onended: null, start: () => undefined, stop: () => undefined };
      return source;
    },
  };
  return { sink, scheduled, advance: (seconds: number) => (now += seconds) };
};

const ref = (bufferId: number, startFrame: number, frames: number): NativePcmRef => ({
  kind: "native-pcm",
  bufferId,
  startFrame,
  frames,
});

const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

describe("an engine with three renderers", () => {
  let channels: FakeChannel[];
  let sinks: ReturnType<typeof makeSink>[];

  const makeEngine = () => {
    channels = [];
    sinks = [];
    return new LocalSidEngine({
      rendererFactory: (renderer, role) => {
        const channel = new FakeChannel(renderer, role);
        channels.push(channel);
        return channel;
      },
      chunkSeconds: 0.5,
      targetBufferSeconds: 1,
      audioSinkFactory: (): LocalSidAudioSink => {
        const made = makeSink();
        sinks.push(made);
        return { sink: made.sink, resume: vi.fn(), close: vi.fn() };
      },
    });
  };

  const playback = () => channels.filter((c) => c.role === "playback").at(-1)!;

  const open = async (engine: LocalSidEngine, key?: string) => {
    const started = engine.play(new ArrayBuffer(8), 0, {}, key);
    await settle();
    const channel = playback();
    const id = channel.last("open").id;
    channel.emit({ type: "opened", id, sampleRate: RATE, channels: 2, tuneInfo: null, romRequired: false });
    await started;
    return { channel, id };
  };

  beforeEach(() => {
    localStorage.clear();
    released.length = 0;
    __resetPhoneAudioOwnership();
    __setSidplayEzAvailabilityForTests(true);
  });

  afterEach(() => __setSidplayEzAvailabilityForTests(null));

  it("opens with libSidplayEZ by default where it is available, on a native channel", async () => {
    const engine = makeEngine();
    const { channel } = await open(engine);
    expect(channel.renderer).toBe("sidplayez");
    expect(channel.last("open").engine).toBe("sidplayez");
    engine.dispose();
  });

  it("names the renderer in the log of every tune it opens", async () => {
    saveDebugLoggingEnabled(true);
    clearLogs();
    const engine = makeEngine();
    const started = engine.play(new ArrayBuffer(8), 0, {});
    await settle();
    const channel = playback();
    channel.emit({
      type: "opened",
      id: channel.last("open").id,
      sampleRate: RATE,
      channels: 2,
      tuneInfo: null,
      romRequired: false,
      openTiming: { moduleMs: 1, constructMs: 1, romsMs: 0, loadMs: 1 },
    });
    await started;
    const opened = getLogs().find((entry) => entry.message === "Local SID engine opened");
    expect(opened?.details).toMatchObject({ renderer: "sidplayez" });
    engine.dispose();
  });

  it("opens with reSIDfp where libSidplayEZ is not available", async () => {
    __setSidplayEzAvailabilityForTests(false);
    const engine = makeEngine();
    const { channel } = await open(engine);
    expect(channel.last("open").engine).toBe("residfp");
    engine.dispose();
  });

  it("renders with a renderer fixed at construction, whatever Settings says", async () => {
    saveSidEmulationEngine("sidplayez");
    channels = [];
    sinks = [];
    const engine = new LocalSidEngine({
      renderer: "sidlite",
      rendererFactory: (renderer, role) => {
        const channel = new FakeChannel(renderer, role);
        channels.push(channel);
        return channel;
      },
      audioSinkFactory: (): LocalSidAudioSink => {
        const made = makeSink();
        sinks.push(made);
        return { sink: made.sink, resume: vi.fn(), close: vi.fn() };
      },
    });
    const { channel } = await open(engine, "tune");
    expect(channel.last("open").engine).toBe("sidlite");
    engine.prerender("tune", new ArrayBuffer(8), 0, 4);
    expect(channels.find((c) => c.role === "prerender")!.last("prerender").engine).toBe("sidlite");
    engine.dispose();
  });

  it("moves to a WASM channel when the listener picks a WASM renderer, but keeps it between the two WASM ones", async () => {
    const engine = makeEngine();
    const first = (await open(engine)).channel;
    saveSidEmulationEngine("residfp");
    const second = (await open(engine)).channel;
    expect(first.terminated).toBe(true);
    expect(second.renderer).toBe("residfp");
    saveSidEmulationEngine("sidlite");
    const third = (await open(engine)).channel;
    expect(third).toBe(second);
    expect(third.last("open").engine).toBe("sidlite");
    engine.dispose();
  });

  it("schedules libSidplayEZ chunks as native references, untouched", async () => {
    const engine = makeEngine();
    const { channel, id } = await open(engine);
    channel.emit({ type: "chunk", id, pcm: ref(11, 0, RATE / 2), samples: RATE, renderMs: 3 });
    expect(sinks[0].scheduled).toEqual([ref(11, 0, RATE / 2)]);
    engine.dispose();
  });

  it("gives back the native buffer of every chunk it throws away", async () => {
    const engine = makeEngine();
    const { channel, id } = await open(engine);
    channel.emit({ type: "chunk", id: id + 100, pcm: ref(21, 0, 10), samples: 20, renderMs: 1 });
    expect(released).toEqual([21]);
    expect(sinks[0].scheduled).toEqual([]);
    engine.dispose();
  });

  it("caches a libSidplayEZ pre-render as one native buffer and serves a seek as ranges of it", async () => {
    const engine = makeEngine();
    await open(engine, "tune");
    engine.prerender("tune", new ArrayBuffer(8), 0, 4);
    const prerender = channels.find((c) => c.role === "prerender")!;
    const prerenderId = prerender.last("prerender").id;
    prerender.emit({
      type: "prerender-chunk",
      id: prerenderId,
      pcm: ref(31, 0, RATE * 2),
      sampleRate: RATE,
      channels: 2,
      seconds: 2,
    });
    prerender.emit({
      type: "prerender-chunk",
      id: prerenderId,
      pcm: ref(31, RATE * 2, RATE * 2),
      sampleRate: RATE,
      channels: 2,
      seconds: 4,
    });
    prerender.emit({ type: "prerendered", id: prerenderId, sampleRate: RATE, channels: 2, seconds: 4 });
    expect(engine.getRenderedSeconds()).toBe(4);
    await engine.seekTo(3);
    const fromCache = sinks[0].scheduled.filter((p) => isNativePcm(p) && p.bufferId === 31) as NativePcmRef[];
    expect(fromCache[0]).toEqual(ref(31, RATE * 3, RATE / 2));
    expect(released).not.toContain(31);
    engine.dispose();
    expect(released).toContain(31);
  });

  it("does not serve a tune audio rendered by another renderer under the same key", async () => {
    // A key built before the native probe answered names reSIDfp; the tune then opens on libSidplayEZ.
    __setSidplayEzAvailabilityForTests(false);
    const engine = makeEngine();
    engine.prerender("tune", new ArrayBuffer(8), 0, 4);
    const prerender = channels.find((c) => c.role === "prerender")!;
    expect(prerender.renderer).toBe("residfp");
    const id = prerender.last("prerender").id;
    const wasmPcm = new Int16Array(RATE * 2 * 4);
    prerender.emit({ type: "prerender-chunk", id, pcm: wasmPcm, sampleRate: RATE, channels: 2, seconds: 4 });
    prerender.emit({ type: "prerendered", id, sampleRate: RATE, channels: 2, seconds: 4 });

    __setSidplayEzAvailabilityForTests(true);
    const { channel } = await open(engine, "tune");
    expect(channel.renderer).toBe("sidplayez");
    expect(engine.getRenderedSeconds()).toBeNull();
    void engine.seekTo(3);
    await settle();
    expect(sinks.flatMap((made) => made.scheduled).some((pcm) => !isNativePcm(pcm))).toBe(false);
    expect(channel.last("seek")?.positionSeconds).toBe(3);
    engine.dispose();
  });

  it("does not give back a buffer that playback is still reading from when the cache evicts it", async () => {
    const engine = makeEngine();
    await open(engine, "tune-a");
    engine.prerender("tune-a", new ArrayBuffer(8), 0, 2);
    const prerender = channels.find((c) => c.role === "prerender")!;
    const id = prerender.last("prerender").id;
    prerender.emit({
      type: "prerender-chunk",
      id,
      pcm: ref(41, 0, RATE * 2),
      sampleRate: RATE,
      channels: 2,
      seconds: 2,
    });
    prerender.emit({ type: "prerendered", id, sampleRate: RATE, channels: 2, seconds: 2 });
    await engine.seekTo(0.5);
    const cache = (engine as unknown as { renderCache: { delete: (key: string) => void } }).renderCache;
    cache.delete("tune-a");
    expect(released).not.toContain(41);
    engine.stop();
    expect(released).toContain(41);
    engine.dispose();
  });

  it("gives back the buffer of a pre-render that was abandoned for another tune", async () => {
    const engine = makeEngine();
    await open(engine, "tune-a");
    engine.prerender("tune-a", new ArrayBuffer(8), 0, 60);
    const prerender = channels.find((c) => c.role === "prerender")!;
    const id = prerender.last("prerender").id;
    prerender.emit({ type: "prerender-chunk", id, pcm: ref(51, 0, RATE), sampleRate: RATE, channels: 2, seconds: 1 });
    // The partial is in the cache, so it is kept even though its render is abandoned...
    engine.prerender("tune-b", new ArrayBuffer(8), 0, 60);
    expect(released).not.toContain(51);
    // ...and given back once the cache lets go of it.
    (engine as unknown as { renderCache: { clear: () => void } }).renderCache.clear();
    expect(released).toContain(51);
    engine.dispose();
  });

  it("asks a WASM worker for header room in front of its chunks only when the native feed takes them", async () => {
    __setSidplayEzAvailabilityForTests(false);
    const engine = makeEngine();
    await open(engine);
    // jsdom is not Android, so the feed is not in use and no room is reserved.
    expect(playback().last("load").pcmHeadroomSamples).toBeUndefined();
    engine.dispose();
  });
});
