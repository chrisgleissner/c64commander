/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { LocalSidPlaybackController, type SidByteSource } from "@/lib/playback/localSidPlaybackController";
import type { LocalSidEngine, LocalSidPlayResult, LocalSidStats } from "@/lib/playback/localSidEngine";

const RESULT: LocalSidPlayResult = {
  romRequired: false,
  started: true,
  sampleRate: 48000,
  channels: 2,
  tuneInfo: null,
};

const STATS: LocalSidStats = {
  renderMsPerSec: 40,
  peakRenderMsPerSec: 55,
  audioUnderruns: 0,
  bufferedSeconds: 1.2,
  positionSeconds: 3,
  chunksScheduled: 6,
};

/** A fake engine capturing calls; typed as LocalSidEngine for the factory. */
const fakeEngine = (overrides: Partial<Record<keyof LocalSidEngine, unknown>> = {}) => {
  const engine = {
    play: vi.fn(async () => RESULT),
    stop: vi.fn(),
    getStats: vi.fn(() => STATS),
    dispose: vi.fn(),
    load: vi.fn(async () => {}),
    preload: vi.fn(async () => {}),
    ...overrides,
  };
  return engine as unknown as LocalSidEngine & typeof engine;
};

const byteSource = (bytes = new Uint8Array([0x50, 0x53, 0x49, 0x44]).buffer): SidByteSource => ({
  arrayBuffer: vi.fn(async () => bytes),
  name: "tune.sid",
});

