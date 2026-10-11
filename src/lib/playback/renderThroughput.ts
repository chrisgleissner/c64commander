/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * How much of a tune must be buffered before it is allowed to start playing.
 *
 * A tune that starts and then pauses half a second later is worse than a tune that starts a moment
 * late: the first sounds broken, the second sounds like loading. So on-device playback does not begin
 * until enough is buffered that it cannot run dry — but "enough" is not a fixed number, because it
 * depends entirely on how fast this device renders.
 *
 * The renderer produces R seconds of audio per second of wall time. The speaker consumes exactly one.
 * So the renderer gains (R - 1) seconds of headroom per second, and what has to be covered up front is
 * the worst pause the renderer might take — a garbage collection, the UI doing something expensive,
 * the CPU throttling. Dividing a fixed allowance by (R - 1) gives the shape wanted: a device rendering
 * at 5x barely waits, one barely keeping up waits properly, and nothing has to be guessed in advance.
 *
 * Measured rather than assumed, and remembered between runs, because the first tune of a session
 * deserves the same protection as the tenth. A Pixel 4 measures 2.0-2.2x on reSIDfp — worth knowing,
 * because that is far closer to real time than it feels like it should be, and it means the headroom is
 * only about one second gained per second played. At that ratio this asks for roughly 1.2 s up front.
 * The floor exists because the ratio is an average, and averages hide their own worst cases.
 */

import { addLog } from "@/lib/logging";
import type { SidRendererId } from "./sidRenderer/sidRendererAvailability";

const STORAGE_KEY = "c64c.local-sid.render-throughput";

/**
 * Each renderer is measured on its own. libSidplayEZ renders about three times faster than reSIDfp
 * in WASM, and SIDLite faster still, so one shared figure would size the start-up buffer for
 * whichever ran last and let a fast renderer's chunks argue a slow one back into use. reSIDfp keeps
 * the original key, which is what every earlier release measured.
 */
const storageKey = (renderer: SidRendererId): string =>
  renderer === "residfp" ? STORAGE_KEY : `${STORAGE_KEY}.${renderer}`;

/**
 * The renderer the playback engine opened last, which is what a caller without a renderer of its
 * own (the seek-progress estimate, the native sink's prime depth) is asking about.
 */
let active: SidRendererId = "residfp";

export const setActiveRenderThroughputRenderer = (renderer: SidRendererId): void => {
  active = renderer;
};

/**
 * Weight given to each new measurement.
 *
 * Low, so a single slow chunk cannot make the next tune start late, and a device that has genuinely
 * become slower (thermal throttling) is still followed within a few seconds of rendering.
 */
const SMOOTHING = 0.2;

/**
 * Wall-clock stall the buffer is sized to absorb, in seconds.
 *
 * This is the number that says "without a shadow of a doubt". It is not the average hiccup, it is a
 * pause long enough to cover a garbage collection plus the UI doing something expensive at the same
 * moment — both of which were observed on the device.
 */
const STALL_ALLOWANCE_SEC = 1.2;

/** Never start with less than this, however fast the renderer measures. */
const MIN_STARTUP_SEC = 0.6;

/**
 * Never wait longer than this, however slow it measures.
 *
 * A cap rather than an ideal: past a few seconds the wait is its own defect, and a device this slow
 * will not hold up under a deep buffer either. Better to start and let the ring do what it can.
 */
const MAX_STARTUP_SEC = 4;

/** Ratios outside this range are not measurements, they are timing noise. */
const MIN_PLAUSIBLE_RATIO = 0.05;
const MAX_PLAUSIBLE_RATIO = 200;

/**
 * What a device is assumed to manage before it has been measured.
 *
 * Near what a Pixel 4 actually measures rather than optimistically: guessing high means the first tune
 * of a fresh install starts on too little buffer and pauses, which is the exact defect this exists to
 * prevent. Guessing slightly low costs that one tune a fraction of a second and nothing else.
 */
