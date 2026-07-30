/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * What to say while a seek waits for the renderer to reach it.
 *
 * libsidplayfp cannot rewind, so a position that is not rendered yet has to be rendered up to. That
 * wait is measured in seconds, sometimes tens of them, and the whole of this file exists because a
 * wait the listener cannot see reads as a broken control. The rules it follows:
 *
 * - Progress comes from the RENDERER, never from the playhead. The playhead is frozen during the
 *   wait, so deriving progress from it would show a bar that never moves; worse, when the fallback
 *   is not taken and playback continues, it would show a bar racing towards a target it is not
 *   approaching. The only thing genuinely advancing towards the target is the render head, so the
 *   denominator is the span that still had to be rendered when the target was accepted.
 * - The estimate is a real estimate or it is absent. The device's measured render rate is the only
 *   thing that can produce one, and before that has been measured — a fresh install, a reset — the
 *   status degrades to a percentage rather than inventing a duration.
 * - Whole seconds. A figure that changes ten times a second is noise, and "about 4.37 s" claims a
 *   precision that a smoothed rate over a background thread does not have.
 */

import { measuredRenderRatio } from "@/lib/playback/renderThroughput";

/**
 * A seek held while the renderer works towards it, as the engine holds it.
 *
 * Every field is independent state rather than something derived from a single slider position:
 * what is heard, what is rendered, what was asked for, and the two identities that let a completion
 * arriving later be matched to the request that is still outstanding.
 */
export type PendingSeekState = {
  /** The position the listener asked for, in seconds. */
  targetSeconds: number;
  /** How far the tune was rendered when this target was accepted; the denominator of progress. */
  renderedAtRequestSeconds: number;
  /** The last position genuinely heard before the wait began; the elapsed clock freezes here. */
  audibleAtRequestSeconds: number;
  /** Monotonic per seek, so a completion for a superseded target can be rejected. */
  generation: number;
  /** Identity of the track instance, so a completion from a previous tune can be rejected. */
  trackInstanceId: number;
};

/** Below this many seconds remaining, a number is less useful than "nearly there". */
export const ALMOST_READY_SECONDS = 1;

/**
 * How often the polite live region may speak.
 *
 * The status itself refreshes twice a second. A screen reader given that would talk over itself
 * continuously and drown the rest of the page, so announcements are spaced far enough apart to be
 * read out in full.
 */
export const PENDING_ANNOUNCEMENT_INTERVAL_MS = 3000;

/** m:ss, local to this module so nothing under `lib/` has to reach up into a page. */
const formatClock = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
};

/**
 * How much of the work this seek asked for has been done, 0..1.
 *
 * Starts near zero because the denominator is fixed at the moment the target is accepted, reaches
 * one when the render head passes the target, and never moves backwards for an unchanged target
 * because the render head only grows. A target that was already covered is complete by definition.
 */
export const pendingSeekProgress = (state: PendingSeekState, renderedSeconds: number): number => {
  const span = state.targetSeconds - state.renderedAtRequestSeconds;
  if (!(span > 0)) return 1;
  const done = renderedSeconds - state.renderedAtRequestSeconds;
  return Math.min(1, Math.max(0, done / span));
};

/**
 * Wall seconds until the render head reaches the target, or null when there is no evidence for one.
 *
 * `ratio` is seconds of audio rendered per second of wall time. Null in, null out — see
 * {@link measuredRenderRatio}: an estimate derived from an assumption is a number the app has no
 * business stating.
 */
export const pendingSeekEtaSeconds = (
  state: PendingSeekState,
  renderedSeconds: number,
  ratio: number | null,
): number | null => {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return null;
  const remaining = state.targetSeconds - renderedSeconds;
  if (!Number.isFinite(remaining)) return null;
  return Math.max(0, remaining) / ratio;
};

