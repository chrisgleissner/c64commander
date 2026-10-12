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

    constructor(readonly options: { renderer?: string } = {}) {
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
      this.prerenderTarget = seconds;
    }

    /** Pre-renders finish after this many progress reads. */
    ticksToPrerender = 10;
    prerenderTarget = 0;
    prerenderTicks = 0;
    renderedSeconds: number | null = null;

    getPrerenderProgress() {
      if (!this.prerenderTarget || this.renderedSeconds !== null) return null;
      this.prerenderTicks += 1;
      if (this.prerenderTicks < this.ticksToPrerender) return this.prerenderTicks / this.ticksToPrerender;
      this.renderedSeconds = this.prerenderTarget;
      return null;
    }

    getRenderedSeconds() {
      return this.renderedSeconds;
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

  it("plays the tune silently on an engine fixed to the chosen renderer, leaving the listener's choice alone", async () => {
    saveLocalEngineEnabled(true);
    saveSidEmulationEngine("residfp");
    registerLocalSidProbe();
    const pending = window.__localSidProbe!({ sid, renderer: "sidlite", seconds: 2, songIndex: 1 });
    expect(loadSidEmulationEngine()).toBe("residfp");
    await vi.advanceTimersByTimeAsync(3000);
    const result = await pending;
    const engine = engines[0];
    expect(engine.options.renderer).toBe("sidlite");
    expect(engine.volume).toBe(0);
    expect(Array.from(engine.opened!.bytes)).toEqual([0x50, 0x53, 0x49, 0x44]);
    expect(engine.opened!.songIndex).toBe(1);
    expect(engine.opened!.key).toBe("probe-sidlite-1");
    expect(result.renderer).toBe("sidlite");
    expect(result.fallbackSidModel).toMatch(/^(6581|8580)$/);
    expect(typeof result.romsAvailable).toBe("boolean");
    expect(result.started).toBe(true);
    expect(result.samples).toHaveLength(4);
    expect(result.firstPositionMs).not.toBeNull();
    expect(result.seekLatencyMs).toBeNull();
    expect(result.final).toMatchObject({ renderer: "fake", renderMsPerSec: 40 });
    expect(result.eventLoopLagMs.max).toBeGreaterThanOrEqual(result.eventLoopLagMs.mean);
    expect(result.eventLoopLagMs.p95).toBeLessThanOrEqual(result.eventLoopLagMs.max);
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

  it("times a whole pre-render, a seek the finished pre-render answers, and stops there", async () => {
    saveLocalEngineEnabled(true);
    registerLocalSidProbe();
    const result = await run({
      sid,
      renderer: "sidplayez",
      seconds: 30,
      prerenderSeconds: 180,
      untilPrerendered: true,
      seekAfterPrerender: 120,
    });
    const engine = engines[0];
    expect(engine.prerenders).toEqual([{ key: "probe-sidplayez-0", seconds: 180 }]);
    expect(engine.seeks).toEqual([120]);
    expect(result.prerenderMs).toBeGreaterThan(0);
    expect(result.cachedSeekLatencyMs).not.toBeNull();
    // Ended at the seek's landing, long before the 30 s limit.
    expect(result.samples.length).toBeLessThan(10);
  });

  it("reports no pre-render time when the pre-render did not finish within the limit", async () => {
    saveLocalEngineEnabled(true);
    registerLocalSidProbe();
    const pending = window.__localSidProbe!({ sid, renderer: "residfp", seconds: 1, prerenderSeconds: 180 });
    engines[0].ticksToPrerender = 1000;
    await vi.advanceTimersByTimeAsync(2000);
    expect((await pending).prerenderMs).toBeNull();
  });

  it("opens the next tune on the same engine, as a skip does, and times it", async () => {
    saveLocalEngineEnabled(true);
    registerLocalSidProbe();
    const result = await run({ sid, renderer: "sidlite", seconds: 1, next: { sid, songIndex: 2 } });
    const engine = engines[0];
    expect(engines).toHaveLength(1);
    expect(engine.opened).toMatchObject({ songIndex: 2, key: "probe-sidlite-0-next" });
    expect(result.nextOpenMs).not.toBeNull();
    expect(result.nextFirstPositionMs).not.toBeNull();
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

  it("disposes the engine when the tune fails to open, leaving the listener's choice alone", async () => {
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
