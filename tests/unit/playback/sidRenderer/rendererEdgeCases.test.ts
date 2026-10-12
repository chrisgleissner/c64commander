/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => [] as Array<{ level: string; message: string }>);
vi.mock("@/lib/logging", () => ({ addLog: (level: string, message: string) => logs.push({ level, message }) }));

import type { SidAudioPlugin } from "@/lib/native/sidAudio";
import { LocalSidChunkScheduler, type AudioScheduleSink } from "@/lib/playback/localSidChunkScheduler";
import type { LocalSidWorkerToMain } from "@/lib/playback/localSidWorkerProtocol";
import { NativeRendererChannel } from "@/lib/playback/sidRenderer/nativeRendererChannel";
import { lazyRendererCore } from "@/lib/playback/sidRenderer/lazyRendererCore";
import { PcmAccumulator } from "@/lib/playback/sidRenderer/pcmAccumulator";
import { LocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import { RenderedTuneCache } from "@/lib/playback/renderedTuneCache";
import { __resetSidAudioAttachForTests, ensureSidAudioAttached } from "@/lib/playback/sidRenderer/sidAudioAttach";
import { PORT_OBJECT_NAME, __resetPcmPortForTests, confirmedPcmPort } from "@/lib/playback/sidRenderer/nativePcmPort";
import { __setNativePcmReleasePluginForTests, releaseNativePcm } from "@/lib/playback/sidRenderer/nativePcmRelease";
import { createRendererDispatcher, type SidRendererCore } from "@/lib/playback/sidRenderer/sidRendererContract";
import {
  __setSidplayEzAvailabilityForTests,
  isSidRendererId,
  sidplayEzRevision,
} from "@/lib/playback/sidRenderer/sidRendererAvailability";

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

const ref = { kind: "native-pcm" as const, bufferId: 9, startFrame: 0, frames: 10 };

describe("renderer edge cases", () => {
  beforeEach(() => {
    logs.length = 0;
  });

  it("logs a release of native buffers the plugin refused, and carries on", async () => {
    __setNativePcmReleasePluginForTests({
      releaseBuffers: async () => Promise.reject(new Error("store gone")),
    } as unknown as SidAudioPlugin);
    releaseNativePcm(ref);
    releaseNativePcm(null);
    await settle();
    expect(logs).toEqual([{ level: "warn", message: "Native SID audio: releasing PCM buffers failed" }]);
  });

  it("refuses to schedule native PCM on a Web Audio sink, which cannot reach it", () => {
    const sink = {
      currentTime: 0,
      sampleRate: 48000,
      createBuffer: vi.fn(),
      createSource: vi.fn(),
    } as unknown as AudioScheduleSink;
    const scheduler = new LocalSidChunkScheduler(sink, {});
    expect(() => scheduler.schedule(ref, 2)).toThrow(/only be scheduled on the native audio sink/);
  });

  it("knows the renderer ids and reports libSidplayEZ's revision only where it is available", () => {
    expect(["sidplayez", "residfp", "sidlite"].every(isSidRendererId)).toBe(true);
    expect(isSidRendererId("resid")).toBe(false);
    __setSidplayEzAvailabilityForTests(true);
    expect(sidplayEzRevision()).not.toBeUndefined();
    __setSidplayEzAvailabilityForTests(false);
    expect(sidplayEzRevision()).toBeNull();
    __setSidplayEzAvailabilityForTests(null);
  });

  it("accepts error listeners on a native channel, which never has a message it cannot clone", () => {
    const core = { dispose: vi.fn() } as unknown as SidRendererCore;
    const channel = new NativeRendererChannel(core);
    expect(() => {
      channel.addEventListener("error", () => undefined);
      channel.addEventListener("messageerror", () => undefined);
    }).not.toThrow();
    channel.terminate();
    expect(core.dispose).toHaveBeenCalled();
  });
});

describe("the renderer dispatcher's failure paths", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  afterEach(() => warn.mockClear());

  const coreThat = (overrides: Partial<SidRendererCore>) =>
    ({
      load: async () => undefined,
      open: async () => ({ sampleRate: 48000, channels: 2, tuneInfo: null }),
      render: async () => null,
      seek: async (seconds: number) => seconds,
      prerender: async () => ({ sampleRate: 48000, channels: 2, seconds: 0 }),
      close: async () => undefined,
      dispose: () => undefined,
      ...overrides,
    }) as SidRendererCore;

  it("answers a render that throws with a render error naming the request", async () => {
    const posted: LocalSidWorkerToMain[] = [];
    const dispatch = createRendererDispatcher(
      coreThat({ render: async () => Promise.reject(new Error("player broke")) }),
      (message) => posted.push(message),
    );
    await dispatch({ type: "render", id: 4, seconds: 0.5 });
    expect(posted).toEqual([expect.objectContaining({ type: "error", code: "render", id: 4 })]);
  });

  it("keeps the queue alive when reporting a failure itself fails, and says so", async () => {
    const dispatch = createRendererDispatcher(
      coreThat({ load: async () => Promise.reject(new Error("no module")) }),
      () => {
        throw new Error("channel closed");
      },
    );
    await dispatch({ type: "load" });
    expect(warn).toHaveBeenCalledWith(
      "SID renderer: a queued message rejected outside its own handler",
      expect.any(Error),
    );
    await expect(dispatch({ type: "close" })).resolves.toBeUndefined();
  });
});