const ASSUMED_RATIO = 2;

interface RendererThroughput {
  cached: number | null;
  /**
   * How many measurements have been folded in this session.
   *
   * Kept because {@link accurateEngineViable} may only demote the renderer on evidence, and one
   * chunk is not evidence. See {@link MIN_SAMPLES_TO_DEMOTE}.
   */
  samples: number;
  /**
   * Whether `cached` came from a measurement rather than from {@link ASSUMED_RATIO}.
   *
   * `renderRatio()` deliberately never returns null — the startup buffer has to be sized before
   * anything has been measured, and the assumption is the right answer there. But a figure shown to
   * the listener is different: "about 4 s" derived from a guess is a number the app has no business
   * stating, so the only consumer that needs evidence asks for it through {@link measuredRenderRatio}.
   */
  measured: boolean;
  demoted: boolean;
}

const state = new Map<SidRendererId, RendererThroughput>();

const throughputOf = (renderer: SidRendererId): RendererThroughput => {
  let entry = state.get(renderer);
  if (!entry) {
    entry = { cached: null, samples: 0, measured: false, demoted: false };
    state.set(renderer, entry);
  }
  return entry;
};

const readStored = (renderer: SidRendererId): number | null => {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(renderer));
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= MIN_PLAUSIBLE_RATIO && value <= MAX_PLAUSIBLE_RATIO ? value : null;
  } catch (error) {
    // No storage, or storage that refuses to be read: fall back to the assumption rather than fail.
    addLog("debug", "Could not read stored render throughput", {
      error: (error as Error)?.message ?? String(error),
    });
    return null;
  }
};

/** Seconds of audio this device renders per second of wall time, as measured so far. */
export const renderRatio = (renderer: SidRendererId = active): number => {
  const entry = throughputOf(renderer);
  if (entry.cached === null) {
    const stored = readStored(renderer);
    // A remembered ratio is still a measurement — it was measured in an earlier session — so it
    // counts as evidence. The assumption does not. It also counts as ALREADY past the demotion
    // threshold: it is the settled average of an earlier session's samples, not a single reading,
    // so a device measured too slow yesterday must not be handed the accurate renderer again today
    // while this session works its way back up to five samples.
    if (stored !== null) {
      entry.measured = true;
      entry.samples = Math.max(entry.samples, MIN_SAMPLES_TO_DEMOTE);
    }
    entry.cached = stored ?? ASSUMED_RATIO;
  }
  return entry.cached;
};

/**
 * The same ratio, but only once there is evidence for it; null before that.
 *
 * Used where the figure is shown to the listener rather than used to size a buffer. Callers must
 * drop whatever they derived from it when this turns null again, which it does after a reset.
 */
export const measuredRenderRatio = (renderer: SidRendererId = active): number | null => {
  const ratio = renderRatio(renderer);
  return throughputOf(renderer).measured ? ratio : null;
};

/**
 * Fold in one render measurement.
 *
 * `audioSeconds` is how much audio the chunk contained, `wallMs` how long producing it took. Chunks
 * that report no time are ignored rather than treated as infinitely fast — those come from the
 * pre-render cache, which is a buffer read and says nothing about the renderer.
 */
export const recordRenderMeasurement = (
  audioSeconds: number,
  wallMs: number,
  renderer: SidRendererId = active,
): void => {
  if (audioSeconds <= 0 || wallMs <= 0) return;
  const ratio = audioSeconds / (wallMs / 1000);
  if (ratio < MIN_PLAUSIBLE_RATIO || ratio > MAX_PLAUSIBLE_RATIO) return;
  const entry = throughputOf(renderer);
  const next = entry.cached === null ? ratio : entry.cached * (1 - SMOOTHING) + ratio * SMOOTHING;
  entry.cached = next;
  entry.samples += 1;
  entry.measured = true;
  try {
    globalThis.localStorage?.setItem(storageKey(renderer), String(next));
  } catch (error) {
    // A device that cannot persist this still benefits within the session.
    addLog("debug", "Could not persist render throughput", { error: (error as Error)?.message ?? String(error) });
  }
};

