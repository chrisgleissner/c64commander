/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));
vi.mock("@/lib/native/audioFx", () => ({
  readSpectrum: vi.fn(async () => null),
  setSpectrumDemand: vi.fn(async () => true),
}));

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
import { readSpectrum, setSpectrumDemand } from "@/lib/native/audioFx";
import * as spectrumRenderer from "@/lib/audio/spectrum/spectrumRenderer";

const makeContext = () => {
  const fills: Array<{ x: number; y: number; w: number; h: number }> = [];
  const strokedPaths: number[][] = [];
  let path: number[] = [];
  const gradient = { addColorStop: vi.fn() };
  const ctx = {
    fills,
    strokedPaths,
    fillStyle: "",
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => fills.push({ x, y, w, h })),
    clearRect: vi.fn(),
    beginPath: vi.fn(() => {
      path = [];
    }),
    moveTo: vi.fn((_x: number, y: number) => path.push(y)),
    lineTo: vi.fn((_x: number, y: number) => path.push(y)),
    stroke: vi.fn(() => strokedPaths.push([...path])),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 4 })),
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
  channels: [
    { id: "left", rmsDb: overrides.rmsDb ?? -20, peakDb: overrides.peakDb ?? -6, clipped: overrides.clipped ?? false },
    { id: "right", rmsDb: overrides.rmsDb ?? -20, peakDb: overrides.peakDb ?? -6, clipped: overrides.clipped ?? false },
  ],
  ...overrides,
});

