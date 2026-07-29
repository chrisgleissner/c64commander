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

  it("lazily creates the engine only on first play", () => {
    const factory = vi.fn(() => fakeEngine());
    const controller = new LocalSidPlaybackController(factory);
    expect(factory).not.toHaveBeenCalled();
    void controller.play(byteSource(), 0);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("reads the SID bytes and forwards them + song index to the engine", async () => {
    const engine = fakeEngine();
    const controller = new LocalSidPlaybackController(() => engine);
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const result = await controller.play(byteSource(bytes), 2, {});
    // The cache key goes in with the tune, not after it: opening is where a warmed lead-in is poured
    // into the buffer, so a key that arrives later is a warm cache that is never found.
    expect(engine.play).toHaveBeenCalledWith(bytes, 2, {}, undefined);
    expect(result).toEqual(RESULT);
  });

  it("hands the engine the cache key before the tune opens", async () => {
    const engine = fakeEngine();
    const controller = new LocalSidPlaybackController(() => engine);
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;

    engine.prerender = vi.fn();
    await controller.play(byteSource(bytes), 1, {}, { prerenderKey: "tune#1", durationSeconds: 30 });

    expect(engine.play).toHaveBeenCalledWith(expect.anything(), 1, {}, "tune#1");
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