describe("probing the binary PCM port", () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)[PORT_OBJECT_NAME];
    __resetPcmPortForTests();
  });

  it("falls back to the Capacitor bridge, and says why, when the probe cannot be asked", async () => {
    (window as unknown as Record<string, unknown>)[PORT_OBJECT_NAME] = { postMessage: vi.fn() };
    const plugin = { describe: async () => Promise.reject(new Error("bridge down")) } as unknown as SidAudioPlugin;
    await expect(confirmedPcmPort(plugin)).resolves.toBeNull();
    expect(logs.map((entry) => entry.message)).toContain(
      "Native SID audio: probing the binary PCM port failed; using the Capacitor bridge",
    );
  });
});

describe("smaller paths", () => {
  beforeEach(() => {
    logs.length = 0;
  });

  it("reports a renderer that failed to load with whatever it was rejected with", async () => {
    const core = lazyRendererCore(async () => Promise.reject("module missing"));
    await expect(core.load({})).rejects.toThrow("Loading the SID renderer failed: module missing");
  });

  it("logs a failed attach that was rejected with something other than an Error", async () => {
    __resetSidAudioAttachForTests();
    await ensureSidAudioAttached({ attach: async () => Promise.reject("no plugin") } as unknown as SidAudioPlugin);
    expect(logs).toEqual([{ level: "warn", message: "Native SID audio: attaching to the plugin failed" }]);
    __resetSidAudioAttachForTests();
  });

  it("counts the samples it holds, native or JavaScript", () => {
    const js = new PcmAccumulator();
    js.append(new Int16Array(8), 8, 2);
    expect(js.samples).toBe(8);
    const native = new PcmAccumulator();
    native.append({ kind: "native-pcm", bufferId: 3, startFrame: 0, frames: 4 }, 8, 2);
    expect(native.samples).toBe(8);
  });

  it("ignores seeks before any tune has played", async () => {
    const controller = new LocalSidPlaybackController();
    await expect(controller.seekTo(10)).resolves.toBeUndefined();
    await expect(controller.seekBy(5)).resolves.toBeUndefined();
  });

  it("deletes and evicts only what it holds", () => {
    const dropped: number[] = [];
    const cache = new RenderedTuneCache(1, 1024 * 1024, (tune) => dropped.push(tune.pcm.length));
    const tune = (samples: number) => ({
      renderer: "residfp" as const,
      pcm: new Int16Array(samples),
      sampleRate: 48000,
      channels: 2,
      durationSeconds: 1,
    });
    cache.delete("absent");
    cache.set("a", tune(2));
    cache.set("b", tune(4));
    expect(dropped).toEqual([2]);
    expect(cache.keys()).toEqual(["b"]);
  });
});
