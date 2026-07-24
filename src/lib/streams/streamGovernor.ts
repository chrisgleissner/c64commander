/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Adaptive Live View performance governor (spec §11).
 *
 * The mirror's expensive work is presenting video frames; audio must never be starved to keep it.
 * The governor decides, from live pipeline pressure, **what percentage of the source frame rate to
 * present** — a continuous target from 100% down to a floor. HIL measurement (Pixel 4 → C64U)
 * showed the two dominant costs — the native `Base64.encodeToString` of each frame and the WebView
 * decode+blit — both scale ~linearly with the *presented* frame rate, so a continuous target lets
 * the governor shed exactly as much as needed (e.g. drop to 85%) instead of halving in one jump.
 *
 * The percentage is realised downstream by a deterministic phase-accumulator decimator
 * (`VideoMirrorController`): to present p% of frames it accumulates p/100 each source frame and
 * presents when the accumulator crosses 1 — so 100/50/25 reduce to the exact every-1st/2nd/4th
 * cadence, and 73% averages 73% of source frames with a bounded, reproducible pattern.
 *
 * Represented internally as an **integer percent** (100…`minPercent`) to avoid floating-point drift
 * in the state machine and its tests.
 *
 * User "Video frame rate" mode sets a *maximum* rate = the ceiling percent:
 *   auto → 100   100% → 100   50% → 50   25% → 25
 * A manual mode is a requested MAXIMUM, not permission to lose audio or grow latency (§11.2): the
 * governor may push the effective percent BELOW the ceiling to protect audio, then recover. So
 * `effectivePercent = min(ceilingPercent, governorPercent)`.
 *
 * Design rules the tests pin (§11.4–§11.5):
 *   - Audio is never decimated here; this only gates VIDEO presentation.
 *   - Demote FAST: a single tick with an underrun / near-dry audio buffer / latency near budget /
 *     queue age near its cap drops the governor by `demoteStep` percent immediately.
 *   - Promote SLOW: only after sustained headroom, by `promoteStep` (< demoteStep) percent, one step
 *     per `promoteStableMs`, with a `promoteCooldownMs` between steps — the anti-oscillation guard.
 *   - Every change records requested vs effective, the reason and the time (§11.2, §12.1).
 *
 * Pure and deterministic: no timers, no I/O. The clock is passed to {@link update}; callers feed a
 * {@link GovernorSignals} snapshot on a low-rate tick (the telemetry cadence, ~4 Hz).
 */

export type FrameRateMode = "auto" | "100" | "50" | "25";

/** The rate ceiling (max presentable percent) each user mode allows. */
const CEILING_PERCENT: Record<FrameRateMode, number> = { auto: 100, "100": 100, "50": 50, "25": 25 };

export interface GovernorSignals {
  /**
   * WebAudio player buffer depth ahead of the audio output clock (ms). The primary headroom
   * signal: as this trends toward 0 the audio is about to run dry. See {@link AudioMirrorPlayer}.
   */
  audioBufferMs: number;
  /** Player underruns observed since the previous tick (audio output ran dry between chunks). */
  audioUnderruns: number;
  /**
   * Whether audio is actually playing this tick. When false (video-only session, or audio not yet
   * started) the audio buffer/underrun signals are meaningless — `audioBufferMs` is 0 because there
   * is no player, NOT because audio is starving — so they must not drive a demote. Default true.
   *
   * HIL (Pixel 4 → C64U) caught two false demotes without this gate: (1) a video-only mirror pegged
   * to the floor because bufferedMs was permanently 0, and (2) a ~9 s startup dip while the audio
   * buffer primed from 0. See also the `primed` latch below.
   */
  audioActive?: boolean;
  /** Estimated local-pipeline latency p99 (ms) this tick, if known (video render residence based). */
  localLatencyP99Ms?: number;
  /** Max video render-queue residence age (ms) observed this tick, if known. */
  videoQueueAgeMs?: number;
  /** Rolling frame-processing time p95 (ms), if known — sustained deadline misses force a demote. */
  frameProcessingP95Ms?: number;
}

