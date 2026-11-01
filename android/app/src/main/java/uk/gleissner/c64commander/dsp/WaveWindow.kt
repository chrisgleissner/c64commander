/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.dsp

/**
 * A short picture of the waveform: [POINTS] signed bytes, each the mean of [SAMPLES_PER_POINT] mono
 * samples scaled so full scale is 127.
 *
 * [start] is the index of the first sample the picture covers and [oldestRead] the oldest sample
 * that was read to find it, which a caller compares with what the writer has overwritten.
 */
internal class WaveWindow(val points: ByteArray, val triggered: Boolean, val start: Long, val oldestRead: Long) {
  companion object {
    const val POINTS = 256
    const val SAMPLES_PER_POINT = 4
    const val WINDOW_SAMPLES = POINTS * SAMPLES_PER_POINT
    const val SEARCH_SAMPLES = 2 * WINDOW_SAMPLES
    private const val TRIGGER_LOW = -0.02f
    private const val BYTE_FULL_SCALE = 127f

    /**
     * The window that ends at or before [end], among samples [heldFrom] and later of the power-of-two
     * [history] ring. It starts at the first rising zero crossing within the [SEARCH_SAMPLES] before
     * [end], so a steady tone lands in the same place on every read. Without a crossing it covers
     * the last [WINDOW_SAMPLES] before [end] and is not triggered. Samples before [heldFrom] read as silence.
     */
    fun extract(history: FloatArray, end: Long, heldFrom: Long): WaveWindow {
      val mask = (history.size - 1).toLong()
      val floor = maxOf(0L, heldFrom)
      fun sample(index: Long): Float = if (index < floor) 0.0f else history[(index and mask).toInt()]

      val latestStart = end - WINDOW_SAMPLES
      val firstCandidate = maxOf(end - SEARCH_SAMPLES, floor + 1)
      var start = latestStart
      var triggered = false
      var candidate = firstCandidate
      while (candidate <= latestStart) {
        if (sample(candidate - 1) <= TRIGGER_LOW && sample(candidate) >= 0.0f) {
          start = candidate
          triggered = true
          break
        }
        candidate++
      }
      val points = ByteArray(POINTS) { point ->
        var sum = 0.0f
        val from = start + point * SAMPLES_PER_POINT
        for (n in 0 until SAMPLES_PER_POINT) sum += sample(from + n)
        Math.round(sum / SAMPLES_PER_POINT * BYTE_FULL_SCALE).coerceIn(-127, 127).toByte()
      }
      val oldestRead = maxOf(floor, minOf(start, firstCandidate - 1))
      return WaveWindow(points, triggered, start, oldestRead)
    }
  }
}
