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
 * The governor decides, from live pipeline pressure, how many source video frames to actually
 * present — expressed as a **frame divisor**: present every Nth source frame (1 = every frame,
 * 2 = half, 4 = quarter). Deterministic cadence division (not fps interpolation) so a PAL source
 * yields exactly 50 / 25 / 12.5 fps and an NTSC source its own rate / 2 / 4.
 *
 * User "Video frame rate" mode sets a *maximum* rate = a *minimum* divisor (the ceiling):
 *   auto → 1 (try full)   100% → 1   50% → 2   25% → 4
 * A manual mode is a requested MAXIMUM, not permission to lose audio or grow latency (§11.2): the
 * governor may push the effective divisor ABOVE the ceiling (fewer frames) to protect audio /
 * bounded latency, then recover. So `effectiveDivisor = max(ceilingDivisor, governorDivisor)`.
 *
 * Design rules the tests pin (§11.4–§11.5):
 *   - Audio is never decimated here; this only gates VIDEO presentation.
 *   - Demote FAST: a single tick with an underrun / near-dry audio buffer / latency near budget /
 *     queue age near its cap steps the governor one level worse immediately.
 *   - Promote SLOW: only after sustained headroom for `promoteStableMs`, one level at a time, with
 *     a `promoteCooldownMs` between promotions — this is the explicit anti-oscillation guard.
 *   - Every transition records requested vs effective, the reason, and the time (§11.2, §12.1).
 *
 * Pure and deterministic: no timers, no I/O. The clock is passed to {@link update}; callers feed a
 * {@link GovernorSignals} snapshot on a low-rate tick (the telemetry cadence, ~4 Hz).
 */

export type FrameRateMode = "auto" | "100" | "50" | "25";

/** Present every Nth source frame. Discrete by design (deterministic cadence division). */
export type FrameDivisor = 1 | 2 | 4;

const DIVISORS: readonly FrameDivisor[] = [1, 2, 4] as const;

/** The minimum divisor (rate ceiling) each user mode allows. */
const CEILING_FOR_MODE: Record<FrameRateMode, FrameDivisor> = { auto: 1, "100": 1, "50": 2, "25": 4 };

export interface GovernorSignals {
  /**
   * WebAudio player buffer depth ahead of the audio output clock (ms). The primary headroom
   * signal: as this trends toward 0 the audio is about to run dry. See {@link AudioMirrorPlayer}.
   */
  audioBufferMs: number;
  /** Player underruns observed since the previous tick (audio output ran dry between chunks). */
  audioUnderruns: number;
  /** Estimated local-pipeline latency p99 (ms) this tick, if known (video render residence based). */
  localLatencyP99Ms?: number;
  /** Max video render-queue residence age (ms) observed this tick, if known. */
  videoQueueAgeMs?: number;
  /** Rolling frame-processing time p95 (ms), if known — sustained deadline misses force a demote. */
  frameProcessingP95Ms?: number;
}

export interface GovernorConfig {
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
  fromDivisor: FrameDivisor;
  toDivisor: FrameDivisor;
  reason: string;
}

export interface GovernorState {
  requested: FrameRateMode;
  /** Divisor implied by the requested mode (the rate ceiling / lower bound on the divisor). */
  ceilingDivisor: FrameDivisor;
  /** The governor's own pressure level (may be below the ceiling; effective clamps it up). */
  governorDivisor: FrameDivisor;
  /** What the video path must actually use = max(ceiling, governor). */
  effectiveDivisor: FrameDivisor;
  /** True when the governor pushed the effective rate below the requested maximum (§11.2). */
  overridden: boolean;
  /** Reason for the most recent effective-divisor change. */
  reason: string;
  lastTransitionAtMs: number;
}

const worse = (d: FrameDivisor): FrameDivisor => DIVISORS[Math.min(DIVISORS.length - 1, DIVISORS.indexOf(d) + 1)];
const better = (d: FrameDivisor): FrameDivisor => DIVISORS[Math.max(0, DIVISORS.indexOf(d) - 1)];

export class StreamGovernor {
  private readonly config: GovernorConfig;
  private requested: FrameRateMode;
  private ceiling: FrameDivisor;
  private governor: FrameDivisor = 1;
  private reason = "start";
  private lastTransitionAtMs = 0;
  /** Wall of continuous-headroom start; null whenever headroom is broken. */
  private headroomSinceMs: number | null = null;
  private lastPromoteAtMs = -Infinity;
  private readonly transitions: GovernorTransition[] = [];

  constructor(requested: FrameRateMode = "auto", config: GovernorConfig = DEFAULT_GOVERNOR_CONFIG) {
    this.config = config;
    this.requested = requested;
    this.ceiling = CEILING_FOR_MODE[requested];
  }