export interface GovernorConfig {
  /** Lowest percent the governor may fall to. Configurable down to 1 (the "…to 1" of the range). */
  minPercent: number;
  /** Percent shed per demote (fast). */
  demoteStep: number;
  /** Percent regained per promote (slow) — must be < demoteStep so demotion outpaces promotion. */
  promoteStep: number;
  /** Audio buffer at/below this (ms) is critical → demote now. */
  audioCriticalMs: number;
  /** Audio buffer must exceed this (ms) to be eligible to promote. */
  audioHealthyMs: number;
  /** Local-pipeline latency budget (ms). Approaching it forces a demote. */
  localLatencyBudgetMs: number;
  /** Max tolerated video render-queue age (ms). Approaching it forces a demote. */
  videoQueueAgeMaxMs: number;
  /** Per-frame processing budget (ms). Sustained p95 above it forces a demote. */
  frameProcessingBudgetMs: number;
  /** Fraction of a budget/cap that counts as "approaching" (0–1). */
  approachFraction: number;
  /** Sustained-headroom window (ms) required before a single promotion. */
  promoteStableMs: number;
  /** Minimum time (ms) between successive promotions (anti-oscillation). */
  promoteCooldownMs: number;
  /** Bounded transition-log length. */
  maxTransitions: number;
}

export const DEFAULT_GOVERNOR_CONFIG: GovernorConfig = {
  minPercent: 10, // ~5 fps PAL; configurable lower to honour the full 100→1 range
  demoteStep: 20,
  promoteStep: 10,
  // Tuned to the WebAudio player (AUDIO_LEAD_IN_SECONDS = 80 ms nominal depth).
  audioCriticalMs: 25,
  audioHealthyMs: 90,
  localLatencyBudgetMs: 60,
  videoQueueAgeMaxMs: 100,
  frameProcessingBudgetMs: 18,
  approachFraction: 0.8,
  promoteStableMs: 3000,
  promoteCooldownMs: 2000,
  maxTransitions: 64,
};

export type GovernorTransitionKind = "demote" | "promote" | "user";

export interface GovernorTransition {
  atMs: number;
  kind: GovernorTransitionKind;
  requested: FrameRateMode;
  fromPercent: number;
  toPercent: number;
  reason: string;
}

export interface GovernorState {
  requested: FrameRateMode;
  /** Ceiling (max presentable percent) implied by the requested mode. */
  ceilingPercent: number;
  /** The governor's own target percent (may be below the ceiling; effective clamps it). */
  governorPercent: number;
  /** What the video path must actually present = min(ceiling, governor). */
  effectivePercent: number;
  /** effectivePercent / 100 — the keep-fraction the decimator uses. */
  effectiveFraction: number;
  /** True when the governor pushed the effective rate below the requested maximum (§11.2). */
  overridden: boolean;
  /** Reason for the most recent effective-percent change. */
  reason: string;
  lastTransitionAtMs: number;
}

export class StreamGovernor {
  private readonly config: GovernorConfig;
  private requested: FrameRateMode;
  private ceiling: number;
  private governor = 100;
  private reason = "start";
  private lastTransitionAtMs = 0;
  /** True once the audio buffer has first reached a healthy depth this session (warmup complete). */
  private primed = false;
  /** Wall of continuous-headroom start; null whenever headroom is broken. */
  private headroomSinceMs: number | null = null;
  private lastPromoteAtMs = -Infinity;
  private readonly transitions: GovernorTransition[] = [];

  constructor(requested: FrameRateMode = "auto", config: GovernorConfig = DEFAULT_GOVERNOR_CONFIG) {
    this.config = config;
    this.requested = requested;
    this.ceiling = CEILING_PERCENT[requested];
  }

  /** Change the requested user mode. Records a user transition when the effective rate changes. */
  setRequested(mode: FrameRateMode, nowMs = 0): GovernorState {
    if (mode === this.requested) return this.state;
    const before = this.effective;
    this.requested = mode;
    this.ceiling = CEILING_PERCENT[mode];
    const after = this.effective;
    if (after !== before) {
      this.reason = `mode → ${mode}`;
      this.lastTransitionAtMs = nowMs;
      this.record("user", before, after, nowMs, this.reason);
    }
    return this.state;
  }