const setup = (
  options: {
    profile?: string;
    frames?: () => SpectrumFrame | null;
    read?: () => Promise<SpectrumFrame | null>;
    reducedMotion?: boolean;
    createLayer?: () => null;
    setEnabled?: () => Promise<boolean>;
    keepCancelledFrame?: boolean;
    mode?: "bars" | "wave";
  } = {},
) => {
  const ctx = makeContext();
  const layerCtx = makeContext();
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  let nowMs = 0;
  let pending: ((t: number) => void) | null = null;
  const reads: number[] = [];
  const targets: Array<number | undefined> = [];
  const requests: Array<
    { targetNanos?: number; count?: number; stepNanos?: number; wave?: boolean; bands?: boolean } | undefined
  > = [];
  const readouts: SpectrumReadout[] = [];
  const active: boolean[] = [];
  const tiers: number[] = [];
  const setEnabled = vi.fn(options.setEnabled ?? (async () => true));
  const view = new SpectrumView({
    canvas,
    profile: options.profile ?? "medium",
    mode: options.mode,
    onReadout: (r) => readouts.push(r),
    onActiveChange: (a) => active.push(a),
    onTierChange: (t) => tiers.push(t.index),
    read: async (request?: {
      targetNanos?: number;
      count?: number;
      stepNanos?: number;
      wave?: boolean;
      bands?: boolean;
    }) => {
      reads.push(nowMs);
      targets.push(request?.targetNanos);
      requests.push(request);
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
      if (!options.keepCancelledFrame) pending = null;
    },
    createLayer:
      options.createLayer ??
      (() => ({ canvas: {} as CanvasImageSource, context: layerCtx as unknown as CanvasRenderingContext2D })),
    reducedMotion: () => options.reducedMotion ?? false,
    deviceSignals: () => ({ hardwareConcurrency: 8, deviceMemory: 8 }),
  });
  const advance = async (ms: number, step = 17) => {
    for (let spent = 0; spent < ms; spent += step) {
      nowMs += step;
      const callback = pending;
      pending = null;
      callback?.(nowMs);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    }
  };
  return {
    view,
    canvas: canvas as HTMLCanvasElement & { __spectrumView?: unknown },
    ctx,
    layerCtx,
    reads,
    targets,
    requests,
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

  it("draws live meters with held caps every spectrum frame without waiting for the text readout", async () => {
    const t = setup();
    t.view.resize(300, 234, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(85);
    expect(t.readouts).toHaveLength(0);
    const meters = t.ctx.fills.filter((f) => f.y === 10 || f.y === 34);
    expect(meters.length).toBeGreaterThan(2);
    expect(meters.some((f) => f.w > 100)).toBe(true);
    expect(t.ctx.fills.some((f) => f.y === 8 && f.h === 18)).toBe(true);
    t.view.dispose();
  });

  it("keeps stereo rows when equal channel levels later diverge during the same playback", async () => {
    let different = false;
    let sequence = 0;
    const t = setup({
      frames: () =>
        frame({
          sequence: ++sequence,
          channels: [
            { id: "left", rmsDb: -20, peakDb: -6, clipped: false },
            { id: "right", rmsDb: different ? -40 : -20, peakDb: different ? -26 : -6, clipped: false },
          ],
        }),
    });
    t.view.resize(300, 234, 1);
    const labelsDrawn = t.layerCtx.fillText.mock.calls.length;
    t.view.setState({ visible: true, paused: false });
    await t.advance(150);
    expect(t.readouts.at(-1)?.channels).toHaveLength(2);
    different = true;
    await t.advance(150);
    expect(t.readouts.at(-1)?.channels?.map((channel) => channel.rmsDb)).toEqual([-20, -40]);
    expect(t.layerCtx.fillText.mock.calls).toHaveLength(labelsDrawn);
    t.view.dispose();
  });

  it("marks only the clipped channel's meter and releases the mark after the hold time", async () => {
    let sequence = 0;
    const t = setup({
      frames: () =>
        frame({
          sequence: ++sequence <= 3 ? sequence : 3,
          channels: [
            { id: "left", rmsDb: -20, peakDb: -6, clipped: false },
            { id: "right", rmsDb: -20, peakDb: -6, clipped: sequence <= 3 },
          ],
        }),
    });
    t.view.resize(300, 234, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(100);
    const clipBlocks = () => t.ctx.fills.filter((f) => f.w === 6 && f.h === 14);
    expect(clipBlocks().length).toBeGreaterThan(0);
    expect(new Set(clipBlocks().map((f) => f.y))).toEqual(new Set([34]));
    t.ctx.fills.length = 0;
    await t.advance(2500);
    t.ctx.fills.length = 0;
    await t.advance(100);
    expect(clipBlocks()).toHaveLength(0);
    t.view.dispose();
  });

  it("labels a bridge-reported mono channel Mono and keeps a single row", async () => {
    const t = setup({ frames: () => frame({ channels: [{ id: "mono", rmsDb: -20, peakDb: -6, clipped: false }] }) });
    t.view.resize(300, 234, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(150);
    expect(t.layerCtx.fillText.mock.calls.some(([text]) => text === "Mono")).toBe(true);
    const rowLabels = t.layerCtx.fillText.mock.calls
      .map(([text]) => text)
      .filter((text) => ["L", "R", "Mix", "Mono"].includes(text));
    expect(rowLabels.at(-1)).toBe("Mono");
    t.view.dispose();
  });

  it("marks the single Mix meter as clipped when an older bridge reports clipping", async () => {
    const t = setup({ frames: () => frame({ channels: undefined, clipped: true }) });
    t.view.resize(300, 234, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(100);
    expect(t.ctx.fills.some((f) => f.w === 6 && f.h === 14)).toBe(true);
    t.view.dispose();
  });

  it("asks for the sound audible when the frame will be shown once the native clock is known", async () => {
    const nativeOffsetMs = 5000;
    const t: ReturnType<typeof setup> = setup({
      frames: () => frame({ timestampNanos: Math.round((t.nowMs + nativeOffsetMs) * 1e6) }),
    });
    t.view.resize(300, 234, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(400);
    expect(t.targets.length).toBeGreaterThan(5);
    expect(t.targets[0]).toBe(0);
    const lastIndex = t.targets.length - 1;
    const askedAt = t.reads[lastIndex];
    const aheadMs = t.targets[lastIndex]! / 1e6 - nativeOffsetMs - askedAt;
    expect(aheadMs).toBeGreaterThan(30);
    expect(aheadMs).toBeLessThan(36);
    t.view.dispose();
  });

  describe("with a native path that can look ahead", () => {
    const nativeOffsetMs = 5000;
    const stepMs = 17;
    const aligned = (t: ReturnType<typeof setup>, loud: boolean) => {
      const request = t.requests.at(-1);
      const sequences = (request?.count ?? 1) > 1 ? request!.count! : 1;
      const base = 100 + Math.round(((request?.targetNanos ?? 0) / 1e6 - nativeOffsetMs) / stepMs);
      const build = (k: number) =>
        frame({
          sequence: base + k,
          aligned: true,
          timestampNanos: Math.round((t.nowMs + nativeOffsetMs) * 1e6),
          bands: new Array(48).fill(loud ? -10 : -80),
        });
      const first = build(0);
      first.ahead = Array.from({ length: sequences - 1 }, (_, i) => build(i + 1));
      return first;
    };

    it("asks for several frames at once and not on every display frame", async () => {
      const t: ReturnType<typeof setup> = setup({ frames: () => aligned(t, true) });
      t.view.resize(300, 234, 1);
      t.view.setState({ visible: true, paused: false });
      await t.advance(1000);
      const alignedRequests = t.requests.filter((request) => (request?.count ?? 1) > 1);
      expect(alignedRequests.length).toBeGreaterThan(5);
      expect(alignedRequests[0]!.count).toBe(8);
      expect(alignedRequests[0]!.stepNanos).toBeGreaterThan(15e6);
      expect(t.reads.length).toBeLessThan(35);
      t.view.dispose();
    });

    it("keeps its estimate of the display frame period when one draw is late", async () => {
      const t: ReturnType<typeof setup> = setup({ frames: () => aligned(t, true) });
      t.view.resize(300, 234, 1);
      t.view.setState({ visible: true, paused: false });
      await t.advance(300);
      await t.advance(1, 120);
      await t.advance(150);
      const steps = t.requests.filter((request) => (request?.count ?? 1) > 1).map((request) => request!.stepNanos!);
      expect(steps.length).toBeGreaterThan(4);
      for (const step of steps) {
        expect(step).toBeGreaterThan(15e6);
        expect(step).toBeLessThan(19e6);
      }
      t.view.dispose();
    });

    it("drops frames queued for an old position once the native path stops reporting a speaker", async () => {
      let alignedReplies = true;
      const t: ReturnType<typeof setup> = setup({
        frames: () => {
          const reply = aligned(t, true);
          if (!alignedReplies) {
            reply.aligned = false;
            reply.ahead = undefined;
          }
          return reply;
        },
      });
      t.view.resize(300, 234, 1);
      t.view.setState({ visible: true, paused: false });
      await t.advance(300);
      expect(t.view.pendingFrameCount).toBeGreaterThan(0);
      alignedReplies = false;
      await t.advance(100);
      expect(t.view.pendingFrameCount).toBe(0);
      t.view.dispose();
    });

    it("keeps a clip block up for one hold after the first report, not one hold per report", async () => {
      let sequence = 0;
      const t: ReturnType<typeof setup> = setup({
        frames: () => {
          const clipping = t.nowMs < 1000;
          return frame({
            sequence: ++sequence,
            clipped: clipping,
            channels: [
              { id: "left", rmsDb: -20, peakDb: 0, clipped: clipping },
              { id: "right", rmsDb: -20, peakDb: -6, clipped: false },
            ],
          });
        },
      });
      t.view.resize(300, 234, 1);
      t.view.setState({ visible: true, paused: false });
      const clipBlocks = () => t.ctx.fills.filter((f) => f.w === 6 && f.h === 14);
      await t.advance(200);
      expect(clipBlocks().length).toBeGreaterThan(0);
      await t.advance(2000);
      t.ctx.fills.length = 0;
      await t.advance(100);
      expect(clipBlocks()).toHaveLength(0);
      t.view.dispose();
    });

    it("records how far each draw was from the display time of the sound it showed", async () => {
      const t: ReturnType<typeof setup> = setup({ frames: () => aligned(t, true) });
      t.view.resize(300, 234, 1);
      t.view.setState({ visible: true, paused: false });
      await t.advance(600);
      const errors = t.view.alignmentErrorsMs().sort((a, b) => a - b);
      expect(errors.length).toBeGreaterThan(20);
      const median = errors[errors.length >> 1];
      expect(Math.abs(median)).toBeLessThanOrEqual(stepMs / 4);
      t.view.dispose();
    });

    it("keeps frames for later display times waiting and shows each at its own tick", async () => {
      let issued = 0;
      const t: ReturnType<typeof setup> = setup({
        frames: () => {
          const first = aligned(t, true);
          issued += 1;
          return first;
        },
      });
      t.view.resize(300, 234, 1);
      t.view.setState({ visible: true, paused: false });
      let mostWaiting = 0;
      for (let tick = 0; tick < 20; tick++) {
        await t.advance(17);
        mostWaiting = Math.max(mostWaiting, t.view.pendingFrameCount);
      }
      expect(issued).toBeGreaterThan(1);
      expect(mostWaiting).toBeGreaterThanOrEqual(2);
      expect(mostWaiting).toBeLessThanOrEqual(14);
      t.view.dispose();
    });
  });

  it("exposes itself on its canvas only when test probes are enabled", () => {
    const probeWindow = window as unknown as { __c64uTestProbeEnabled?: boolean };
    const off = setup();
    expect(off.canvas.__spectrumView).toBeUndefined();
    probeWindow.__c64uTestProbeEnabled = true;
    const on = setup();
    expect(on.canvas.__spectrumView).toBe(on.view);
    delete probeWindow.__c64uTestProbeEnabled;
  });

  it("raises the held meter peak to a one-frame transient at once", async () => {
    let sequence = 0;
    const t = setup({
      frames: () =>
        frame({
          sequence: ++sequence,
          channels: [
            { id: "left", rmsDb: -60, peakDb: sequence === 3 ? 0 : -60, clipped: false },
            { id: "right", rmsDb: -60, peakDb: -60, clipped: false },
          ],
        }),
    });
    t.view.resize(300, 234, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(120);
    const capWidth = 3;
    const caps = t.ctx.fills.filter((f) => f.h === 18 && f.y === 8);
    expect(
      caps.some((f) => Math.abs(f.x + f.w - spectrumRenderer.computeLayout(300, 234, 14).plotRight) <= capWidth),
    ).toBe(true);
    t.view.dispose();
  });

  it("shows one honest Mix meter for an older bridge with only aggregate levels", async () => {
    const t = setup({ frames: () => frame({ channels: undefined }) });
    t.view.resize(300, 234, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(150);
    expect(t.readouts.at(-1)?.channels).toEqual([{ label: "Mix", rmsDb: -20, peakDb: -6 }]);
    t.view.dispose();
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
    expect(
      report.mock.calls.every(([nowMs, costMs, intervalMs]) => [nowMs, costMs, intervalMs].every(Number.isFinite)),
    ).toBe(true);
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

  it("polls at the fixed data rate, not at the draw rate", async () => {
    const t = setup();
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(1000);
    expect(t.reads.length).toBeGreaterThanOrEqual(50);
    expect(t.reads.length).toBeLessThanOrEqual(62);
  });

  it("starts at tier 0 on the compact profile and polls at 60 Hz", async () => {
    const t = setup({ profile: "compact" });
    t.view.resize(300, 150, 1);
    expect(t.view.currentTier.index).toBe(0);
    t.view.setState({ visible: true, paused: false });
    await t.advance(1000);
    expect(t.reads.length).toBeGreaterThanOrEqual(50);
    expect(t.reads.length).toBeLessThanOrEqual(62);
  });

  it.each([16.6, 11.1, 8.33])("polls at no more than 60 Hz when the display draws every %s ms", async (frameMs) => {
    const t = setup();
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(3000, frameMs);
    expect(t.reads.length / 3).toBeGreaterThanOrEqual(44);
    expect(t.reads.length / 3).toBeLessThanOrEqual(61);
  });

  it("does not draw a new target for a frame it already has", async () => {
    let calls = 0;
    const t = setup({ frames: () => frame({ sequence: 5, bands: new Array(48).fill(calls++ === 0 ? -20 : -90) }) });
    t.view.resize(300, 234, 1);
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
      expect.objectContaining({
        service: "audio-fx",
        idle: false,
        error: expect.stringContaining("bridge unavailable"),
      }),
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

  it("logs a rejected analyser switch, whether it rejects with an Error or a bare value", async () => {
    const failing = setup({ setEnabled: async () => Promise.reject(new Error("plugin gone")) });
    failing.view.setState({ visible: true, paused: false });
    await Promise.resolve();
    await Promise.resolve();
    const bare = setup({ setEnabled: () => Promise.reject("refused") });
    bare.view.setState({ visible: true, paused: false });
    await Promise.resolve();
    await Promise.resolve();
    const errors = vi
      .mocked(addLog)
      .mock.calls.filter(([, message]) => message === "Spectrum: changing analyser state failed")
      .map(([, , details]) => (details as { error: string; enabled: boolean }).error);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("plugin gone");
    expect(errors[1]).toBe("refused");
  });

  it("logs a frame poll that rejects with a bare value", async () => {
    const t = setup({ read: () => Promise.reject("bridge down") });
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(60);
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Spectrum: frame poll failed",
      expect.objectContaining({ error: "bridge down" }),
    );
  });

  it("logs the message of a failure that carries no stack trace", async () => {
    const stackless = () => Object.assign(new Error("no stack here"), { stack: undefined });
    const t = setup({ read: () => Promise.reject(stackless()), setEnabled: () => Promise.reject(stackless()) });
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(60);
    const messages = vi
      .mocked(addLog)
      .mock.calls.filter(([, message]) => /changing analyser state failed|frame poll failed/.test(String(message)))
      .map(([, , details]) => (details as { error: string }).error);
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages.every((m) => m === "no stack here")).toBe(true);
  });

  it("does not report activity for an empty reply", async () => {
    const t = setup({ frames: () => null });
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: true, paused: false });
    await t.advance(200);
    expect(t.reads.length).toBeGreaterThan(1);
    expect(t.active).toEqual([]);
    expect(t.readouts.every((r) => r.rmsDb === null)).toBe(true);
  });

  it("builds the fixed layer once per size and again when the size changes, updating the shared draw options", async () => {
    const t = setup();
    const drawBars = vi.spyOn(spectrumRenderer, "drawBars");
    drawBars.mockClear();
    t.view.refreshTheme();
    expect(t.layerCtx.fillText).not.toHaveBeenCalled();
    t.view.resize(300, 150, 1);
    const firstContextCalls = t.layerCtx.fillText.mock.calls.length;
    t.view.resize(300, 150, 1);
    expect(t.layerCtx.fillText.mock.calls.length).toBe(firstContextCalls);
    t.view.refreshTheme();
    expect(t.layerCtx.fillText.mock.calls.length).toBe(firstContextCalls * 2);
    t.view.resize(420, 200, 2);
    const lastOptions = drawBars.mock.calls.at(-1)?.[1];
    expect(lastOptions?.layout.width).toBe(420);
    expect(lastOptions?.layout.height).toBe(200);
    expect(lastOptions?.ratio).toBe(2);
  });

  it("still draws bars when the offscreen layer cannot be created", () => {
    const t = setup({ createLayer: () => null });
    t.view.resize(300, 150, 1);
    expect(t.ctx.drawImage).not.toHaveBeenCalled();
    expect(t.layerCtx.fillText).not.toHaveBeenCalled();
  });

  it("draws nothing and still polls while the canvas has no size yet", async () => {
    const t = setup();
    t.view.setState({ visible: true, paused: false });
    await t.advance(200);
    expect(t.ctx.drawImage).not.toHaveBeenCalled();
    expect(t.reads.length).toBeGreaterThan(0);
  });

  it("keeps the glow off for reduced motion and on otherwise at the highest tier", async () => {
    const glows: boolean[][] = [];
    for (const reducedMotion of [false, true]) {
      const seen: boolean[] = [];
      const spy = vi.spyOn(spectrumRenderer, "drawBars").mockImplementation((_ctx, options) => {
        seen.push(options.glow);
      });
      const t = setup({ reducedMotion });
      t.view.resize(300, 150, 1);
      seen.length = 0;
      t.view.setState({ visible: true, paused: false });
      await t.advance(200);
      glows.push(seen);
      spy.mockRestore();
      t.view.dispose();
    }
    expect(glows[0].length).toBeGreaterThan(0);
    expect(glows[0].every((g) => g)).toBe(true);
    expect(glows[1].length).toBeGreaterThan(0);
    expect(glows[1].every((g) => !g)).toBe(true);
  });

  it("ignores a frame callback that fires after the view was hidden", async () => {
    const t = setup({ keepCancelledFrame: true });
    t.view.resize(300, 150, 1);
    t.view.setState({ visible: true, paused: false });
    t.view.setState({ visible: false, paused: false });
    const readsBefore = t.reads.length;
    await t.advance(100);
    expect(t.reads.length).toBe(readsBefore);
    expect(t.hasFrameScheduled()).toBe(false);
  });

  describe("with timers", () => {
    const silentAfterClip = () => {
      let n = 0;
      return () => {
        n += 1;
        return frame({
          sequence: n,
          active: n === 1,
          clipped: n === 1,
          bands: new Array(48).fill(-100),
          rmsDb: -100,
          peakDb: -100,
        });
      };
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("releases the clip lamp at the end of its hold even when the animation has gone idle", async () => {
      const t = setup({ frames: silentAfterClip() });
      t.view.resize(300, 150, 1);
      t.view.setState({ visible: true, paused: false });
      await t.advance(400);
      expect(t.readouts.at(-1)?.clipped).toBe(true);
      expect(t.hasFrameScheduled()).toBe(false);
      t.setNow(t.nowMs + CLIP_LAMP_HOLD_MS + 100);
      vi.advanceTimersByTime(CLIP_LAMP_HOLD_MS + 100);
      expect(t.readouts.at(-1)?.clipped).toBe(false);
      t.view.dispose();
    });

    it("cancels the pending clip release and idle poll when the view is hidden", async () => {
      const t = setup({ frames: silentAfterClip() });
      t.view.resize(300, 150, 1);
      t.view.setState({ visible: true, paused: false });
      await t.advance(400);
      const readsBefore = t.reads.length;
      t.view.setState({ visible: false, paused: false });
      t.setNow(t.nowMs + CLIP_LAMP_HOLD_MS + 100);
      const readoutsBefore = t.readouts.length;
      vi.advanceTimersByTime(CLIP_LAMP_HOLD_MS + 100);
      expect(t.readouts.length).toBe(readoutsBefore);
      expect(t.reads.length).toBe(readsBefore);
    });

    it("clears the idle poll timer when the view is disposed", async () => {
      const read = vi.fn(() => new Promise<SpectrumFrame | null>(() => undefined));
      const t = setup({ read });
      t.view.resize(300, 150, 1);
      t.view.setState({ visible: true, paused: false });
      await t.advance(SPECTRUM_READ_WAIT_MS + 200);
      expect(vi.getTimerCount()).toBe(1);
      t.view.dispose();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("does not start a second idle read while the first is still pending", async () => {
      const read = vi.fn(() => new Promise<SpectrumFrame | null>(() => undefined));
      const t = setup({ read });
      t.view.resize(300, 150, 1);
      t.view.setState({ visible: true, paused: false });
      await t.advance(SPECTRUM_READ_WAIT_MS + 200);
      vi.advanceTimersByTime(SPECTRUM_IDLE_POLL_MS * 3);
      expect(read).toHaveBeenCalledTimes(1);
      t.view.dispose();
    });
  });

  describe("with the default collaborators", () => {
    it("uses the bridge, the window animation frame, the root motion class and the navigator signals", async () => {
      const callbacks: Array<(timeMs: number) => void> = [];
      const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => callbacks.push(cb));
      const caf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
      const drawing = makeContext();
      const created: HTMLCanvasElement[] = [];
      const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
        this: HTMLCanvasElement,
      ) {
        created.push(this);
        return drawing as unknown as CanvasRenderingContext2D;
      });
      const hardwareConcurrency = vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(2);
      vi.mocked(readSpectrum).mockResolvedValue(frame());
      document.documentElement.classList.add("c64-motion-reduced");
      try {
        const canvas = document.createElement("canvas");
        const view = new SpectrumView({ canvas, profile: "medium" });
        expect(view.currentTier.index).toBe(1);
        view.resize(300, 150, 1);
        expect(created.length).toBe(2);
        expect(created[0]).toBe(canvas);
        expect(created[1]).not.toBe(canvas);
        view.setState({ visible: true, paused: false });
        expect(setSpectrumDemand).toHaveBeenLastCalledWith("spectrum-card", true);
        expect(raf).toHaveBeenCalledTimes(1);
        callbacks[0](16);
        await Promise.resolve();
        expect(readSpectrum).toHaveBeenCalled();
        expect(view.framesDrawn).toBe(1);
        view.setState({ visible: false, paused: false });
        expect(caf).toHaveBeenCalled();
        expect(setSpectrumDemand).toHaveBeenLastCalledWith("spectrum-card", false);
      } finally {
        document.documentElement.classList.remove("c64-motion-reduced");
        hardwareConcurrency.mockRestore();
        getContext.mockRestore();
        raf.mockRestore();
        caf.mockRestore();
      }
    });

    it("draws nothing when the canvas gives no 2D context at all", () => {
      const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
      try {
        const view = new SpectrumView({ canvas: document.createElement("canvas"), profile: "medium" });
        expect(() => view.resize(300, 150, 1)).not.toThrow();
        expect(() => view.refreshTheme()).not.toThrow();
        expect(getContext).toHaveBeenCalledTimes(1);
      } finally {
        getContext.mockRestore();
      }
    });

    it("creates no offscreen layer when the browser gives no 2D context", () => {
      const drawing = makeContext();
      let calls = 0;
      const getContext = vi
        .spyOn(HTMLCanvasElement.prototype, "getContext")
        .mockImplementation(() => (calls++ === 0 ? (drawing as unknown as CanvasRenderingContext2D) : null));
      try {
        const view = new SpectrumView({ canvas: document.createElement("canvas"), profile: "medium" });
        view.resize(300, 150, 1);
        expect(calls).toBe(2);
        expect(drawing.setTransform).toHaveBeenCalledTimes(1);
      } finally {
        getContext.mockRestore();
      }
    });
  });
  describe("Wave view", () => {
    const encodedWave = (value: number) => btoa(String.fromCharCode(...new Array(256).fill(value & 255)));
    const waveFrames = () => {
      let sequence = 0;
      return () =>
        frame({ sequence: ++sequence, wave: encodedWave(100), waveTriggered: true } as Partial<SpectrumFrame>);
    };
    const barFillsBelowMeters = (t: ReturnType<typeof setup>) =>
      t.ctx.fills.filter((f) => f.y >= spectrumRenderer.METER_AREA_HEIGHT_PX);

    it("asks for the wave and no bands in Wave view, and stops asking when it is switched back to Bars", async () => {
      const t = setup({ mode: "wave", frames: waveFrames() });
      t.view.resize(300, 194, 1);
      t.view.setState({ visible: true, paused: false });
      await t.advance(300);
      const waveRequests = t.requests.filter((r) => r !== undefined);
      expect(waveRequests.length).toBeGreaterThan(2);
      for (const request of waveRequests) {
        expect(request).toMatchObject({ wave: true, bands: false });
      }
      t.requests.length = 0;
      t.view.setMode("bars");
      await t.advance(300);
      expect(t.requests.length).toBeGreaterThan(2);
      for (const request of t.requests) {
        expect(request).not.toHaveProperty("wave");
        expect(request).not.toHaveProperty("bands");
      }
      t.view.dispose();
    });

    it("keeps asking for bands in Bars view, as before", async () => {
      const t = setup({ frames: waveFrames() });
      t.view.resize(300, 194, 1);
      t.view.setState({ visible: true, paused: false });
      await t.advance(200);
      expect(t.requests.length).toBeGreaterThan(1);
      for (const request of t.requests) expect(request ?? {}).not.toHaveProperty("wave");
      t.view.dispose();
    });

    it("draws the received wave as a line across the plot and no bars below the meters", async () => {
      const t = setup({ mode: "wave", frames: waveFrames() });
      t.view.resize(300, 194, 1);
      t.view.setState({ visible: true, paused: false });
      await t.advance(300);
      expect(t.ctx.lineTo.mock.calls.length).toBeGreaterThanOrEqual(255);
      expect(barFillsBelowMeters(t)).toEqual([]);
      t.view.dispose();
    });

    it("draws bars and no wave line in Bars view", async () => {
      const t = setup({ frames: waveFrames() });
      t.view.resize(300, 194, 1);
      t.view.setState({ visible: true, paused: false });
      await t.advance(300);
      expect(t.ctx.lineTo).not.toHaveBeenCalled();
      expect(barFillsBelowMeters(t).length).toBeGreaterThan(0);
      t.view.dispose();
    });

    it("redraws the fixed layer without the frequency labels when the view changes, and with them when it changes back", () => {
      const t = setup();
      t.view.resize(300, 194, 1);
      const labels = () => t.layerCtx.fillText.mock.calls.map((call) => call[0]);
      expect(labels()).toContain("Hz");
      t.layerCtx.fillText.mockClear();
      t.view.setMode("wave");
      expect(t.layerCtx.fillText).toHaveBeenCalled();
      expect(labels()).not.toContain("Hz");
      expect(t.layerCtx.stroke).toHaveBeenCalled();
      t.layerCtx.fillText.mockClear();
      t.view.setMode("bars");
      expect(labels()).toContain("Hz");
    });

    it("does nothing when asked for the view it is already showing", () => {
      const t = setup({ mode: "wave" });
      t.view.resize(300, 194, 1);
      t.layerCtx.fillText.mockClear();
      t.view.setMode("wave");
      expect(t.layerCtx.fillText).not.toHaveBeenCalled();
    });

    it("flattens the line when the source falls silent", async () => {
      let sounding = true;
      let sequence = 0;
      const t = setup({
        mode: "wave",
        frames: () =>
          frame({
            sequence: sounding ? ++sequence : sequence,
            wave: encodedWave(100),
            waveTriggered: true,
          } as Partial<SpectrumFrame>),
      });
      t.view.resize(300, 194, 1);
      t.view.setState({ visible: true, paused: false });
      await t.advance(200);
      sounding = false;
      await t.advance(1500);
      const ys = t.ctx.strokedPaths.filter((path) => path.length === 256).at(-1)!;
      expect(ys).toBeDefined();
      expect(new Set(ys).size).toBe(1);
      t.view.dispose();
    });
  });
});