  /** Change the requested user mode. Records a user transition when the effective rate changes. */
  setRequested(mode: FrameRateMode, nowMs = 0): GovernorState {
    if (mode === this.requested) return this.state;
    const before = this.effective;
    this.requested = mode;
    this.ceiling = CEILING_FOR_MODE[mode];
    const after = this.effective;
    if (after !== before) {
      this.reason = `mode → ${mode}`;
      this.lastTransitionAtMs = nowMs;
      this.record("user", before, after, nowMs, this.reason);
    }
    return this.state;
  }

  /**
   * Feed a pressure snapshot at `nowMs`. Returns the new state. At most one governor level change
   * per call: an immediate demote on any pressure signal, otherwise a single promotion once
   * headroom has held for `promoteStableMs` and the promote cooldown has elapsed.
   */
  update(signals: GovernorSignals, nowMs: number): GovernorState {
    const before = this.effective;
    const demoteReason = this.pressureReason(signals);

    if (demoteReason) {
      this.headroomSinceMs = null; // any pressure breaks the headroom streak
      if (this.governor !== worse(this.governor)) {
        const from = this.governor;
        this.governor = worse(this.governor);
        this.commit("demote", before, from, nowMs, demoteReason);
      }
      return this.state;
    }

    // No pressure this tick. Track a continuous-headroom streak, and only promote when it is both
    // long enough AND the cooldown since the last promotion has elapsed (anti-oscillation).
    const healthy = signals.audioBufferMs >= this.config.audioHealthyMs && signals.audioUnderruns === 0;
    if (!healthy) {
      this.headroomSinceMs = null;
      return this.state;
    }
    if (this.headroomSinceMs === null) this.headroomSinceMs = nowMs;

    const stableFor = nowMs - this.headroomSinceMs;
    const sinceLastPromote = nowMs - this.lastPromoteAtMs;
    if (
      this.governor !== 1 &&
      stableFor >= this.config.promoteStableMs &&
      sinceLastPromote >= this.config.promoteCooldownMs
    ) {
      const from = this.governor;
      this.governor = better(this.governor);
      this.lastPromoteAtMs = nowMs;
      this.headroomSinceMs = nowMs; // require a fresh window before the next single step
      this.commit("promote", before, from, nowMs, `headroom ${Math.round(stableFor)}ms`);
    }
    return this.state;
  }

  /** The first pressure signal that warrants an immediate demote, or null if none. */
  private pressureReason(s: GovernorSignals): string | null {
    if (s.audioUnderruns > 0) return `audio underrun ×${s.audioUnderruns}`;
    if (s.audioBufferMs <= this.config.audioCriticalMs) return `audio buffer ${Math.round(s.audioBufferMs)}ms`;
    const approach = this.config.approachFraction;
    if (s.localLatencyP99Ms !== undefined && s.localLatencyP99Ms >= this.config.localLatencyBudgetMs * approach)
      return `latency ${Math.round(s.localLatencyP99Ms)}ms`;
    if (s.videoQueueAgeMs !== undefined && s.videoQueueAgeMs >= this.config.videoQueueAgeMaxMs * approach)
      return `queue age ${Math.round(s.videoQueueAgeMs)}ms`;
    if (s.frameProcessingP95Ms !== undefined && s.frameProcessingP95Ms >= this.config.frameProcessingBudgetMs)
      return `frame proc ${Math.round(s.frameProcessingP95Ms)}ms`;
    return null;
  }

  private commit(
    kind: GovernorTransitionKind,
    beforeEffective: FrameDivisor,
    fromGovernor: FrameDivisor,
    nowMs: number,
    reason: string,
  ): void {
    const after = this.effective;
    this.reason = reason;
    this.lastTransitionAtMs = nowMs;
    // Record against the governor level change so a manual ceiling that masks it is still auditable.
    this.record(kind, beforeEffective, after, nowMs, reason);
    void fromGovernor;
  }

  private record(
    kind: GovernorTransitionKind,
    fromDivisor: FrameDivisor,
    toDivisor: FrameDivisor,
    atMs: number,
    reason: string,
  ): void {
    this.transitions.push({ atMs, kind, requested: this.requested, fromDivisor, toDivisor, reason });
    while (this.transitions.length > this.config.maxTransitions) this.transitions.shift();
  }

  private get effective(): FrameDivisor {
    return Math.max(this.ceiling, this.governor) as FrameDivisor;
  }

  get state(): GovernorState {
    return {
      requested: this.requested,
      ceilingDivisor: this.ceiling,
      governorDivisor: this.governor,
      effectiveDivisor: this.effective,
      overridden: this.effective > this.ceiling,
      reason: this.reason,
      lastTransitionAtMs: this.lastTransitionAtMs,
    };
  }

  getTransitions(): readonly GovernorTransition[] {
    return this.transitions;
  }

  reset(): void {
    this.governor = 1;
    this.reason = "start";
    this.lastTransitionAtMs = 0;
    this.headroomSinceMs = null;
    this.lastPromoteAtMs = -Infinity;
    this.transitions.length = 0;
  }
}
