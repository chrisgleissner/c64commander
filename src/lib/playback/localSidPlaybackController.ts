/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { tuneChangeGapTracker } from "./tuneChangeGap";
import type { LocalSidEngine, LocalSidPlayCallbacks, LocalSidPlayResult, LocalSidStats } from "./localSidEngine";
import { localSidPlaybackSupported } from "./localSidSupport";
import { traceLocalSid } from "./localSidTrace";
import { addLog } from "@/lib/logging";
import { notifyPlaybackActivityChanged } from "./playbackActivitySignal";
import type { PendingSeekState } from "./pendingSeekStatus";

/**
 * Thin lifecycle wrapper the playback controller (LE2) holds in a ref to route
 * SID playback onto the device. It owns a single {@link LocalSidEngine},
 * reading the SID bytes from the same `LocalPlayFile` the C64 path uses, so the
 * controller stays engine-agnostic. The engine is loaded and created on first use, so neither its
 * code nor a worker or WASM module costs anything until the Local engine is actually used, and it
 * is injected in tests.
 */

/** The slice of `LocalPlayFile` we need — just the raw bytes. */
export interface SidByteSource {
  arrayBuffer(): Promise<ArrayBuffer>;
  name?: string;
}

export type LocalSidEngineFactory = () => LocalSidEngine | Promise<LocalSidEngine>;

