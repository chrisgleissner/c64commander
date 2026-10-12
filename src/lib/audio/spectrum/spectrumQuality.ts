/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { DisplayProfile } from "@/lib/displayProfiles";

export interface SpectrumTier {
  index: 0 | 1 | 2 | 3;
  /** Frames drawn per second. */
  drawFps: number;
  /** Analysis frames requested per second. */
  dataHz: number;
  bars: 48 | 24 | 12;
  glow: boolean;
  /** False draws each bar in flat colour steps instead of a gradient. */
  gradient: boolean;
}

export const SPECTRUM_TIERS: readonly SpectrumTier[] = [
  { index: 0, drawFps: 60, dataHz: 30, bars: 48, glow: true, gradient: true },
  { index: 1, drawFps: 30, dataHz: 20, bars: 48, glow: false, gradient: true },
  { index: 2, drawFps: 20, dataHz: 15, bars: 24, glow: false, gradient: true },
  { index: 3, drawFps: 12, dataHz: 10, bars: 12, glow: false, gradient: false },
];

export const LOWEST_SPECTRUM_TIER = SPECTRUM_TIERS.length - 1;

/** How long frames must keep missing their budget before the picture is simplified. */
export const SPECTRUM_DEMOTE_AFTER_MS = 1000;
/** The shortest time between two promotions; it doubles after each promotion that had to be undone. */
export const SPECTRUM_PROMOTE_EVERY_MS = 8000;
export const SPECTRUM_PROMOTE_BACKOFF_LIMIT_MS = 64000;

/** Share of the frame interval the draw itself may use before the frame counts as over budget. */
const COST_BUDGET_SHARE = 0.6;
/** A frame this much later than its slot counts as over budget even when the draw was cheap. */
const LATE_FRAME_RATIO = 1.6;
/** Promotion needs the draw to use no more than this share of the interval it would shrink to. */
const PROMOTE_HEADROOM_SHARE = 0.3;

export interface SpectrumDeviceSignals {
  profile: DisplayProfile | string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

/** Tier 1 on the smallest screen and on devices that report few cores or little memory, otherwise tier 0. */
export const initialSpectrumTier = (signals: SpectrumDeviceSignals): SpectrumTier => {
  const fewCores = signals.hardwareConcurrency !== undefined && signals.hardwareConcurrency <= 4;
  const littleMemory = signals.deviceMemory !== undefined && signals.deviceMemory <= 2;
  return SPECTRUM_TIERS[signals.profile === "compact" || fewCores || littleMemory ? 1 : 0];
};

export interface SpectrumFrameSample {
  /** Timestamp of the frame, in milliseconds. */
  nowMs: number;
  /** How long drawing the frame took. */
  costMs: number;
  /** Time since the previous frame was drawn. */
  intervalMs: number;
}

export interface SpectrumTierController {
  readonly tier: SpectrumTier;
  /** Feeds one drawn frame. Returns the new tier when it changed, otherwise null. */
  report(sample: SpectrumFrameSample): SpectrumTier | null;
  /** Forget what was measured, for example after the card was hidden for a while. */
  restart(nowMs: number): void;
}

const isOverBudget = (tier: SpectrumTier, sample: SpectrumFrameSample) => {
  const slotMs = 1000 / tier.drawFps;
  return sample.costMs > slotMs * COST_BUDGET_SHARE || sample.intervalMs > slotMs * LATE_FRAME_RATIO;
};

/**
 * Chooses how much work the spectrum does from what its frames actually cost.
 *
 * It starts at `start` and never rises above it, so a screen that was judged too small for the best
 * picture is not promoted into it by a quiet moment. A tier is dropped when at least half of the
 * frames in a one-second window were over budget. A tier is regained only after the minimum time
 * since the last change, and only while drawing used little of the faster tier's frame interval.
 */
export const createSpectrumTierController = (start: SpectrumTier, startMs = 0): SpectrumTierController => {
  let current = start;
  let windowStartMs = startMs;
  let windowFrames = 0;
  let windowOver = 0;
  let windowCostMs = 0;
  let lastChangeMs = startMs;
  let lastWasPromotion = false;
  let promoteEveryMs = SPECTRUM_PROMOTE_EVERY_MS;

  const resetWindow = (nowMs: number) => {
    windowStartMs = nowMs;
    windowFrames = 0;
    windowOver = 0;
    windowCostMs = 0;
  };

  const change = (next: SpectrumTier, nowMs: number, promotion: boolean) => {
    current = next;
    lastChangeMs = nowMs;
    lastWasPromotion = promotion;
    resetWindow(nowMs);
    return next;
  };

  return {
    get tier() {
      return current;
    },
    restart(nowMs) {
      resetWindow(nowMs);
      lastChangeMs = nowMs;
    },
    report(sample) {
      windowFrames += 1;
      windowCostMs += sample.costMs;
      if (isOverBudget(current, sample)) windowOver += 1;
      if (sample.nowMs - windowStartMs < SPECTRUM_DEMOTE_AFTER_MS) return null;

      const overShare = windowOver / windowFrames;
      const meanCostMs = windowCostMs / windowFrames;
      const heavy = overShare >= 0.5;
      const windowEndedMs = sample.nowMs;
      resetWindow(windowEndedMs);

      if (heavy && current.index < LOWEST_SPECTRUM_TIER) {
        if (lastWasPromotion) {
          promoteEveryMs = Math.min(promoteEveryMs * 2, SPECTRUM_PROMOTE_BACKOFF_LIMIT_MS);
        }
        return change(SPECTRUM_TIERS[current.index + 1], windowEndedMs, false);
      }
      if (heavy || current.index <= start.index || overShare > 0) return null;
      const faster = SPECTRUM_TIERS[current.index - 1];
      const fasterSlotMs = 1000 / faster.drawFps;
      if (windowEndedMs - lastChangeMs < promoteEveryMs) return null;
      if (meanCostMs > fasterSlotMs * PROMOTE_HEADROOM_SHARE) return null;
      return change(faster, windowEndedMs, true);
    },
  };
};
