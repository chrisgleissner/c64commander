/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import {
  CLIP_LAMP_HOLD_MS,
  SPECTRUM_IDLE_POLL_MS,
  SPECTRUM_READ_WAIT_MS,
  SPECTRUM_STALE_AFTER_MS,
  SpectrumView,
  type SpectrumReadout,
} from "@/lib/audio/spectrum/spectrumView";
import type { SpectrumFrame } from "@/lib/native/audioFx";
import { addLog } from "@/lib/logging";
import * as spectrumRenderer from "@/lib/audio/spectrum/spectrumRenderer";

const makeContext = () => {
  const fills: Array<{ x: number; y: number; w: number; h: number }> = [];
  const gradient = { addColorStop: vi.fn() };
  const ctx = {
    fills,
    fillStyle: "",
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => fills.push({ x, y, w, h })),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
  };
  return ctx;
};

const frame = (overrides: Partial<SpectrumFrame> = {}): SpectrumFrame => ({
  enabled: true,
  active: true,
  sequence: 1,
  sampleRate: 48000,
  bands: new Array(48).fill(-30),
  peakDb: -6,
  rmsDb: -20,
  clipped: false,
  ...overrides,
});

const setup = (
  options: { profile?: string; frames?: () => SpectrumFrame | null; read?: () => Promise<SpectrumFrame | null> } = {},
) => {
  const ctx = makeContext();
  const layerCtx = makeContext();
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  let nowMs = 0;
  let pending: ((t: number) => void) | null = null;
  const reads: number[] = [];
  const readouts: SpectrumReadout[] = [];
  const active: boolean[] = [];
  const tiers: number[] = [];
  const setEnabled = vi.fn(async () => true);
  const view = new SpectrumView({
    canvas,
    profile: options.profile ?? "medium",
    onReadout: (r) => readouts.push(r),
    onActiveChange: (a) => active.push(a),
    onTierChange: (t) => tiers.push(t.index),
    read: async () => {
      reads.push(nowMs);
      if (options.read) return options.read();
      return options.frames ? options.frames() : frame({ sequence: reads.length });
    },
    setEnabled,
    now: () => nowMs,
    requestFrame: (cb) => {
      pending = cb;
      return 1;
    },
    cancelFrame: () => {
      pending = null;
    },
    createLayer: () => ({ canvas: {} as CanvasImageSource, context: layerCtx as unknown as CanvasRenderingContext2D }),
    reducedMotion: () => false,
    deviceSignals: () => ({ hardwareConcurrency: 8, deviceMemory: 8 }),
  });
  const advance = async (ms: number, step = 17) => {
    for (let spent = 0; spent < ms; spent += step) {
      nowMs += step;
      const callback = pending;
      pending = null;
      callback?.(nowMs);
      await Promise.resolve();
      await Promise.resolve();
    }
  };
  return {
    view,
    ctx,
    layerCtx,
    reads,
    readouts,
    active,
    tiers,
    setEnabled,
    advance,
    hasFrameScheduled: () => pending !== null,
    setNow: (value: number) => (nowMs = value),
    get nowMs() {
      return nowMs;
    },
  };
};

