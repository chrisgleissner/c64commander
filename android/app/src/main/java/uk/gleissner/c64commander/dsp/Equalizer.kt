/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.dsp

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin

/**
 * Ten-band graphic equalizer made of peaking biquads at [CENTRE_HZ] with a Q of [BAND_Q].
 *
 * Each band's gain moves towards its target at a bounded rate (a 12 dB change takes about 20 ms) and
 * the coefficients are recomputed once per [BLOCK_FRAMES] frames while a band moves, so changing a
 * slider does not click. A band at 0 dB that is not moving is skipped, and its filter memory cleared.
 */
internal class Equalizer(private val sampleRate: Int) {
  private val targetDb = DoubleArray(BANDS)
  private val currentDb = DoubleArray(BANDS)
  private val b0 = DoubleArray(BANDS)
  private val b1 = DoubleArray(BANDS)
  private val b2 = DoubleArray(BANDS)
  private val a1 = DoubleArray(BANDS)
  private val a2 = DoubleArray(BANDS)
  private val z1 = DoubleArray(BANDS * 2)
  private val z2 = DoubleArray(BANDS * 2)
  private val restFrames = IntArray(BANDS)
  private val settleFrames = (SETTLE_SECONDS * sampleRate).toInt()

  fun setTargets(gainsDb: DoubleArray) {
    require(gainsDb.size == BANDS) { "Equalizer needs $BANDS gains, got ${gainsDb.size}" }
    gainsDb.copyInto(targetDb)
  }

  /** True when every band is at 0 dB and staying there, so [process] would not touch the samples. */
  val isIdle: Boolean
    get() = (0 until BANDS).all { currentDb[it] == 0.0 && targetDb[it] == 0.0 && !bandHasState(it) }

  fun process(left: FloatArray, right: FloatArray, frames: Int, seconds: Double) {
    if (frames == 0) return
    var from = 0
    while (from < frames) {
      val count = minOf(BLOCK_FRAMES, frames - from)
      val maxStep = RAMP_DB_PER_SECOND * seconds * count / frames
      for (band in 0 until BANDS) {
        val delta = targetDb[band] - currentDb[band]
        if (delta != 0.0) {
          currentDb[band] =
              if (Math.abs(delta) <= maxStep) targetDb[band] else currentDb[band] + Math.copySign(maxStep, delta)
          design(band, currentDb[band])
        }
        // A zero-dB filter keeps running until its tail has decayed; clearing it the instant the gain
        // reaches zero would discard that tail as a step.
        if (currentDb[band] != 0.0 || bandHasState(band)) {
          run(band, 0, left, from, count)
          run(band, 1, right, from, count)
        }
        restFrames[band] = if (currentDb[band] == 0.0 && targetDb[band] == 0.0) restFrames[band] + count else 0
        if (restFrames[band] >= settleFrames) clearState(band)
      }
      from += count
    }
  }

  private fun clearState(band: Int) {
    for (slot in band * 2..band * 2 + 1) {
      z1[slot] = 0.0
      z2[slot] = 0.0
    }
  }

  fun reset() {
    restFrames.fill(0)
    currentDb.fill(0.0)
    targetDb.fill(0.0)
    z1.fill(0.0)
    z2.fill(0.0)
  }

  private fun bandHasState(band: Int): Boolean {
    val slot = band * 2
    return z1[slot] != 0.0 || z1[slot + 1] != 0.0 || z2[slot] != 0.0 || z2[slot + 1] != 0.0
  }

  private fun run(band: Int, channel: Int, samples: FloatArray, from: Int, count: Int) {
    val slot = band * 2 + channel
    val c0 = b0[band]
    val c1 = b1[band]
    val c2 = b2[band]
    val d1 = a1[band]
    val d2 = a2[band]
    var s1 = z1[slot]
    var s2 = z2[slot]
    for (i in from until from + count) {
      val x = samples[i].toDouble()
      val y = c0 * x + s1
      s1 = c1 * x - d1 * y + s2
      s2 = c2 * x - d2 * y
      samples[i] = y.toFloat()
    }
    z1[slot] = if (Math.abs(s1) < TINY) 0.0 else s1
    z2[slot] = if (Math.abs(s2) < TINY) 0.0 else s2
  }

  private fun design(band: Int, gainDb: Double) {
    val c = peakingCoefficients(CENTRE_HZ[band], sampleRate, gainDb)
    b0[band] = c[0]
    b1[band] = c[1]
    b2[band] = c[2]
    a1[band] = c[3]
    a2[band] = c[4]
  }

  companion object {
    val CENTRE_HZ = doubleArrayOf(31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0)
    const val BANDS = 10
    const val BAND_Q = 1.4
    const val BLOCK_FRAMES = 8
    private const val SETTLE_SECONDS = 0.15
    private const val RAMP_DB_PER_SECOND = 600.0
    private const val TINY = 1e-25

    /** Normalised peaking biquad (RBJ cookbook): b0, b1, b2, a1, a2. */
    fun peakingCoefficients(centreHz: Double, sampleRate: Int, gainDb: Double): DoubleArray {
      val amplitude = 10.0.pow(gainDb / 40.0)
      val omega = 2.0 * PI * centreHz / sampleRate
      val cosW = cos(omega)
      val alpha = sin(omega) / (2.0 * BAND_Q)
      val a0 = 1.0 + alpha / amplitude
      return doubleArrayOf(
          (1.0 + alpha * amplitude) / a0,
          -2.0 * cosW / a0,
          (1.0 - alpha * amplitude) / a0,
          -2.0 * cosW / a0,
          (1.0 - alpha / amplitude) / a0,
      )
    }
  }
}
