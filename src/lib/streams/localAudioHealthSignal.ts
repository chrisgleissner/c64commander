/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * How the on-device SID engine is coping, published for the Live View governor to read.
 *
 * The governor already sheds video to protect audio — it is the mechanism the whole priority order
 * exists for — but it could only see the MIRROR's audio. A tune rendered here was invisible to it,
 * so Live View kept painting at full rate while the engine, which renders on a worker but is
 * *scheduled* from the main thread, was starved of the CPU it needed to stay ahead.
 *
 * Measured on a Pixel 4 with the timing barcode: local playback alone loses one note in 102; with
 * Live View video also running it loses eleven in forty seconds, most of them a half or a third
 * short. That is what a listener hears as frequent silent gaps, and it gets worse the longer the app
 * has been up and the more it has to do — exactly the conditions that squeeze the main thread.
 *
 * Deliberately a plain module signal, like `inputActivitySignal`: the engine knows its own health and
 * publishes it, the mirror reads it. Neither has to know the other exists.
 */

export interface LocalAudioHealth {
  /** True while a tune is rendering on this device. */
  active: boolean;
  /** Audio queued ahead of the clock, in milliseconds. */
  bufferedMs: number;
  /** Cumulative scheduler underruns — a gap the listener heard. */
  underruns: number;
}

let health: LocalAudioHealth = { active: false, bufferedMs: 0, underruns: 0 };

/** Publish the engine's current health. Cheap; called on the engine's own stats cadence. */
export const reportLocalAudioHealth = (next: LocalAudioHealth): void => {
  health = next;
};

/** Mark on-device playback as stopped, so the governor stops protecting something that is not playing. */
export const clearLocalAudioHealth = (): void => {
  health = { active: false, bufferedMs: 0, underruns: 0 };
};

/** The latest published health. */
export const readLocalAudioHealth = (): LocalAudioHealth => health;

/** Test seam. */
export const __resetLocalAudioHealth = (): void => {
  health = { active: false, bufferedMs: 0, underruns: 0 };
};