describe("SpectrumView", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(addLog).mockClear();
  });

  it("draws the fixed layer once per size and the bars every frame", async () => {
    const t = setup();
    t.view.resize(300, 150, 3);
    expect(t.view.currentTier.index).toBe(0);
    expect(t.layerCtx.fillText).toHaveBeenCalled();
    const layerDraws = t.layerCtx.fillText.mock.calls.length;
    t.view.setState({ visible: true, paused: false });
    await t.advance(500);
    expect(t.layerCtx.fillText.mock.calls.length).toBe(layerDraws);
    expect(t.ctx.drawImage.mock.calls.length).toBeGreaterThan(10);
    expect(t.ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(t.ctx.fills.some((f) => f.h > 20)).toBe(true);
  });

  it("reuses draw options and reports frame timing as primitives", async () => {
    const t = setup();
    t.view.resize(300, 150, 1);
    const internal = t.view as unknown as {
      controller: { report: (nowMs: number, costMs: number, intervalMs: number) => unknown };
      drawOptions: object;
    };
    const options = internal.drawOptions;
    const report = vi.spyOn(internal.controller, "report");
    const drawBars = vi.spyOn(spectrumRenderer, "drawBars");
    drawBars.mockClear();
    t.view.setState({ visible: true, paused: false });
    await t.advance(100);
    expect(internal.drawOptions).toBe(options);
    expect(drawBars.mock.calls.every(([, drawOptions]) => drawOptions === options)).toBe(true);
    expect(report).toHaveBeenCalled();
    expect(report.mock.calls.every(([nowMs, costMs, intervalMs]) => [nowMs, costMs, intervalMs].every(Number.isFinite))).toBe(
      true,
    );
  });

  it("switches the native analyser on when visible and off when hidden, the document is hidden or it is disposed", async () => {
    const t = setup();
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: true, paused: false });
    t.view.setDocumentShowing(false);
    t.view.setDocumentShowing(true);
    t.view.setState({ visible: false, paused: false });
    t.view.setState({ visible: true, paused: false });
    t.view.dispose();
    expect(t.setEnabled.mock.calls.map((c) => c[0])).toEqual([true, false, true, false, true, false]);
  });

  it("makes no calls and schedules nothing while it is not visible", async () => {
    const t = setup();
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: false, paused: false });
    await t.advance(1000);
    expect(t.reads).toHaveLength(0);
    expect(t.hasFrameScheduled()).toBe(false);
  });

  it("polls at the data rate of its tier, not at the draw rate", async () => {
    const t = setup();
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(1000);
    expect(t.reads.length).toBeGreaterThanOrEqual(25);
    expect(t.reads.length).toBeLessThanOrEqual(32);
  });

  it("starts at tier 1 on the compact profile and polls at 20 Hz", async () => {
    const t = setup({ profile: "compact" });
    t.view.resize(300, 150, 1);
    expect(t.view.currentTier.index).toBe(1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(1000);
    expect(t.reads.length).toBeLessThanOrEqual(22);
    expect(t.reads.length).toBeGreaterThanOrEqual(16);
  });

  it("does not draw a new target for a frame it already has", async () => {
    let calls = 0;
    const t = setup({ frames: () => frame({ sequence: 5, bands: new Array(48).fill(calls++ === 0 ? -20 : -90) }) });
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(600);
    const loud = t.ctx.fills.filter((f) => f.h > 40);
    expect(loud.length).toBeGreaterThan(0);
  });

  it("disables the native analyser on pause while allowing the bars to decay without further reads", async () => {
    const t = setup();
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(400);
    t.view.setState({ visible: true, paused: true });
    expect(t.setEnabled.mock.calls.map((call) => call[0])).toEqual([true, false]);
    expect(t.active.at(-1)).toBe(false);
    await t.advance(6000);
    expect(t.hasFrameScheduled()).toBe(false);
    const readsAfterPause = t.reads.length;
    await t.advance(2000);
    expect(t.reads.length).toBe(readsAfterPause);
    t.view.setState({ visible: true, paused: false });
    expect(t.hasFrameScheduled()).toBe(true);
  });

  it("logs a rejected frame poll and continues polling without an unhandled rejection", async () => {
    const failedRead = vi.fn(async () => Promise.reject(new Error("bridge unavailable")));
    const t = setup({ read: failedRead });
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(100);
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Spectrum: frame poll failed",
      expect.objectContaining({ service: "audio-fx", idle: false, error: expect.stringContaining("bridge unavailable") }),
    );
    expect(failedRead.mock.calls.length).toBeGreaterThan(1);
  });

  it("keeps a pending read single-flight across visibility changes and ignores its stale reply", async () => {
    let resolvePending: ((value: SpectrumFrame | null) => void) | undefined;
    const read = vi.fn(
      () =>
        new Promise<SpectrumFrame | null>((resolve) => {
          resolvePending = resolve;
        }),
    );
    const t = setup({ read });
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(40);
    expect(read).toHaveBeenCalledTimes(1);

    t.view.setState({ visible: false, paused: false });
    t.view.setState({ visible: true, paused: false });
    await t.advance(200);
    expect(read).toHaveBeenCalledTimes(1);

    resolvePending?.(frame({ active: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(t.active).toEqual([]);
    await t.advance(40);
    expect(read).toHaveBeenCalledTimes(2);
    t.view.dispose();
  });

  it("stops waiting for a hung bridge read without starting an overlapping replacement", async () => {
    const read = vi.fn(() => new Promise<SpectrumFrame | null>(() => undefined));
    const t = setup({ read });
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(SPECTRUM_READ_WAIT_MS + 200);
    expect(read).toHaveBeenCalledTimes(1);
    expect(t.hasFrameScheduled()).toBe(false);
    t.view.dispose();
  });

  it("treats a source that stops delivering new frames as silent", async () => {
    let sequence = 0;
    let frozen = false;
    const t = setup({ frames: () => frame({ sequence: frozen ? sequence : ++sequence }) });
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(300);
    expect(t.readouts.at(-1)?.rmsDb).toBe(-20);
    frozen = true;
    await t.advance(SPECTRUM_STALE_AFTER_MS + 600);
    expect(t.readouts.at(-1)?.rmsDb).toBeNull();
  });

  it("reports activity transitions and falls back to a slow poll that notices sound starting", async () => {
    let playing = false;
    let seq = 0;
    const t = setup({ frames: () => frame({ active: playing, sequence: ++seq }) });
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(500);
    expect(t.active).toEqual([]);
    expect(t.hasFrameScheduled()).toBe(false);
    playing = true;
    await new Promise((resolve) => setTimeout(resolve, SPECTRUM_IDLE_POLL_MS + 150));
    await Promise.resolve();
    expect(t.active).toEqual([true]);
    expect(t.hasFrameScheduled()).toBe(true);
    t.view.dispose();
  });

  it("latches the clip lamp for 1.5 s after the last clipped frame", async () => {
    let clipped = true;
    const t = setup({ frames: () => frame({ clipped, sequence: Math.floor(t.nowMs / 10) + 1 }) });
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(200);
    expect(t.readouts.at(-1)?.clipped).toBe(true);
    clipped = false;
    await t.advance(CLIP_LAMP_HOLD_MS - 400);
    expect(t.readouts.at(-1)?.clipped).toBe(true);
    await t.advance(600);
    expect(t.readouts.at(-1)?.clipped).toBe(false);
  });

  it("drops to a cheaper tier when frames are late, and reports it", async () => {
    const t = setup();
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(1000);
    expect(t.tiers).toEqual([]);
    await t.advance(4000, 70);
    expect(t.tiers[0]).toBe(1);
    expect(t.view.currentTier.index).toBeGreaterThanOrEqual(1);
  });

  it("ignores a frame with the wrong number of bands", async () => {
    const t = setup({ frames: () => frame({ bands: [1, 2, 3] }) });
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(300);
    expect(t.readouts.every((r) => r.rmsDb === null)).toBe(true);
  });
});
