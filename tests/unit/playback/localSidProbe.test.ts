/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { FakeEngine } = vi.hoisted(() => {
  class FakeEngine {
    static instances: FakeEngine[] = [];
    volume = -1;
    disposed = false;
    position = 0;
    seeks: number[] = [];
    prerenders: Array<{ key: string; seconds: number }> = [];
    opened: { bytes: Uint8Array; songIndex: number; key?: string } | null = null;
    playResult = { started: true, romRequired: false, sampleRate: 48000, channels: 2, tuneInfo: null };
    playError: Error | null = null;

    constructor() {
      FakeEngine.instances.push(this);
    }

    setVolume(value: number) {
      this.volume = value;
    }

    async play(buffer: ArrayBuffer, songIndex: number, _callbacks: unknown, key?: string) {
      if (this.playError) throw this.playError;
      this.opened = { bytes: new Uint8Array(buffer), songIndex, key };
      return this.playResult;
    }

    prerender(key: string, _buffer: ArrayBuffer, _songIndex: number, seconds: number) {
      this.prerenders.push({ key, seconds });
    }

    async seekTo(seconds: number) {
      this.seeks.push(seconds);
      this.position = seconds + 0.5;
    }

    getStats() {
      this.position += this.seeks.length ? 0 : 0.5;
      return { positionSeconds: this.position, bufferedSeconds: 2, audioUnderruns: 0, renderMsPerSec: 40 };
    }

    debugState() {
      return { renderer: "fake" };
    }

    dispose() {
      this.disposed = true;
    }
  }
  return { FakeEngine };
});
const engines = FakeEngine.instances;

vi.mock("@/lib/playback/localSidEngine", () => ({ LocalSidEngine: FakeEngine }));

import { loadSidEmulationEngine, saveLocalEngineEnabled, saveSidEmulationEngine } from "@/lib/config/appSettings";
import { registerLocalSidProbe } from "@/lib/playback/localSidProbe";

const sid = btoa(String.fromCharCode(0x50, 0x53, 0x49, 0x44));

describe("registerLocalSidProbe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    engines.length = 0;
    delete window.__localSidProbe;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete window.__localSidProbe;
  });

  const run = async (request: Parameters<NonNullable<typeof window.__localSidProbe>>[0]) => {
    const pending = window.__localSidProbe!(request);
    await vi.advanceTimersByTimeAsync(request.seconds * 1000 + 1000);
    return pending;
  };

  it("is not installed while on-device playback is turned off", () => {
    saveLocalEngineEnabled(false);
    registerLocalSidProbe();
    expect(window.__localSidProbe).toBeUndefined();
  });

  it("plays the tune silently through the chosen renderer, then restores the listener's choice", async () => {
    saveLocalEngineEnabled(true);
    saveSidEmulationEngine("residfp");
    registerLocalSidProbe();
    const result = await run({ sid, renderer: "sidlite", seconds: 2, songIndex: 1 });
    const engine = engines[0];
    expect(engine.volume).toBe(0);
    expect(Array.from(engine.opened!.bytes)).toEqual([0x50, 0x53, 0x49, 0x44]);
    expect(engine.opened!.songIndex).toBe(1);
    expect(engine.opened!.key).toBe("probe-sidlite-1");
    expect(result.renderer).toBe("sidlite");
    expect(result.started).toBe(true);
    expect(result.samples).toHaveLength(4);
    expect(result.firstPositionMs).not.toBeNull();
    expect(result.seekLatencyMs).toBeNull();
    expect(result.final).toMatchObject({ renderer: "fake", renderMsPerSec: 40 });
    expect(engine.disposed).toBe(true);
    expect(loadSidEmulationEngine()).toBe("residfp");
  });

  it("seeks halfway through and times how long the position takes to pass the target", async () => {
    saveLocalEngineEnabled(true);
    registerLocalSidProbe();
    const result = await run({ sid, renderer: "sidplayez", seconds: 4, seekTo: 30, prerenderSeconds: 60, volume: 0.2 });
    const engine = engines[0];
    expect(engine.volume).toBe(0.2);
    expect(engine.prerenders).toEqual([{ key: "probe-sidplayez-0", seconds: 60 }]);
    expect(engine.seeks).toEqual([30]);
    expect(result.seekLatencyMs).not.toBeNull();
  });

  it("refuses a second probe while one runs, and accepts one once it has finished", async () => {
    saveLocalEngineEnabled(true);
    registerLocalSidProbe();
    const first = window.__localSidProbe!({ sid, renderer: "residfp", seconds: 1 });
    await expect(window.__localSidProbe!({ sid, renderer: "residfp", seconds: 1 })).rejects.toThrow(/already running/);
    await vi.advanceTimersByTimeAsync(2000);
    await first;
    await expect(run({ sid, renderer: "residfp", seconds: 1 })).resolves.toMatchObject({ renderer: "residfp" });
  });

  it("disposes the engine and restores the choice when the tune fails to open", async () => {
    saveLocalEngineEnabled(true);
    saveSidEmulationEngine("sidlite");
    registerLocalSidProbe();
    const original = FakeEngine.prototype.play;
    FakeEngine.prototype.play = async () => {
      throw new Error("open failed");
    };
    try {
      await expect(window.__localSidProbe!({ sid, renderer: "sidplayez", seconds: 1 })).rejects.toThrow("open failed");
    } finally {
      FakeEngine.prototype.play = original;
    }
    expect(engines[0].disposed).toBe(true);
    expect(loadSidEmulationEngine()).toBe("sidlite");
    await expect(run({ sid, renderer: "residfp", seconds: 1 })).resolves.toMatchObject({ renderer: "residfp" });
  });
});
