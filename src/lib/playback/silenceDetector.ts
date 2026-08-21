/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Is anything actually reaching the speaker?
 *
 * The rule this exists to keep is "no silent playback unless the listener asked for silence". The
 * app has now had two separate defects where it believed it was playing — clock advancing, frames
 * being written, no error anywhere — while the room stayed quiet. Nothing in the pipeline noticed,
 * because every counter it keeps is about supply and demand rather than about sound.
 *
 * ## Why peak-to-peak, and not RMS or "is any sample non-zero"
 *
 * Both of those give a confident wrong answer on real data. Rendered without the C64 ROMs, the
 * SIDLite engine emits a **constant +157** — every sample identical, not one of them zero. Its RMS
 * is nowhere near zero and a non-zero test passes on every sample. It is a flat line: inaudible.
 *
 * Peak-to-peak over a window is immune to that. A constant is 0 whatever its offset, and any
 * waveform loud enough to hear is far above the floor. It also costs a subtraction and two
 * comparisons per inspected sample, which matters because this runs on every buffer handed to the
 * speaker on a phone.
 *
 * ## Cost, and why every sample is inspected
 *
 * This started out sampling every 64th frame to save work, and a unit test caught the flaw at once:
 * a uniform stride **aliases** with a periodic waveform. A loud tone whose period divides neatly
 * into the stride is sampled at nearly the same phase every time and reads as flat — a detector
 * whose whole job is spotting flatness, reporting a fault on audible music.
 *
 * So it scans the buffer. Two comparisons per Int16 sample with no allocation is around 50
 * microseconds for a half-second stereo chunk at 48 kHz — roughly a hundredth of a percent of one
 * core, and paid once per chunk rather than per frame. Cheap enough not to need the trick that
 * made it wrong.
 */

/**
 * Peak-to-peak below this is treated as silence, in Int16 units.
 *
 * Not zero: a pipeline can carry a hum of a few LSB and still be inaudible, and the flat-line case
 * this exists for sits at exactly 0. 64 of 32,768 is about -54 dBFS, comfortably under anything a
 * listener would call sound and comfortably over dither.
 */
export const SILENCE_PEAK_TO_PEAK = 64;

/** Peak-to-peak of the buffer. 0 for a constant, whatever its offset. */
export const peakToPeak = (pcm: Int16Array): number => {
  if (pcm.length === 0) return 0;
  let min = pcm[0];
  let max = min;
  for (let i = 1; i < pcm.length; i += 1) {
    const v = pcm[i];
    if (v < min) min = v;
    else if (v > max) max = v;
  }
  return max - min;
};

export type SilenceDetectorOptions = {
  /**
   * How long the output may stay flat before it counts as silence.
   *
   * Long enough not to fire on a rest, a gap between tunes or a fade, and short enough that a
   * listener has not yet given up and reached for the phone. Real SID music does go quiet — a
   * two-second pause is musical, twelve seconds is a fault.
   */
  toleranceSeconds?: number;
};

const DEFAULT_TOLERANCE_SECONDS = 12;

/**
 * Tracks how long the audio handed to the speaker has been flat.
 *
 * Fed from wherever PCM is actually written, so it measures what was sent rather than what was
 * intended. It knows nothing about why — that is the caller's business.
 */
export class SilenceDetector {
  private readonly toleranceSeconds: number;
  /** Seconds of consecutively flat audio handed over. */
  private flatSeconds = 0;
  private everAudible = false;

  constructor(options: SilenceDetectorOptions = {}) {
    this.toleranceSeconds = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  }

  /** Record one buffer on its way to the speaker. */
  observe(pcm: Int16Array, seconds: number): void {
    if (seconds <= 0) return;
    if (peakToPeak(pcm) >= SILENCE_PEAK_TO_PEAK) {
      this.flatSeconds = 0;
      this.everAudible = true;
      return;
    }
    this.flatSeconds += seconds;
  }

  /** Start again — a new tune, a resume, or a recovery that has just been attempted. */
  reset(): void {
    this.flatSeconds = 0;
    this.everAudible = false;
  }

  get silentSeconds(): number {
    return this.flatSeconds;
  }

  /** Whether any audible sound has been handed over at all since the last reset. */
  get hasBeenAudible(): boolean {
    return this.everAudible;
  }

  /**
   * Has this gone on long enough to be a fault rather than a quiet passage?
   *
   * A tune that has never made a sound is judged on the same clock as one that has fallen silent:
   * both are the listener not hearing what they asked for.
   */
  get isFaulty(): boolean {
    return this.flatSeconds >= this.toleranceSeconds;
  }
}
