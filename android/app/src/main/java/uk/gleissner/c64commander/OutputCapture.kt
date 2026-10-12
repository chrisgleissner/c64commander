/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

/**
 * Diagnostics only: a copy of exactly what was handed to the speaker.
 *
 * The end-to-end check that matters plays a known stimulus and grades what a microphone hears from
 * the phone. This covers everything up to the room — network, jitter buffer, resampler, concealment,
 * mixing — and needs no microphone. Owned by the plugin rather than by one [AudioPipeline], so a
 * capture keeps recording when a hard cut between tunes replaces the pipeline and its track.
 * Unarmed, recording costs one reference read.
 */
internal class OutputCapture {
  @Volatile private var buffer: ByteArray? = null
  @Volatile private var used = 0

  /** The sample rate the capture was armed at; the WAV header is written with it. */
  @Volatile
  var sampleRate = 0
    private set

  /** Arm a capture of the next [seconds] of interleaved stereo S16LE at [rate]. Replaces any capture running. */
  fun arm(seconds: Int, rate: Int) {
    used = 0
    sampleRate = rate
    buffer = ByteArray(rate.toLong().times(seconds.coerceIn(1, 60)).toInt() * BYTES_PER_FRAME)
  }

  /** Append the [written] bytes of [data] that reached the track. */
  fun record(data: ByteArray, written: Int) {
    val target = buffer ?: return
    val room = minOf(maxOf(written, 0), target.size - used)
    if (room > 0) {
      System.arraycopy(data, 0, target, used, room)
      used += room
    }
  }

  /** The captured PCM so far, and disarm. */
  fun take(): ByteArray {
    val target = buffer ?: return ByteArray(0)
    buffer = null
    return target.copyOf(used)
  }

  companion object {
    private const val BYTES_PER_FRAME = 4
  }
}