describe("LocalSidPlaybackController", () => {
  it("reports isSupported (false under jsdom — no Worker/Web Audio)", () => {
    expect(LocalSidPlaybackController.isSupported()).toBe(false);
  });

  it("lazily creates the engine only on first play, and only once", async () => {
    const factory = vi.fn(() => fakeEngine());
    const controller = new LocalSidPlaybackController(factory);
    expect(factory).not.toHaveBeenCalled();
    await Promise.all([controller.play(byteSource(), 0), controller.play(byteSource(), 0)]);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("loads the engine ahead of a play, and a failed load does not reject into the caller", async () => {
    const engine = fakeEngine({ preload: vi.fn(async () => Promise.reject(new Error("module load timed out"))) });
    const controller = new LocalSidPlaybackController(() => engine);

    expect(() => controller.preload()).not.toThrow();

    await vi.waitFor(() => expect(engine.preload).toHaveBeenCalledTimes(1));
    expect(engine.play).not.toHaveBeenCalled();
  });

  it("logs a failed load that is not an Error by its text", async () => {
    const { getLogs } = await import("@/lib/logging");
    localStorage.setItem("c64u_debug_logging_enabled", "1");
    try {
      const engine = fakeEngine({ preload: vi.fn(() => Promise.reject("worker refused")) });
      new LocalSidPlaybackController(() => engine).preload();

      await vi.waitFor(() =>
        expect(getLogs().find((entry) => entry.message === "Local SID engine preload failed")?.details).toEqual({
          service: "local-sid",
          error: "worker refused",
        }),
      );
    } finally {
      localStorage.removeItem("c64u_debug_logging_enabled");
    }
  });

  it("reads the SID bytes and forwards them + song index to the engine", async () => {
    const engine = fakeEngine();
    const controller = new LocalSidPlaybackController(() => engine);
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const result = await controller.play(byteSource(bytes), 2, {});
    // The cache key goes in with the tune, not after it: opening is where a warmed lead-in is poured
    // into the buffer, so a key that arrives later is a warm cache that is never found.
    expect(engine.play).toHaveBeenCalledWith(bytes, 2, {}, undefined, undefined);
    expect(result).toEqual(RESULT);
  });

  it("hands the engine the cache key before the tune opens", async () => {
    const engine = fakeEngine();
    const controller = new LocalSidPlaybackController(() => engine);
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;

    engine.prerender = vi.fn();
    await controller.play(byteSource(bytes), 1, {}, { prerenderKey: "tune#1", durationSeconds: 30 });

    expect(engine.play).toHaveBeenCalledWith(expect.anything(), 1, {}, "tune#1", undefined);
  });

  it("tells the engine where the outgoing tune ends, so it can play that tune on to there", async () => {
    const engine = fakeEngine();
    const controller = new LocalSidPlaybackController(() => engine);

    await controller.play(byteSource(), 1, {}, { outgoingEndsAtSeconds: 120 });

    expect(engine.play).toHaveBeenCalledWith(expect.anything(), 1, {}, undefined, 120);
  });

  it("reuses the same engine across plays", async () => {
    const factory = vi.fn(() => fakeEngine());
    const controller = new LocalSidPlaybackController(factory);
    await controller.play(byteSource(), 0);
    await controller.play(byteSource(), 1);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("propagates a romRequired result (caller falls back to C64)", async () => {
    const engine = fakeEngine({ play: vi.fn(async () => ({ ...RESULT, romRequired: true, started: false })) });
    const controller = new LocalSidPlaybackController(() => engine);
    const result = await controller.play(byteSource(), 0);
    expect(result.romRequired).toBe(true);
    expect(result.started).toBe(false);
  });

  it("stop/getStats before any play are safe no-ops", () => {
    const controller = new LocalSidPlaybackController(() => fakeEngine());
    expect(() => controller.stop()).not.toThrow();
    expect(controller.getStats()).toBeNull();
  });

  it("forwards stop, getStats and dispose to the engine", async () => {
    const engine = fakeEngine();
    const controller = new LocalSidPlaybackController(() => engine);
    await controller.play(byteSource(), 0);
    controller.stop();
    expect(engine.stop).toHaveBeenCalled();
    expect(controller.getStats()).toEqual(STATS);
    controller.dispose();
    expect(engine.dispose).toHaveBeenCalled();
    // After dispose the next play builds a fresh engine.
    await controller.play(byteSource(), 0);
    expect(engine.play).toHaveBeenCalledTimes(2);
  });
});

describe("LocalSidPlaybackController seek announcements", () => {
  const playing = async () => {
    let accepted = false;
    const engine = fakeEngine({
      seekTo: vi.fn(() => {
        accepted = true;
        return new Promise<void>(() => undefined);
      }),
    });
    const controller = new LocalSidPlaybackController(() => engine);
    await controller.play(byteSource(), 0);
    return { controller, engine, isAccepted: () => accepted };
  };

  it("announces a seek once the engine has accepted it and before it lands", async () => {
    const { controller, isAccepted } = await playing();
    const seen: boolean[] = [];
    controller.onSeek(() => seen.push(isAccepted()));
    void controller.seekTo(90);
    void controller.seekBy(-5);
    expect(seen).toEqual([true, true]);
  });

  it("stops announcing to a listener that unsubscribed", async () => {
    const { controller } = await playing();
    const listener = vi.fn();
    const unsubscribe = controller.onSeek(listener);
    unsubscribe();
    void controller.seekTo(10);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("LocalSidPlaybackController engine loading", () => {
  it("applies a level and mute set before the engine existed once it loads", async () => {
    const engine = fakeEngine({ setVolume: vi.fn(), setMuted: vi.fn() });
    const controller = new LocalSidPlaybackController(async () => engine);
    controller.setVolume(0.25);
    controller.setMuted(true);
    expect(controller.volume()).toBe(0.25);
    expect(controller.muted()).toBe(true);
    await controller.play(byteSource(), 0);
    expect(engine.setVolume).toHaveBeenCalledWith(0.25);
    expect(engine.setMuted).toHaveBeenCalledWith(true);
  });

  const mutableEngine = () => {
    const engine = fakeEngine();
    let engineMuted = false;
    Object.assign(engine, {
      setMuted: vi.fn((muted: boolean) => {
        engineMuted = muted;
      }),
      getMuted: () => engineMuted,
    });
    return engine as typeof engine & { setMuted: ReturnType<typeof vi.fn>; getMuted: () => boolean };
  };

  it("keeps a Mute set while a handover holds the output silent once the hold is released", async () => {
    const engine = mutableEngine();
    const controller = new LocalSidPlaybackController(async () => engine);
    await controller.play(byteSource(), 0);

    const release = controller.holdSilence();
    expect(engine.getMuted()).toBe(true);
    expect(controller.muted()).toBe(false);
    controller.setMuted(true);
    release();
    release();

    expect(controller.muted()).toBe(true);
    expect(engine.getMuted()).toBe(true);
  });

  it("stays silent through an Unmute until the last hold is released", async () => {
    const engine = mutableEngine();
    const controller = new LocalSidPlaybackController(async () => engine);
    controller.setMuted(true);
    const first = controller.holdSilence();
    const second = controller.holdSilence();
    await controller.play(byteSource(), 0);
    expect(engine.getMuted()).toBe(true);

    controller.setMuted(false);
    first();
    expect(engine.getMuted()).toBe(true);
    second();

    expect(engine.getMuted()).toBe(false);
    expect(controller.muted()).toBe(false);
  });

  it("queues a pre-render and a lead-in asked for before the engine has loaded", async () => {
    const engine = fakeEngine({ prerender: vi.fn(), warmLeadIn: vi.fn() });
    const controller = new LocalSidPlaybackController(async () => engine);
    controller.prerender("a", new ArrayBuffer(4), 0, 30);
    controller.warmLeadIn("b", new ArrayBuffer(4), 0, 6);
    await vi.waitFor(() => expect(engine.warmLeadIn).toHaveBeenCalledWith("b", expect.any(ArrayBuffer), 0, 6));
    expect(engine.prerender).toHaveBeenCalledWith("a", expect.any(ArrayBuffer), 0, 30);
  });

  it("rejects a play whose engine failed to load, logs a queued request, and tries again next time", async () => {
    const { getLogs } = await import("@/lib/logging");
    const engine = fakeEngine();
    const factory = vi
      .fn<() => Promise<typeof engine>>()
      .mockRejectedValueOnce(new Error("chunk missing"))
      .mockRejectedValueOnce("offline")
      .mockResolvedValue(engine);
    const controller = new LocalSidPlaybackController(factory);
    await expect(controller.play(byteSource(), 0)).rejects.toThrow(
      "Loading the local SID engine failed: chunk missing",
    );
    controller.prerender("a", new ArrayBuffer(4), 0, 30);
    await vi.waitFor(() =>
      expect(getLogs().some((entry) => entry.message === "Local SID pre-render skipped: the engine did not load")).toBe(
        true,
      ),
    );
    await expect(controller.play(byteSource(), 0)).resolves.toBeDefined();
  });

  it("disposes an engine that finishes loading after the player was disposed", async () => {
    const engine = fakeEngine();
    let finish: (value: typeof engine) => void = () => undefined;
    const controller = new LocalSidPlaybackController(() => new Promise((resolve) => (finish = resolve)));
    const playing = controller.play(byteSource(), 0);
    await Promise.resolve();
    controller.dispose();
    finish(engine);
    await expect(playing).rejects.toThrow(/disposed while its engine was loading/);
    expect(engine.dispose).toHaveBeenCalled();
  });
});
