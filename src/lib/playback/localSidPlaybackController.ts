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
    const buffer = await file.arrayBuffer();
    return engine.play(buffer, songIndex, callbacks);
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
