/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/logging", () => ({ addLog: (_level: string, message: string) => logs.push(message) }));
const platform = vi.hoisted(() => ({ name: "web", plugin: true }));
vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return {
    ...actual,
    Capacitor: {
      ...actual.Capacitor,
      getPlatform: () => platform.name,
      isPluginAvailable: () => platform.plugin,
      isNativePlatform: () => platform.name !== "web",
    },
  };
});

import { SidAudio, type SidAudioPlugin, type SidAudioPrerenderEvent } from "@/lib/native/sidAudio";
import { __setNativePcmReleasePluginForTests } from "@/lib/playback/sidRenderer/nativePcmRelease";
import { SidplayEzRendererCore } from "@/lib/playback/sidRenderer/sidplayEzRendererCore";
import { NativeRendererChannel } from "@/lib/playback/sidRenderer/nativeRendererChannel";
import type { SidRendererCore } from "@/lib/playback/sidRenderer/sidRendererContract";
import { defaultRendererChannelFactory, LocalSidUnavailableError } from "@/lib/playback/sidRenderer/rendererFactory";
import {
  __setSidplayEzAvailabilityForTests,
  availableSidRenderers,
  isSidRendererAvailable,
  probeSidRenderers,
  settleSidRendererAvailabilitySync,
  sidplayEzUnavailableReason,
  subscribeSidRendererAvailability,
} from "@/lib/playback/sidRenderer/sidRendererAvailability";
import type { LocalSidWorkerToMain } from "@/lib/playback/localSidWorkerProtocol";

type Listener = (event: SidAudioPrerenderEvent) => void;

const fakePlugin = () => {
  const calls: { method: string; options: Record<string, unknown> }[] = [];
  const listeners = new Set<Listener>();
  let nextRenderer = 40;
  const plugin = {
    createRenderer: vi.fn(async (options: Record<string, unknown>) => {
      calls.push({ method: "createRenderer", options });
      return { renderer: nextRenderer++ };
    }),
    openTune: vi.fn(async (options: Record<string, unknown>) => {
      calls.push({ method: "openTune", options });
      return { sampleRate: 48000, channels: 2, tuneInfo: { songs: 3 }, constructMs: 2, loadMs: 3 };
    }),
    render: vi.fn(async (options: Record<string, unknown>) => {
      calls.push({ method: "render", options });
      return { bufferId: 77, frames: Math.round((options.seconds as number) * 48000), renderMs: 4 };
    }),
    seek: vi.fn(async (options: Record<string, unknown>) => ({ positionSeconds: options.seconds as number })),
    prerender: vi.fn(async (options: Record<string, unknown>) => {
      calls.push({ method: "prerender", options });
    }),
    cancelPrerender: vi.fn(async (options: Record<string, unknown>) => {
      calls.push({ method: "cancelPrerender", options });
    }),
    closeTune: vi.fn(async () => undefined),
    disposeRenderer: vi.fn(async (options: Record<string, unknown>) => {
      calls.push({ method: "disposeRenderer", options });
    }),
    addListener: vi.fn(async (_name: string, listener: Listener) => {
      listeners.add(listener);
      return { remove: async () => void listeners.delete(listener) };
    }),
    describe: vi.fn(),
  };
  return {
    plugin: plugin as unknown as SidAudioPlugin,
    calls,
    emit: (event: SidAudioPrerenderEvent) => listeners.forEach((l) => l(event)),
    listenerCount: () => listeners.size,
  };
};

const request = () => ({
  sidBytes: Uint8Array.from([0x50, 0x53, 0x49, 0x44]).buffer,
  songIndex: 2,
  sampleRate: 48000,
  roms: { kernal: new Uint8Array([1, 2]).buffer, basic: new Uint8Array([3]).buffer },
  sidModel: "MOS6581" as const,
  engine: "sidplayez" as const,
});

const settle = async () => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