/** Everything the progress bar and the screen reader need while a seek is pending. */
export type PendingSeekPresentation = {
  /** The requested position, as a percentage of the tune. */
  targetPercent: number;
  /** Where the render head stood when the target was accepted, as a percentage of the tune. */
  startedAtPercent: number;
  /** Where the render head stands now, as a percentage of the tune. */
  renderedPercent: number;
  /** The position the elapsed clock is frozen at, in milliseconds. */
  audibleMs: number;
  /** Preparation progress, 0..1. */
  progress: number;
  /** The same figure rounded for display, 0..100. */
  progressPercent: number;
  /** Whole seconds remaining, or null when the render rate has not been measured yet. */
  etaSeconds: number | null;
  /** True once the wait is short enough that a countdown is less useful than "nearly there". */
  almostReady: boolean;
  /** m:ss of the requested position, for the marker's own label. */
  targetLabel: string;
  /** The inline status under the bar. */
  statusText: string;
  /** The sentence a screen reader is given. */
  liveText: string;
};

export type PendingSeekPresentationInput = {
  state: PendingSeekState;
  /** How far the tune is rendered now, in seconds. */
  renderedSeconds: number;
  /** The tune's length in milliseconds; percentages are undefined without it. */
  durationMs: number;
  /** Injected in tests; production reads the one smoothed estimator. */
  ratio?: number | null;
};

/**
 * Turn the pending-seek state into everything shown about it.
 *
 * Returns null when the tune has no usable length, because every position here is expressed as a
 * percentage of it and a bar with no scale can only mislead.
 */
export const describePendingSeek = (input: PendingSeekPresentationInput): PendingSeekPresentation | null => {
  const { state, renderedSeconds, durationMs } = input;
  if (!(durationMs > 0)) return null;
  const ratio = input.ratio === undefined ? measuredRenderRatio() : input.ratio;
  const percentOf = (seconds: number) => Math.min(100, Math.max(0, (seconds * 1000 * 100) / durationMs));

  const progress = pendingSeekProgress(state, renderedSeconds);
  const progressPercent = Math.round(progress * 100);
  const eta = pendingSeekEtaSeconds(state, renderedSeconds, ratio);
  const almostReady = eta !== null && eta < ALMOST_READY_SECONDS;
  const etaSeconds = eta === null ? null : Math.round(eta);
  const targetLabel = formatClock(state.targetSeconds);

  const statusText = almostReady
    ? `Almost ready to continue at ${targetLabel}`
    : etaSeconds === null
      ? `Preparing audio for ${targetLabel} · ${progressPercent}%`
      : `Preparing audio for ${targetLabel} · ${progressPercent}% · about ${etaSeconds} s`;

  const targetWholeSeconds = Math.round(state.targetSeconds);
  const liveBase = `Rendering audio for position ${targetWholeSeconds} seconds. ${progressPercent} percent ready.`;
  const liveText = almostReady
    ? `${liveBase} Almost ready.`
    : etaSeconds === null
      ? liveBase
      : `${liveBase} About ${etaSeconds} ${etaSeconds === 1 ? "second" : "seconds"} remaining.`;

  return {
    targetPercent: percentOf(state.targetSeconds),
    startedAtPercent: percentOf(state.renderedAtRequestSeconds),
    renderedPercent: percentOf(renderedSeconds),
    audibleMs: Math.max(0, state.audibleAtRequestSeconds * 1000),
    progress,
    progressPercent,
    etaSeconds,
    almostReady,
    targetLabel,
    statusText,
    liveText,
  };
};

/** What the live region is currently saying, and when it started saying it. */
export type PoliteAnnouncement = { text: string; atMs: number };

/**
 * Decide what the live region should hold next.
 *
 * Clearing is immediate — a wait that has ended must not keep being announced — but a *changed*
 * message waits out the interval, so a status that refreshes twice a second is read out at a pace
 * a person can follow.
 */
export const nextPoliteAnnouncement = (
  previous: PoliteAnnouncement | null,
  next: string | null,
  nowMs: number,
  intervalMs: number = PENDING_ANNOUNCEMENT_INTERVAL_MS,
): PoliteAnnouncement | null => {
  if (next === null) return null;
  if (previous === null) return { text: next, atMs: nowMs };
  if (previous.text === next) return previous;
  if (nowMs - previous.atMs < intervalMs) return previous;
  return { text: next, atMs: nowMs };
};