  /**
   * Feed a pressure snapshot at `nowMs`. Returns the new state. At most one governor change per
   * call: an immediate demote on any pressure signal, otherwise a single promotion once headroom
   * has held for `promoteStableMs` and the promote cooldown has elapsed.
   */
  update(signals: GovernorSignals, nowMs: number): GovernorState {
    const before = this.effective;
    const audioActive = signals.audioActive !== false;
    // Latch "primed" the first time active audio reaches a healthy depth — before that the buffer is
    // filling (or absent), so its low value is warmup, not starvation, and must not drive a demote.
    if (audioActive && signals.audioBufferMs >= this.config.audioHealthyMs) this.primed = true;
    const audioReady = audioActive && this.primed;

    const demoteReason = this.pressureReason(signals, audioReady);
    if (demoteReason) {
      this.headroomSinceMs = null; // any pressure breaks the headroom streak
      // Demote from the *effective* level (min with the ceiling) so a low manual cap still responds
      // on the first tick instead of burning demotes above the cap.
      const base = Math.min(this.governor, this.ceiling);
      const next = Math.max(this.config.minPercent, base - this.config.demoteStep);
      if (next !== this.governor) {
        this.governor = next;
        this.commit("demote", before, nowMs, demoteReason);
      }
      return this.state;
    }

    // No pressure this tick. Track a continuous-headroom streak, and only promote when it is both
    // long enough AND the cooldown since the last promotion has elapsed (anti-oscillation). When
    // audio is ready its buffer must be healthy; when it isn't (video-only / priming) the audio
    // buffer is not a gate, so a latency/queue demote can still recover.
    const audioHealthy =
      !audioReady || (signals.audioBufferMs >= this.config.audioHealthyMs && signals.audioUnderruns === 0);
    if (!audioHealthy) {
      this.headroomSinceMs = null;
      return this.state;
    }
    if (this.headroomSinceMs === null) this.headroomSinceMs = nowMs;

    const stableFor = nowMs - this.headroomSinceMs;
    const sinceLastPromote = nowMs - this.lastPromoteAtMs;
    // Promote only while the effective rate can still grow (governor below the ceiling), capped at
    // the ceiling — promoting above it would only delay a future demote and show no visible change.
    if (
      this.governor < this.ceiling &&
      stableFor >= this.config.promoteStableMs &&
      sinceLastPromote >= this.config.promoteCooldownMs
    ) {
      this.governor = Math.min(this.ceiling, this.governor + this.config.promoteStep);
      this.lastPromoteAtMs = nowMs;
      this.headroomSinceMs = nowMs; // require a fresh window before the next single step
      this.commit("promote", before, nowMs, `headroom ${Math.round(stableFor)}ms`);
    }
    return this.state;
  }

  /**
   * The first pressure signal that warrants an immediate demote, or null if none. Audio signals
   * apply only when audio is ready (active + primed); the video signals (latency, queue age, frame
   * processing) always apply.
   */
  private pressureReason(s: GovernorSignals, audioReady: boolean): string | null {
    if (audioReady && s.audioUnderruns > 0) return `audio underrun ×${s.audioUnderruns}`;
    if (audioReady && s.audioBufferMs <= this.config.audioCriticalMs)
      return `audio buffer ${Math.round(s.audioBufferMs)}ms`;
    const approach = this.config.approachFraction;
    if (s.localLatencyP99Ms !== undefined && s.localLatencyP99Ms >= this.config.localLatencyBudgetMs * approach)
      return `latency ${Math.round(s.localLatencyP99Ms)}ms`;
    if (s.videoQueueAgeMs !== undefined && s.videoQueueAgeMs >= this.config.videoQueueAgeMaxMs * approach)
      return `queue age ${Math.round(s.videoQueueAgeMs)}ms`;
    if (s.frameProcessingP95Ms !== undefined && s.frameProcessingP95Ms >= this.config.frameProcessingBudgetMs)
      return `frame proc ${Math.round(s.frameProcessingP95Ms)}ms`;
    return null;
  }

  private commit(kind: GovernorTransitionKind, beforeEffective: number, nowMs: number, reason: string): void {
    const after = this.effective;
    this.reason = reason;
    this.lastTransitionAtMs = nowMs;
    this.record(kind, beforeEffective, after, nowMs, reason);
  }

  private record(
    kind: GovernorTransitionKind,
    fromPercent: number,
    toPercent: number,
    atMs: number,
    reason: string,
  ): void {
    this.transitions.push({ atMs, kind, requested: this.requested, fromPercent, toPercent, reason });
    while (this.transitions.length > this.config.maxTransitions) this.transitions.shift();
  }

  private get effective(): number {
    return Math.min(this.ceiling, this.governor);
  }

  get state(): GovernorState {
    const effective = this.effective;
    return {
      requested: this.requested,
      ceilingPercent: this.ceiling,
      governorPercent: this.governor,
      effectivePercent: effective,
      effectiveFraction: effective / 100,
      overridden: effective < this.ceiling,
      reason: this.reason,
      lastTransitionAtMs: this.lastTransitionAtMs,
    };
  }

  getTransitions(): readonly GovernorTransition[] {
    return this.transitions;
  }

  reset(): void {
    this.governor = 100;
    this.reason = "start";
    this.lastTransitionAtMs = 0;
    this.primed = false;
    this.headroomSinceMs = null;
    this.lastPromoteAtMs = -Infinity;
    this.transitions.length = 0;
  }
}