describe("the libSidplayEZ renderer core", () => {
  it("creates its native renderer once, after attaching, at the priority of its role", async () => {
    const { plugin, calls } = fakePlugin();
    const order: string[] = [];
    const core = new SidplayEzRendererCore(
      { background: true, beforeCreate: async () => void order.push("attach") },
      plugin,
    );
    await core.load();
    await core.load();
    expect(order).toEqual(["attach"]);
    expect(calls.filter((c) => c.method === "createRenderer")).toEqual([
      { method: "createRenderer", options: { background: true } },
    ]);
  });

  it("sends the tune, its song, the ROMs and the fallback chip to the native renderer", async () => {
    const { plugin, calls } = fakePlugin();
    const core = new SidplayEzRendererCore({ background: false }, plugin);
    const opened = await core.open(request());
    const open = calls.find((c) => c.method === "openTune")!.options;
    expect(open).toMatchObject({ songIndex: 2, sampleRate: 48000, sidModel: "MOS6581", sid: btoa("PSID") });
    expect(open.kernal).toBe(btoa(String.fromCharCode(1, 2)));
    expect(open.basic).toBe(btoa(String.fromCharCode(3)));
    expect(open.chargen).toBeUndefined();
    expect(opened).toMatchObject({ sampleRate: 48000, channels: 2, tuneInfo: { songs: 3 } });
  });

  it("sends the character ROM too when it was read", async () => {
    const { plugin, calls } = fakePlugin();
    const core = new SidplayEzRendererCore({ background: false }, plugin);
    const withChargen = request();
    await core.open({ ...withChargen, roms: { ...withChargen.roms, chargen: new Uint8Array([4, 5, 6]).buffer } });
    const open = calls.find((c) => c.method === "openTune")!.options;
    expect(open.chargen).toBe(btoa(String.fromCharCode(4, 5, 6)));
  });

  it("returns rendered audio as a reference to the native buffer, never as samples", async () => {
    const { plugin } = fakePlugin();
    const core = new SidplayEzRendererCore({ background: false }, plugin);
    const chunk = await core.render(0.5);
    expect(chunk).toEqual({
      pcm: { kind: "native-pcm", bufferId: 77, startFrame: 0, frames: 24000 },
      samples: 48000,
      renderMs: 4,
    });
  });

  it("reports the end of the tune when the native renderer has nothing more", async () => {
    const { plugin } = fakePlugin();
    (plugin.render as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ bufferId: 0, frames: 0, renderMs: 1 });
    const core = new SidplayEzRendererCore({ background: false }, plugin);
    expect(await core.render(0.5)).toBeNull();
  });

  it("passes each pre-render event on as the frame range it added to the one growing buffer", async () => {
    const fake = fakePlugin();
    const core = new SidplayEzRendererCore({ background: true }, fake.plugin);
    const slices: unknown[] = [];
    const done = core.prerender(
      { ...request(), seconds: 12 },
      (slice) => slices.push(slice),
      () => false,
    );
    await settle();
    const id = (fake.calls.find((c) => c.method === "prerender")!.options.id as number) ?? 0;
    fake.emit({ renderer: 40, id, kind: "chunk", bufferId: 5, frames: 240000, seconds: 5 });
    fake.emit({ renderer: 40, id, kind: "chunk", bufferId: 5, frames: 480000, seconds: 10 });
    fake.emit({ renderer: 99, id, kind: "chunk", bufferId: 6, frames: 1, seconds: 1 });
    fake.emit({ renderer: 40, id, kind: "done", bufferId: 5, frames: 576000, seconds: 12 });
    expect(await done).toEqual({ sampleRate: 48000, channels: 2, seconds: 12 });
    expect(slices).toEqual([
      {
        pcm: { kind: "native-pcm", bufferId: 5, startFrame: 0, frames: 240000 },
        sampleRate: 48000,
        channels: 2,
        seconds: 5,
      },
      {
        pcm: { kind: "native-pcm", bufferId: 5, startFrame: 240000, frames: 240000 },
        sampleRate: 48000,
        channels: 2,
        seconds: 10,
      },
      {
        pcm: { kind: "native-pcm", bufferId: 5, startFrame: 480000, frames: 96000 },
        sampleRate: 48000,
        channels: 2,
        seconds: 12,
      },
    ]);
    await settle();
    expect(fake.listenerCount()).toBe(0);
  });

  it("cancels the native pre-render when a newer one is waiting, and finishes with what it has", async () => {
    const fake = fakePlugin();
    const core = new SidplayEzRendererCore({ background: true }, fake.plugin);
    let superseded = false;
    const done = core.prerender(
      { ...request(), seconds: 600 },
      () => undefined,
      () => superseded,
    );
    await settle();
    const id = fake.calls.find((c) => c.method === "prerender")!.options.id as number;
    superseded = true;
    fake.emit({ renderer: 40, id, kind: "chunk", bufferId: 5, frames: 240000, seconds: 5 });
    await settle();
    expect(fake.calls.some((c) => c.method === "cancelPrerender")).toBe(true);
    fake.emit({ renderer: 40, id, kind: "cancelled", bufferId: 5, frames: 240000, seconds: 5 });
    expect(await done).toMatchObject({ seconds: 5 });
  });

  it("fails a pre-render the native side reports as failed", async () => {
    const fake = fakePlugin();
    const core = new SidplayEzRendererCore({ background: true }, fake.plugin);
    const done = core.prerender(
      { ...request(), seconds: 10 },
      () => undefined,
      () => false,
    );
    await settle();
    const id = fake.calls.find((c) => c.method === "prerender")!.options.id as number;
    fake.emit({ renderer: 40, id, kind: "error", bufferId: 0, frames: 0, seconds: 0, error: "bad tune" });
    await expect(done).rejects.toThrow("bad tune");
  });

  it("disposes its native renderer, and refuses work afterwards", async () => {
    const fake = fakePlugin();
    const core = new SidplayEzRendererCore({ background: false }, fake.plugin);
    await core.load();
    core.dispose();
    await settle();
    expect(fake.calls.filter((c) => c.method === "disposeRenderer")).toEqual([
      { method: "disposeRenderer", options: { renderer: 40 } },
    ]);
    await expect(core.render(0.5)).rejects.toThrow(/disposed/);
  });

  it("disposes a renderer that finishes being created after the core was disposed", async () => {
    const fake = fakePlugin();
    let finish: (value: { renderer: number }) => void = () => undefined;
    (fake.plugin.createRenderer as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const core = new SidplayEzRendererCore({ background: false }, fake.plugin);
    const loading = core.load();
    await settle();
    core.dispose();
    finish({ renderer: 12 });
    await expect(loading).rejects.toThrow(/disposed/);
    await settle();
    expect(fake.calls.some((c) => c.method === "disposeRenderer" && c.options.renderer === 12)).toBe(true);
  });
});

