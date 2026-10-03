/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

/** Pitch-period search over [AudioPipeline]'s ring, for concealment that repeats whole periods. */
internal class RingPitchPeriod(
    private val ring: ByteArray,
    private val ringFrames: Int,
    private val sourceRate: Int,
) {
  /**
   * The length of one repetition of the audio just before a hole, in frames.
   *
   * Found by autocorrelation over the recent past: the lag at which the signal most resembles itself
   * is its pitch period, and repeating exactly that keeps the waveform continuous across the join.
   * The search runs on a decimated, mono-summed copy so it costs tens of microseconds rather than
   * milliseconds — it happens on the receive thread, and nothing there may be slow.
   */
  fun estimate(writeFrames: Long, available: Int): Int {
    val minLag = AudioPipeline.msToFrames(sourceRate, 1)
    val maxLag = minOf(AudioPipeline.msToFrames(sourceRate, 12), available / 2)
    if (maxLag <= minLag) return maxOf(1, minOf(available, AudioPipeline.msToFrames(sourceRate, 4)))
    val window = minOf(available, maxLag * 2)
    val stride = 4
    val n = window / stride
    if (n < 8) return maxOf(1, minOf(available, AudioPipeline.msToFrames(sourceRate, 4)))
    val base = writeFrames - window
    val history = DoubleArray(n)
    for (i in 0 until n) {
      val idx = ((base + i.toLong() * stride) % ringFrames).toInt() * AudioPipeline.BYTES_PER_FRAME
      val l = ((ring[idx].toInt() and 0xFF) or (ring[idx + 1].toInt() shl 8)).toShort().toInt()
      val r = ((ring[idx + 2].toInt() and 0xFF) or (ring[idx + 3].toInt() shl 8)).toShort().toInt()
      history[i] = (l + r).toDouble()
    }
    var bestLag = AudioPipeline.msToFrames(sourceRate, 4)
    var bestScore = -1.0
    var lag = minLag / stride
    val maxLagDecimated = maxLag / stride
    while (lag <= maxLagDecimated) {
      var num = 0.0
      var energy = 0.0
      var i = lag
      while (i < n) {
        num += history[i] * history[i - lag]
        energy += history[i - lag] * history[i - lag]
        i++
      }
      var current = 0.0
      var j = lag
      while (j < n) {
        current += history[j] * history[j]
        j++
      }
      // Normalise by BOTH windows. Dividing by the lagged window alone makes the score shrink as the
      // lag grows and the overlap shortens, which quietly biases every estimate towards short lags.
      val denom = Math.sqrt(energy * current)
      val score = if (denom > 0) num / denom else 0.0
      if (score > bestScore) {
        bestScore = score
        bestLag = lag * stride
      }
      lag++
    }
    return refine(writeFrames, bestLag, stride, window, available)
  }

  /**
   * Sharpen the period estimate to a single frame, around the decimated search's answer.
   *
   * The coarse search steps four frames at a time, so it can be two frames out — and two frames of a
   * 1350 Hz tone is a fifth of a period, which is a real step in the waveform where the repeat joins.
   * Concealment is only as good as this number: get it wrong and the hole is filled with something
   * audibly at the wrong pitch, which is exactly what a listener reports as a note briefly going off.
   */
  private fun refine(writeFrames: Long, coarseLag: Int, stride: Int, window: Int, available: Int): Int {
    val lowest = maxOf(1, coarseLag - stride)
    val highest = minOf(available / 2, coarseLag + stride)
    if (highest <= lowest) return coarseLag.coerceIn(1, available)
    var bestLag = coarseLag
    var bestScore = -1.0
    val base = writeFrames - window
    var lag = lowest
    while (lag <= highest) {
      var num = 0.0
      var energyLag = 0.0
      var energyCur = 0.0
      var i = lag
      while (i < window) {
        val cur = sampleAt(base + i)
        val prev = sampleAt(base + i - lag)
        num += cur * prev
        energyLag += prev * prev
        energyCur += cur * cur
        i += 2
      }
      val denom = Math.sqrt(energyLag * energyCur)
      val score = if (denom > 0) num / denom else 0.0
      if (score > bestScore) {
        bestScore = score
        bestLag = lag
      }
      lag++
    }
    return bestLag.coerceIn(1, available)
  }

  /** Mono sum of one ring frame, for the period search. */
  private fun sampleAt(frame: Long): Double {
    val idx = ((frame % ringFrames + ringFrames) % ringFrames).toInt() * AudioPipeline.BYTES_PER_FRAME
    val l = ((ring[idx].toInt() and 0xFF) or (ring[idx + 1].toInt() shl 8)).toShort().toInt()
    val r = ((ring[idx + 2].toInt() and 0xFF) or (ring[idx + 3].toInt() shl 8)).toShort().toInt()
    return (l + r).toDouble()
  }
}