/** Out of the startup bundle: the engine and its renderers are loaded the first time one is needed. */
const loadDefaultEngine = async (): Promise<LocalSidEngine> => new (await import("./localSidEngine")).LocalSidEngine();

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
  private loading: Promise<LocalSidEngine> | null = null;
  private disposed = false;
  /** The level and mute asked for before the engine existed, applied when it does. */
  private heldVolume: number | null = null;
  private heldMuted: boolean | null = null;
  private silenceHolds = 0;
  private readonly seekListeners = new Set<() => void>();

  constructor(private readonly engineFactory: LocalSidEngineFactory = loadDefaultEngine) {}

  /** True when on-device playback (Web Worker + Web Audio) is available. */
  static isSupported(): boolean {
    return localSidPlaybackSupported();
  }

  private ensureEngine(): Promise<LocalSidEngine> {
    if (this.engine) return Promise.resolve(this.engine);
    this.disposed = false;
    this.loading ??= Promise.resolve()
      .then(() => this.engineFactory())
      .then(
        (engine) => {
          this.loading = null;
          if (this.disposed) {
            engine.dispose();
            throw new Error("The local SID player was disposed while its engine was loading");
          }
          if (this.heldVolume !== null) engine.setVolume(this.heldVolume);
          if (this.heldMuted !== null || this.silenceHolds > 0) engine.setMuted(this.silenced());
          this.engine = engine;
          return engine;
        },
        (error: unknown) => {
          this.loading = null;
          throw new Error(`Loading the local SID engine failed: ${(error as Error)?.message ?? String(error)}`, {
            cause: error,
          });
        },
      );
    return this.loading;
  }

  /** Apply `apply` to the engine now if it exists, else once it has loaded; a load failure is logged. */
  private withEngine(operation: string, apply: (engine: LocalSidEngine) => void): void {
    if (this.engine) {
      apply(this.engine);
      return;
    }
    this.ensureEngine().then(apply, (error: unknown) =>
      addLog("warn", `Local SID ${operation} skipped: the engine did not load`, {
        service: "local-sid",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
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
    options?: { prerenderKey?: string; durationSeconds?: number; outgoingEndsAtSeconds?: number },
  ): Promise<LocalSidPlayResult> {
    const engine = await this.ensureEngine();
    // Timed separately from the engine open: opening measures 23-48 ms on a
    // Pixel 4 while a skip can take seconds, so the difference is upstream of
    // the engine and reading the bytes is the first suspect.
    const readStartedAt = performance.now();
    traceLocalSid("play-requested", { key: options?.prerenderKey ?? null });
    const buffer = await file.arrayBuffer();
    traceLocalSid("bytes-read", { ms: Math.round(performance.now() - readStartedAt), bytes: buffer.byteLength });
    // Taken before `play` transfers ownership of `buffer` to the worker.
    const copy = options?.prerenderKey ? buffer.slice(0) : new ArrayBuffer(0);
    addLog("debug", "Local SID bytes read", {
      service: "local-sid",
      readMs: performance.now() - readStartedAt,
      bytes: buffer.byteLength,
    });
    const result = await engine.play(
      buffer,
      songIndex,
      callbacks,
      options?.prerenderKey,
      options?.outgoingEndsAtSeconds,
    );
    traceLocalSid("engine-play-returned", {
      ms: Math.round(performance.now() - readStartedAt),
      started: result.started,
    });
    if (result.started) {
      tuneChangeGapTracker.noteTuneAudioStarted({
        durationMs: options?.durationSeconds ? options.durationSeconds * 1000 : null,
        auto: options?.outgoingEndsAtSeconds !== undefined,
        label: options?.prerenderKey,
      });
    }
    // Kick off a full render of this tune in the background so seeking inside
    // it becomes a buffer offset rather than a re-render from the start. Uses a
    // COPY of the bytes: `play` transferred the original to the worker, and the
    // pre-render runs on its own engine.
    if (!result.romRequired && options?.prerenderKey && options.durationSeconds) {
      engine.prerender(options.prerenderKey, copy, songIndex, options.durationSeconds);
    }
    // Tell the app something is playing here now. The transport controls read
    // this rather than a page's own state, so they work on a freshly mounted
    // Play page instead of waiting for its session restore.
    notifyPlaybackActivityChanged();
    return result;
  }

  /**
   * Render the whole tune in the background so seeking inside it is instant.
   *
   * `key` identifies the tune+subsong; the cache keeps previous/current/next.
   */
  prerender(key: string, sidBytes: ArrayBuffer, songIndex: number, seconds: number): void {
    this.withEngine("pre-render", (engine) => engine.prerender(key, sidBytes, songIndex, seconds));
  }

  /**
   * Load the engine without playing anything, so a later `play` opens in tens of milliseconds rather than
   * the second and a half a first load takes on a Pixel 4. A failed load is retried by that `play`.
   */
  preload(): void {
    this.ensureEngine()
      .then((engine) => engine.preload())
      .catch((error: unknown) =>
        addLog("debug", "Local SID engine preload failed", {
          service: "local-sid",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
  }

  /**
   * Render the opening of a track the listener has not asked for yet.
   *
   * Skipping to a warmed track starts from memory rather than from a cold renderer, which is what
   * removes the short pause a second or two into a fresh tune.
   */
  warmLeadIn(key: string, sidBytes: ArrayBuffer, songIndex: number, seconds: number): void {
    this.withEngine("lead-in", (engine) => engine.warmLeadIn(key, sidBytes, songIndex, seconds));
  }

  /** Position playback is waiting for the renderer to reach, or null. Drives the "catching up" state. */
  awaitedSeekSeconds(): number | null {
    return this.engine?.getAwaitedSeekSeconds() ?? null;
  }

  /**
   * The full pending-seek record, or null. See {@link LocalSidEngine.getPendingSeek}.
   *
   * The progress bar needs all of it: the target for the marker, the render head at the moment the
   * target was accepted for determinate progress, and the last audible position for the clock.
   */
  pendingSeek(): PendingSeekState | null {
    return this.engine?.getPendingSeek() ?? null;
  }

  /** True while any seek is still being worked on; see {@link LocalSidEngine.isSeeking}. */
  isSeeking(): boolean {
    return this.engine?.isSeeking() ?? false;
  }

  /** Seconds of the current tune already rendered; drives the progress bar's pre-render fill. */
  renderedSeconds(): number | null {
    return this.engine?.getRenderedSeconds() ?? null;
  }

  /** Engine internals for HIL diagnosis; see LocalSidEngine.debugState. */
  debugState(): Record<string, unknown> | null {
    return this.engine?.debugState() ?? null;
  }

  /** 0..1 while a pre-render is running, else null. */
  prerenderProgress(): number | null {
    return this.engine?.getPrerenderProgress() ?? null;
  }

  /** Output level for on-device playback, 0..1 (see LocalSidEngine.setVolume). */
  setVolume(value: number): void {
    this.heldVolume = value;
    this.engine?.setVolume(value);
  }

  setMuted(muted: boolean): void {
    this.heldMuted = muted;
    this.engine?.setMuted(this.silenced());
  }

  /**
   * Silences the output until the returned release is called, without touching the mute the listener
   * chose: a Mute set while the hold is on still applies after it.
   */
  holdSilence(): () => void {
    this.silenceHolds += 1;
    this.engine?.setMuted(true);
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.silenceHolds -= 1;
      this.engine?.setMuted(this.silenced());
    };
  }

  private silenced(): boolean {
    return this.silenceHolds > 0 || this.muted();
  }

  /**
   * The level and the listener's mute for on-device playback, without building an engine to ask.
   *
   * Read while the Play page mounts, which is long before anyone has chosen to play anything here,
   * so it must not be the thing that pays for a worker and a WASM module. Before an engine exists
   * the answer is the level a new one would start at.
   */
  volume(): number {
    return this.engine?.getVolume() ?? this.heldVolume ?? 1;
  }

  muted(): boolean {
    return this.heldMuted ?? false;
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
    // No notify here: `engine.stop()` reaches `stopPlayback()`, which is where
    // `isActive()` actually flips and where the notify lives — and that path
    // also covers an ownership eviction, which never comes through here.
    this.engine?.stop();
    tuneChangeGapTracker.reset();
  }

  /**
   * Pause on-device playback in place (no C64 involved).
   *
   * Deliberately does not notify: pausing suspends the audio clock but leaves
   * the tune loaded, so `isActive()` is unchanged and listeners would re-read an
   * identical snapshot. "Is a tune loaded" is the question they ask.
   */
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
    await this.announced(engine.seekTo(target));
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
    if (this.engine) await this.announced(this.engine.seekTo(Math.max(0, positionSeconds)));
  }

  /**
   * Told of every seek once the engine has accepted it, before it lands. Whether it waits for the
   * pre-render is decided by then, so the page can show the wait in the same update that ends the
   * gesture instead of showing the target as reached until its next poll.
   */
  onSeek(listener: () => void): () => void {
    this.seekListeners.add(listener);
    return () => this.seekListeners.delete(listener);
  }

  private announced(seek: Promise<void>): Promise<void> {
    for (const listener of this.seekListeners) listener();
    return seek;
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
    if (this.loading) this.disposed = true;
    this.engine?.dispose();
    this.engine = null;
  }
}