describe("the libSidplayEZ renderer core's other operations", () => {
  it("seeks the native renderer and reports where it landed", async () => {
    const { plugin } = fakePlugin();
    const core = new SidplayEzRendererCore({ background: false }, plugin);
    await core.open(request());
    expect(await core.seek(42)).toBe(42);
  });

  it("closes the open tune, and does nothing before a renderer exists", async () => {
    const { plugin } = fakePlugin();
    const core = new SidplayEzRendererCore({ background: false }, plugin);
    await core.close();
    expect(plugin.closeTune).not.toHaveBeenCalled();
    await core.open(request());
    await core.close();
    expect(plugin.closeTune).toHaveBeenCalledWith({ renderer: 40 });
  });

  it("rejects a pre-render the native side refuses to start", async () => {
    const { plugin } = fakePlugin();
    vi.mocked(plugin.prerender).mockRejectedValueOnce(new Error("no renderer thread"));
    const core = new SidplayEzRendererCore({ background: false }, plugin);
    await expect(
      core.prerender(
        { ...request(), seconds: 4 },
        () => undefined,
        () => false,
      ),
    ).rejects.toThrow("no renderer thread");
  });

  it("logs a renderer that could not be disposed", async () => {
    const { plugin } = fakePlugin();
    vi.mocked(plugin.disposeRenderer).mockRejectedValueOnce(new Error("already gone"));
    const core = new SidplayEzRendererCore({ background: false }, plugin);
    await core.load();
    logs.length = 0;
    core.dispose();
    await settle();
    expect(logs).toContain("libSidplayEZ dispose failed");
  });
});

