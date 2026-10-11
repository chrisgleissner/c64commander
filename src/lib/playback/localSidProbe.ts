/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { loadLocalEngineEnabled, resolveLocalSidModel, type LocalSidModel } from "@/lib/config/appSettings";
import { LocalSidEngine } from "./localSidEngine";
import type { SidRendererId } from "./sidRenderer/sidRendererAvailability";

export interface LocalSidProbeRequest {
  /** Base64 of the PSID/RSID file. */
  sid: string;
  songIndex?: number;
  renderer: SidRendererId;
  /** How long to play, in seconds. */
  seconds: number;
  /** Seek here halfway through, and time how long until the position passes it. */
  seekTo?: number;
  /** Pre-render this many seconds of the tune alongside, as the Play page does. */
  prerenderSeconds?: number;
  /** End as soon as the pre-render has finished, with `seconds` as the limit. */
  untilPrerendered?: boolean;
  /** Once the pre-render has finished, seek here and time the landing, which the cache answers. */
  seekAfterPrerender?: number;
  /** Then open this tune on the same engine, as a skip does, and time it. */
  next?: { sid: string; songIndex?: number };
  /** Output level, 0..1. 0 by default, so a probe is silent. */
  volume?: number;
}

export interface LocalSidProbeSample {
  atMs: number;
  positionSeconds: number;
  bufferedSeconds: number;
  audioUnderruns: number;
  renderMsPerSec: number;
}

export interface LocalSidProbeResult {
  renderer: SidRendererId;
  /** The chip a tune that names none was rendered with, so a host render can match it. */
  fallbackSidModel: LocalSidModel;
  started: boolean;
  openMs: number;
  firstPositionMs: number | null;
  seekLatencyMs: number | null;
  /** From starting the pre-render to its last slice, or null when it did not finish. */
  prerenderMs: number | null;
  cachedSeekLatencyMs: number | null;
  nextOpenMs: number | null;
  nextFirstPositionMs: number | null;
  samples: LocalSidProbeSample[];
  final: Record<string, unknown>;
  sink: Record<string, unknown> | null;
  jsHeapBytes: number | null;
  /** How late a 50 ms timer fired on the page's thread while the tune played: what the UI feels. */
  eventLoopLagMs: { mean: number; p95: number; max: number };
}

