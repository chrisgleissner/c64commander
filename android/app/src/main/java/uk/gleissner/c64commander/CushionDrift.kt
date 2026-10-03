/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

/** How hard [AudioPipeline]'s converter may push the playback rate to hold its cushion. Pure. */
internal object CushionDrift {
  /**
   * How far the resampling ratio may be pushed from nominal to hold the cushion.
   *
   * 0.1% is under two cents, below audibility on a sustained tone, and three times the 0.035% clock
   * difference it absorbs. Ten times this put a steady 1000 Hz at an audible 997.75 Hz.
   */
  const val MAX_DRIFT = 0.001

  /** The rate the depth a stream started with drains at: about 3.5 cents, 45 ms in about 22 s. */
  const val STARTUP_DRAIN_DRIFT = 0.002

  /** The wider authority for a cushion below its floor or a burst far above target. */
  const val REBUILD_DRIFT = 0.005

  /**
   * How far the cushion may sit from target before the rate is touched at all. Without a deadband
   * the loop corrects permanently, so the correction stops being a correction and becomes a detune.
   */
  private const val CUSHION_DEADBAND = 0.35

  /** Ceiling still unknown: the first adaptation window after the first sound has not closed. */
  const val CEILING_UNKNOWN = -1L

  /**
   * How far the cushion is from target, as -1..+1, with a deadband around the target.
   *
   * The deadband matters more than the gain: without it the loop sat at its limit off target, a
   * permanent detune (997.75 Hz for a 1000 Hz tone). Inside the band the buffer absorbs the difference.
   */
  fun cushionError(depth: Long, targetFrames: Int): Double {
    val target = targetFrames.toDouble()
    if (target <= 0) return 0.0
    val error = (depth - target) / target
    if (Math.abs(error) < CUSHION_DEADBAND) return 0.0
    return error.coerceIn(-1.0, 1.0)
  }

  /**
   * How far the rate may be moved right now.
   *
   * Normally a whisper, because the buffer, not the rate, absorbs jitter. Far from target it may ease
   * on or off harder (half a percent, about eight cents) for tens of seconds: too thin, the next gap
   * is a hole and 0.1% takes two minutes to gain 100 ms; too deep, one 148 ms burst left the mirror
   * 241 ms behind the picture, which 0.1% would take twenty-five minutes to hand back.
   *
   * Except the depth the stream started with, up to [startupCeilingFrames]. On a Pixel 4 the ring
   * held 112–156 ms just after the first sound: half a percent was eight cents sharp, and skipping it
   * starved the speaker (over Wi-Fi it is the cushion the next gap spends). It drains at
   * [STARTUP_DRAIN_DRIFT] instead; depth above the ceiling is a later burst and drains at full rate.
   */
  fun authority(depth: Long, floorFrames: Long, recoveryFrames: Long, startupCeilingFrames: Long): Double =
      when {
        depth < floorFrames -> REBUILD_DRIFT
        depth <= recoveryFrames -> MAX_DRIFT
        startupCeilingFrames == CEILING_UNKNOWN || depth <= startupCeilingFrames -> STARTUP_DRAIN_DRIFT
        else -> REBUILD_DRIFT
      }

  /**
   * The start-up ceiling when an adaptation window closes: the deepest the ring came in it, plus
   * [marginFrames]. The peak, not the depth at that instant: over Wi-Fi a window can close between
   * clumps, and the next clump is no burst. It comes down as the start-up depth is drained or spent
   * and never goes up again, so a later burst is never mistaken for it.
   */
  fun nextStartupCeiling(current: Long, windowPeakFrames: Long, marginFrames: Long): Long =
      if (current == CEILING_UNKNOWN) windowPeakFrames + marginFrames
      else minOf(current, windowPeakFrames + marginFrames)
}