describe("a native renderer channel", () => {
  it("speaks the worker protocol, delivering replies asynchronously", async () => {
    const fake = fakePlugin();
    const channel = new NativeRendererChannel(new SidplayEzRendererCore({ background: false }, fake.plugin));
    const received: LocalSidWorkerToMain[] = [];
    channel.addEventListener("message", (event) => received.push(event.data));
    channel.postMessage({ type: "load" });
    expect(received).toHaveLength(0);
    await settle();
    expect(received.map((m) => m.type)).toEqual(["ready"]);
    channel.postMessage({ type: "render", id: 1, seconds: 0.5 });
    await settle();
    expect(received[1]).toMatchObject({ type: "chunk", id: 1, pcm: { kind: "native-pcm", bufferId: 77 } });
  });

  it("delivers nothing more once terminated, and disposes the native renderer", async () => {
    const fake = fakePlugin();
    const channel = new NativeRendererChannel(new SidplayEzRendererCore({ background: false }, fake.plugin));
    const received: LocalSidWorkerToMain[] = [];
    channel.addEventListener("message", (event) => received.push(event.data));
    channel.postMessage({ type: "load" });
    await settle();
    channel.postMessage({ type: "render", id: 1, seconds: 0.5 });
    channel.terminate();
    channel.postMessage({ type: "render", id: 2, seconds: 0.5 });
    await settle();
    expect(received.map((m) => m.type)).toEqual(["ready"]);
    expect(fake.calls.some((c) => c.method === "disposeRenderer")).toBe(true);
  });
});

describe("a terminated native renderer channel", () => {
  const released: number[][] = [];
  beforeEach(() => {
    released.length = 0;
    __setNativePcmReleasePluginForTests({
      releaseBuffers: async ({ bufferIds }: { bufferIds: number[] }) => void released.push(bufferIds),
    } as unknown as SidAudioPlugin);
  });
  afterEach(() => __setNativePcmReleasePluginForTests(SidAudio));

  it("gives back the buffer of a chunk that finished rendering after it was terminated", async () => {
    const fake = fakePlugin();
    const channel = new NativeRendererChannel(new SidplayEzRendererCore({ background: false }, fake.plugin));
    let finish: (value: { bufferId: number; frames: number; renderMs: number }) => void = () => undefined;
    vi.mocked(fake.plugin.render).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    channel.postMessage({ type: "load" });
    await settle();
    channel.postMessage({ type: "render", id: 1, seconds: 0.5 });
    await settle();
    channel.terminate();
    finish({ bufferId: 78, frames: 24000, renderMs: 4 });
    await settle();
    expect(released.flat()).toEqual([78]);
  });

  it("gives back a pre-render buffer the engine never saw, and leaves one it did to the engine", async () => {
    let slice: (pcm: { kind: "native-pcm"; bufferId: number; startFrame: number; frames: number }) => void = () =>
      undefined;
    const core = {
      load: async () => undefined,
      open: async () => ({ sampleRate: 48000, channels: 2, tuneInfo: null }),
      render: async () => null,
      seek: async (seconds: number) => seconds,
      prerender: (_request: unknown, onSlice: (s: unknown) => void) => {
        slice = (pcm) => onSlice({ pcm, sampleRate: 48000, channels: 2, seconds: 1 });
        return new Promise(() => undefined);
      },
      close: async () => undefined,
      dispose: () => undefined,
    } as unknown as SidRendererCore;
    const channel = new NativeRendererChannel(core);
    channel.addEventListener("message", () => undefined);
    channel.postMessage({ ...request(), type: "prerender", id: 3, seconds: 12 });
    await settle();
    slice({ kind: "native-pcm", bufferId: 5, startFrame: 0, frames: 48000 });
    await settle();
    channel.terminate();
    slice({ kind: "native-pcm", bufferId: 5, startFrame: 48000, frames: 48000 });
    slice({ kind: "native-pcm", bufferId: 6, startFrame: 0, frames: 48000 });
    await settle();
    expect(released.flat()).toEqual([6]);
  });
});