/**
 * Seconds of audio to have in hand before playback starts.
 *
 * Derived from the measured ratio, so it tightens as the device proves itself and loosens when it
 * struggles. Never a fixed delay.
 */
export const startupBufferSeconds = (renderer: SidRendererId = active): number => {
  const ratio = renderRatio(renderer);
  // A renderer at or below real time can never build headroom, so it gets the cap: the buffer is all
  // the protection available to it.
  const headroomPerSecond = ratio - 1;
  if (headroomPerSecond <= 0) return MAX_STARTUP_SEC;
  return Math.min(MAX_STARTUP_SEC, Math.max(MIN_STARTUP_SEC, STALL_ALLOWANCE_SEC / headroomPerSecond));
};

/** The same figure in milliseconds, which is what the native track's prime depth is set from. */
export const startupBufferMs = (renderer: SidRendererId = active): number =>
  Math.round(startupBufferSeconds(renderer) * 1000);

/**
 * Ratio below which reSIDfp is not viable on this device.
 *
 * At or under real time the renderer can never get ahead, so no buffer saves it: the tune will run dry
 * eventually, whatever the head start. A little above 1 rather than exactly 1, because a device sitting
 * on the line has no margin for the CPU being needed elsewhere.
 */
const VIABLE_RATIO = 1.15;

/**
 * Measurements needed before the ratio is allowed to demote the renderer.
 *
 * The smoothing is 0.2, so the first sample carries the whole estimate and the second still carries
 * a fifth of it. A launch, a screen rotation or a config read landing on the same thread as one
 * chunk is enough to put a single ratio under {@link VIABLE_RATIO} — and demotion is audible, so
 * paying for it with one chunk's evidence is the wrong trade. Five samples is about two and a half
 * seconds of rendering on a device that is keeping up, which is long enough for a transient to have
 * been averaged away and short enough that a device which genuinely cannot manage is caught inside
 * the first tune.
 *
 * A ratio restored from storage counts as fully evidenced: it is the settled result of an earlier
 * session's samples, not a single reading.
 */
const MIN_SAMPLES_TO_DEMOTE = 5;

/**
 * Whether the accurate emulation can keep up here.
 *
 * SIDLite is the cheaper renderer, and materially so. It does not sound the same — see
 * `local-sid-engine-residfp-and-roms` — so it is a fallback rather than a choice, taken only when the
 * accurate one has been measured failing to keep pace. Sounding slightly different beats pausing.
 *
 * Requires several measurements first: one slow chunk during a launch or a screen rotation is not
 * evidence that a device cannot manage. Before that threshold the accurate renderer is kept, which
 * is the same answer an unmeasured device already got.
 */
export const accurateEngineViable = (renderer: SidRendererId = "residfp"): boolean => {
  // Sticky for the session: once demoted, the renderer is no longer used, so nothing would ever
  // measure it again — and bringing it back on the next tune would stall and fall back again.
  const entry = throughputOf(renderer);
  if (!entry.demoted) entry.demoted = renderRatio(renderer) < VIABLE_RATIO && entry.samples >= MIN_SAMPLES_TO_DEMOTE;
  return !entry.demoted;
};

/** Test seam: forget what has been learned. */
export const __resetRenderThroughput = (): void => {
  state.clear();
  active = "residfp";
  try {
    for (const renderer of ["residfp", "sidlite", "sidplayez"] as const) {
      globalThis.localStorage?.removeItem(storageKey(renderer));
    }
  } catch (error) {
    // Nothing stored, nothing to forget.
    addLog("debug", "Could not clear stored render throughput", {
      error: (error as Error)?.message ?? String(error),
    });
  }
};