declare global {
  interface Window {
    __localSidProbe?: (request: LocalSidProbeRequest) => Promise<LocalSidProbeResult>;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const LAG_TICK_MS = 50;
/** How often the probe checks for a landing or a finished pre-render; samples are kept every 500 ms. */
const TICK_MS = 100;
const SAMPLE_MS = 500;
const NEXT_TUNE_LIMIT_MS = 15_000;

/** Starts timing a 50 ms timer; the returned function stops it and summarises how late it fired. */
const measureEventLoopLag = (): (() => LocalSidProbeResult["eventLoopLagMs"]) => {
  const lags: number[] = [];
  let expected = performance.now() + LAG_TICK_MS;
  const timer = setInterval(() => {
    const now = performance.now();
    lags.push(Math.max(0, now - expected));
    expected = now + LAG_TICK_MS;
  }, LAG_TICK_MS);
  return () => {
    clearInterval(timer);
    const sorted = [...lags].sort((a, b) => a - b);
    const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
    return {
      mean: sorted.length ? sorted.reduce((sum, lag) => sum + lag, 0) / sorted.length : 0,
      p95: at(0.95),
      max: sorted[sorted.length - 1] ?? 0,
    };
  };
};

/**
 * Device harness for on-device playback, the counterpart of `window.__sidRadioProbe`.
 *
 * Plays a tune through a real `LocalSidEngine` — the chosen renderer, the scheduler, the sink and,
 * on Android, the native audio feed — and reports how long it took to open, to reach the speaker
 * and to land a seek, with the engine's own stats sampled every 500 ms. Used by
 * `tools/sid-engines/android-bench.mjs` over CDP to measure the three renderers end to end on a
 * device, without driving the UI. A separate engine instance, disposed afterwards; silent unless a
 * volume is given. Installed only while on-device playback is enabled; `main.tsx` imports this
 * module only then, so it adds nothing to the startup bundle.
 */
export const registerLocalSidProbe = (): void => {
  if (typeof window === "undefined") return;
  if (!loadLocalEngineEnabled()) return;
  let running = false;
  window.__localSidProbe = async (request) => {
    // Two probes at once would each take the speaker from the other, and report the wreckage.
    if (running) throw new Error("A local SID probe is already running");
    running = true;
    const engine = new LocalSidEngine({ renderer: request.renderer });
    engine.setVolume(request.volume ?? 0);
    const startedAt = performance.now();
    const samples: LocalSidProbeSample[] = [];
    let firstPositionMs: number | null = null;
    let seekLatencyMs: number | null = null;
    let prerenderMs: number | null = null;
    let cachedSeekLatencyMs: number | null = null;
    let nextOpenMs: number | null = null;
    let nextFirstPositionMs: number | null = null;
    const stopLagMeasurement = measureEventLoopLag();
    try {
      const bytes = Uint8Array.from(atob(request.sid), (char) => char.charCodeAt(0));
      const key = `probe-${request.renderer}-${request.songIndex ?? 0}`;
      const result = await engine.play(bytes.slice().buffer, request.songIndex ?? 0, {}, key);
      const openMs = performance.now() - startedAt;
      const prerenderStartedAt = performance.now();
      if (request.prerenderSeconds) {
        engine.prerender(key, bytes.slice().buffer, request.songIndex ?? 0, request.prerenderSeconds);
      }
      let seekRequestedAt: number | null = null;
      let cachedSeekRequestedAt: number | null = null;
      for (let elapsed = 0; elapsed < request.seconds * 1000; elapsed += TICK_MS) {
        await sleep(TICK_MS);
        const stats = engine.getStats();
        const atMs = performance.now() - startedAt;
        if (firstPositionMs === null && stats.positionSeconds > 0) firstPositionMs = atMs;
        if (request.seekTo !== undefined && seekRequestedAt === null && elapsed >= (request.seconds * 1000) / 2) {
          seekRequestedAt = performance.now();
          void engine.seekTo(request.seekTo);
        } else if (seekRequestedAt !== null && seekLatencyMs === null && stats.positionSeconds > request.seekTo!) {
          seekLatencyMs = performance.now() - seekRequestedAt;
        }
        const prerendered =
          request.prerenderSeconds !== undefined &&
          engine.getPrerenderProgress() === null &&
          (engine.getRenderedSeconds() ?? 0) >= request.prerenderSeconds - 1;
        if (prerendered && prerenderMs === null) prerenderMs = performance.now() - prerenderStartedAt;
        const cachedTarget = request.seekAfterPrerender;
        if (prerendered && cachedTarget !== undefined && cachedSeekRequestedAt === null) {
          cachedSeekRequestedAt = performance.now();
          void engine.seekTo(cachedTarget);
        } else if (
          cachedSeekRequestedAt !== null &&
          cachedSeekLatencyMs === null &&
          stats.positionSeconds > cachedTarget!
        ) {
          cachedSeekLatencyMs = performance.now() - cachedSeekRequestedAt;
        }
        if (elapsed % SAMPLE_MS === 0) {
          samples.push({
            atMs,
            positionSeconds: stats.positionSeconds,
            bufferedSeconds: stats.bufferedSeconds,
            audioUnderruns: stats.audioUnderruns,
            renderMsPerSec: stats.renderMsPerSec,
          });
        }
        const seekSettled = cachedTarget === undefined || cachedSeekLatencyMs !== null;
        if (request.untilPrerendered && prerendered && seekSettled) break;
      }
      if (request.next) {
        const nextBytes = Uint8Array.from(atob(request.next.sid), (char) => char.charCodeAt(0));
        const nextAt = performance.now();
        await engine.play(nextBytes.buffer, request.next.songIndex ?? 0, {}, `${key}-next`);
        nextOpenMs = performance.now() - nextAt;
        for (let waited = 0; waited < NEXT_TUNE_LIMIT_MS && nextFirstPositionMs === null; waited += TICK_MS) {
          await sleep(TICK_MS);
          if (engine.getStats().positionSeconds > 0) nextFirstPositionMs = performance.now() - nextAt;
        }
      }
      const sinkDebug = (globalThis as Record<string, unknown>).__localSinkDebug as
        (() => Record<string, unknown>) | undefined;
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      return {
        renderer: request.renderer,
        fallbackSidModel: resolveLocalSidModel(),
        started: result.started,
        openMs,
        firstPositionMs,
        seekLatencyMs,
        prerenderMs,
        cachedSeekLatencyMs,
        nextOpenMs,
        nextFirstPositionMs,
        samples,
        final: { ...engine.getStats(), ...engine.debugState() },
        sink: sinkDebug?.() ?? null,
        jsHeapBytes: memory?.usedJSHeapSize ?? null,
        eventLoopLagMs: stopLagMeasurement(),
      };
    } finally {
      stopLagMeasurement();
      engine.dispose();
      running = false;
    }
  };
};