describe("the renderer factory", () => {
  const OriginalWorker = globalThis.Worker;
  afterEach(() => {
    globalThis.Worker = OriginalWorker;
  });

  it("gives libSidplayEZ a native channel and the WASM renderers a worker", () => {
    class FakeWorker {
      constructor(readonly url: URL) {}
    }
    globalThis.Worker = FakeWorker as unknown as typeof Worker;
    expect(defaultRendererChannelFactory("sidplayez", "playback")).toBeInstanceOf(NativeRendererChannel);
    const worker = defaultRendererChannelFactory("residfp", "prerender") as unknown as FakeWorker;
    expect(worker).toBeInstanceOf(FakeWorker);
    expect(String(worker.url)).toContain("localSid.worker");
  });

  it("says plainly when a WASM renderer cannot run for lack of workers", () => {
    globalThis.Worker = undefined as unknown as typeof Worker;
    expect(() => defaultRendererChannelFactory("sidlite", "playback")).toThrow(LocalSidUnavailableError);
  });
});

describe("which renderers this device has", () => {
  beforeEach(() => {
    __setSidplayEzAvailabilityForTests(null);
    platform.name = "web";
    platform.plugin = true;
  });

  it("knows at once, without asking, that libSidplayEZ is not here off Android", async () => {
    expect(settleSidRendererAvailabilitySync()).toBe(true);
    expect(isSidRendererAvailable("sidplayez")).toBe(false);
    expect(sidplayEzUnavailableReason()).toMatch(/Android/);
    expect(availableSidRenderers()).toEqual(["residfp", "sidlite"]);
  });

  it("asks the native side on Android, and offers libSidplayEZ only when it says yes", async () => {
    platform.name = "android";
    const plugin = { describe: vi.fn(async () => ({ sidplayezAvailable: true, sidplayezRevision: "abc" })) };
    const changed = vi.fn();
    subscribeSidRendererAvailability(changed);
    expect(settleSidRendererAvailabilitySync()).toBe(false);
    await probeSidRenderers(plugin as unknown as SidAudioPlugin);
    expect(isSidRendererAvailable("sidplayez")).toBe(true);
    expect(availableSidRenderers()).toEqual(["sidplayez", "residfp", "sidlite"]);
    expect(changed).toHaveBeenCalled();
  });

  it("keeps libSidplayEZ off the list when its library did not load, with the reason", async () => {
    platform.name = "android";
    const plugin = {
      describe: vi.fn(async () => ({ sidplayezAvailable: false, sidplayezUnavailableReason: "UnsatisfiedLinkError" })),
    };
    await probeSidRenderers(plugin as unknown as SidAudioPlugin);
    expect(isSidRendererAvailable("sidplayez")).toBe(false);
    expect(sidplayEzUnavailableReason()).toBe("UnsatisfiedLinkError");
  });

  it("treats a plugin that fails or never answers as unavailable, rather than waiting on it", async () => {
    platform.name = "android";
    await probeSidRenderers({ describe: vi.fn(async () => Promise.reject(new Error("bridge"))) } as never);
    expect(isSidRendererAvailable("sidplayez")).toBe(false);
    __setSidplayEzAvailabilityForTests(null);
    vi.useFakeTimers();
    const pending = probeSidRenderers({ describe: () => new Promise(() => undefined) } as never);
    await vi.advanceTimersByTimeAsync(3100);
    await pending;
    vi.useRealTimers();
    expect(sidplayEzUnavailableReason()).toMatch(/did not answer/);
  });
});
