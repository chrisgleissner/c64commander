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

const STORAGE_KEY = "c64c.local-sid.render-throughput";

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

let cached: number | null = null;

const readStored = (): number | null => {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
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
export const renderRatio = (): number => {
  cached ??= readStored() ?? ASSUMED_RATIO;
  return cached;
};

/**
 * Fold in one render measurement.
 *
 * `audioSeconds` is how much audio the chunk contained, `wallMs` how long producing it took. Chunks
 * that report no time are ignored rather than treated as infinitely fast — those come from the
 * pre-render cache, which is a buffer read and says nothing about the renderer.
 */
export const recordRenderMeasurement = (audioSeconds: number, wallMs: number): void => {
  if (audioSeconds <= 0 || wallMs <= 0) return;
  const ratio = audioSeconds / (wallMs / 1000);
  if (ratio < MIN_PLAUSIBLE_RATIO || ratio > MAX_PLAUSIBLE_RATIO) return;
  const next = cached === null ? ratio : cached * (1 - SMOOTHING) + ratio * SMOOTHING;
  cached = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(next));
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
export const startupBufferSeconds = (): number => {
  const ratio = renderRatio();
  // A renderer at or below real time can never build headroom, so it gets the cap: the buffer is all
  // the protection available to it.
  const headroomPerSecond = ratio - 1;
  if (headroomPerSecond <= 0) return MAX_STARTUP_SEC;
  return Math.min(MAX_STARTUP_SEC, Math.max(MIN_STARTUP_SEC, STALL_ALLOWANCE_SEC / headroomPerSecond));
};

/** The same figure in milliseconds, which is what the native track's prime depth is set from. */
export const startupBufferMs = (): number => Math.round(startupBufferSeconds() * 1000);

/**
 * Ratio below which reSIDfp is not viable on this device.
 *
 * At or under real time the renderer can never get ahead, so no buffer saves it: the tune will run dry
 * eventually, whatever the head start. A little above 1 rather than exactly 1, because a device sitting
 * on the line has no margin for the CPU being needed elsewhere.
 */
const VIABLE_RATIO = 1.15;

/**
 * Whether the accurate emulation can keep up here.
 *
 * SIDLite is the cheaper renderer, and materially so. It does not sound the same — see
 * `local-sid-engine-residfp-and-roms` — so it is a fallback rather than a choice, taken only when the
 * accurate one has been measured failing to keep pace. Sounding slightly different beats pausing.
 *
 * Deliberately requires several measurements first: one slow chunk during a launch or a screen rotation
 * is not evidence that a device cannot manage.
 */
export const accurateEngineViable = (): boolean => cached === null || cached >= VIABLE_RATIO;

/** Test seam: forget what has been learned. */
export const __resetRenderThroughput = (): void => {
  cached = null;
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch (error) {
    // Nothing stored, nothing to forget.
    addLog("debug", "Could not clear stored render throughput", {
      error: (error as Error)?.message ?? String(error),
    });
  }
};
