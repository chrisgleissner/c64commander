/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  LocalSidEngine,
  type LocalSidPlayCallbacks,
  type LocalSidPlayResult,
  type LocalSidStats,
} from "./localSidEngine";
import { addLog } from "@/lib/logging";

/**
 * Thin lifecycle wrapper the playback controller (LE2) holds in a ref to route
 * SID playback onto the device. It owns a single {@link LocalSidEngine},
 * reading the SID bytes from the same `LocalPlayFile` the C64 path uses, so the
 * controller stays engine-agnostic. The engine is lazily created (no worker /
 * WASM cost until the Local engine is actually used) and injected in tests.
 */

/** The slice of `LocalPlayFile` we need — just the raw bytes. */
export interface SidByteSource {
  arrayBuffer(): Promise<ArrayBuffer>;
  name?: string;
}

export type LocalSidEngineFactory = () => LocalSidEngine;

/**
 * The one on-device playback engine for the whole app.
 *
 * This MUST be process-wide, not per-component. The controller used to live in
 * a `useRef` inside `usePlaybackController`, so every `PlayFilesPage` instance
 * built its own engine — and each engine owns its own `AudioContext`, worker
 * and scheduled buffers. Navigating away from Play and back mounts a fresh
 * page (React can also mount a transient second one during a tab switch), and
 * nothing tore the previous engine down, so its audio simply kept playing.
 * Repeated tab navigation while a tune was playing left **eight** concurrent
 * AAudio streams from one process, all rendering different tunes on top of one
 * another.
 *
 * A shared instance makes the overlap structurally impossible: `play()` always
 * stops whatever this engine was doing first, so "start a tune" can never mean
 * "start a second, parallel tune" no matter how the UI is navigated.
 */
let sharedController: LocalSidPlaybackController | null = null;

export const getSharedLocalSidPlaybackController = (): LocalSidPlaybackController => {
  if (!sharedController) sharedController = new LocalSidPlaybackController();
  return sharedController;
};

/** Drop the shared engine (tests, and a full teardown). */
export const resetSharedLocalSidPlaybackController = (): void => {
  sharedController?.dispose();
  sharedController = null;
};

export class LocalSidPlaybackController {
  private engine: LocalSidEngine | null = null;

  constructor(private readonly engineFactory: LocalSidEngineFactory = () => new LocalSidEngine()) {}

  /** True when on-device playback (Web Worker + Web Audio) is available. */
  static isSupported(): boolean {
    return LocalSidEngine.isSupported();
  }

  private ensureEngine(): LocalSidEngine {
    if (!this.engine) this.engine = this.engineFactory();
    return this.engine;
  }

  /**
   * Read the SID bytes and start on-device playback. Resolves with the tune's
   * format; a `romRequired` result means playback was NOT started and the
   * caller must fall back to the C64 (spec §12.2).
   */
  async play(
    file: SidByteSource,
    songIndex: number,
    callbacks: LocalSidPlayCallbacks = {},
  ): Promise<LocalSidPlayResult> {
    const engine = this.ensureEngine();
    // Timed separately from the engine open: opening measures 23-48 ms on a
    // Pixel 4 while a skip can take seconds, so the difference is upstream of
    // the engine and reading the bytes is the first suspect.
    const readStartedAt = performance.now();
    const buffer = await file.arrayBuffer();
    addLog("debug", "Local SID bytes read", {
      service: "local-sid",
      readMs: performance.now() - readStartedAt,
      bytes: buffer.byteLength,
    });
    return engine.play(buffer, songIndex, callbacks);
  }

  /** True while this device is actually rendering a tune. */
  isActive(): boolean {
    return this.engine?.isActive() ?? false;
  }

  /** Current playback position in seconds, 0 when nothing is open. */
  positionSeconds(): number {
    return this.engine?.getStats().positionSeconds ?? 0;
  }

  /** Stop the current tune (keeps the worker + WASM module warm). */
  stop(): void {
    this.engine?.stop();
  }

  /** Pause on-device playback in place (no C64 involved). */
  async pause(): Promise<void> {
    await this.engine?.pause();
  }

  /**
   * Scrub within the current tune, relative to where it is now.
   *
   * Backwards is inherently slower than forwards: libsidplayfp cannot rewind, so
   * the engine reloads the tune and re-renders up to the target. Clamped at 0 so
   * rewinding past the start lands on the start rather than failing.
   */
  async seekBy(deltaSeconds: number): Promise<void> {
    const engine = this.engine;
    if (!engine) return;
    const target = Math.max(0, engine.getStats().positionSeconds + deltaSeconds);
    await engine.seekTo(target);
  }

  /**
   * Jump to an absolute position, for scrubbing.
   *
   * Seeking backwards costs time proportional to the target: libsidplayfp
   * cannot rewind, so the engine reloads the tune and re-renders up to the
   * point asked for. A scrub therefore has to coalesce — seek to where the
   * finger is NOW, not once per repeat tick.
   */
  async seekTo(positionSeconds: number): Promise<void> {
    await this.engine?.seekTo(Math.max(0, positionSeconds));
  }

  /** Resume after {@link pause}. */
  async resume(): Promise<void> {
    await this.engine?.resume();
  }

  /** Live playback stats for the HIL / on-screen blob, or null before first play. */
  getStats(): LocalSidStats | null {
    return this.engine?.getStats() ?? null;
  }

  /** Tear down the engine + worker entirely (release WASM memory). */
  dispose(): void {
    this.engine?.dispose();
    this.engine = null;
  }
}
