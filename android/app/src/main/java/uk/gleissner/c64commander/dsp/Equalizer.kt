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
import kotlin.math.sqrt

/**
 * Three-band equalizer: low shelf at 120 Hz, peaking filter at 1 kHz, high shelf at 6 kHz.
 *
 * Each band's gain moves towards its target at a bounded rate (a 12 dB change takes about 50 ms), the
 * coefficients being recomputed once per processed chunk, so changing a slider does not click. A band
 * at 0 dB that is not moving is skipped, and its filter memory cleared.
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

  fun setTargets(bassDb: Double, midDb: Double, trebleDb: Double) {
    targetDb[BASS] = bassDb
    targetDb[MID] = midDb
    targetDb[TREBLE] = trebleDb
  }

  /** True when every band is at 0 dB and staying there, so [process] would not touch the samples. */
  val isIdle: Boolean
    get() =
        currentDb[BASS] == 0.0 && targetDb[BASS] == 0.0 &&
            currentDb[MID] == 0.0 && targetDb[MID] == 0.0 &&
            currentDb[TREBLE] == 0.0 && targetDb[TREBLE] == 0.0 &&
            stateIsClear()

  fun process(left: FloatArray, right: FloatArray, frames: Int, seconds: Double) {
    if (frames == 0) return
    val maxStep = RAMP_DB_PER_SECOND * seconds / frames
    for (sample in 0 until frames) {
      for (band in 0 until BANDS) {
        val delta = targetDb[band] - currentDb[band]
        if (delta != 0.0) {
          currentDb[band] =
              if (Math.abs(delta) <= maxStep) targetDb[band] else currentDb[band] + Math.copySign(maxStep, delta)
          design(band, currentDb[band])
        }
        // Keep the zero-dB filter alive until its compatible state has decayed. Clearing it at
        // the instant the coefficient reaches zero discards an old-coefficient tail as a step.
        if (currentDb[band] != 0.0 || bandHasState(band)) {
          run(band, 0, left, sample, 1)
          run(band, 1, right, sample, 1)
        }
      }
    }
  }

  fun reset() {
    currentDb.fill(0.0)
    targetDb.fill(0.0)
    z1.fill(0.0)
    z2.fill(0.0)
  }

  private fun stateIsClear(): Boolean =
      !bandHasState(BASS) && !bandHasState(MID) && !bandHasState(TREBLE)

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
    val amplitude = 10.0.pow(gainDb / 40.0)
    val omega = 2.0 * PI * CENTRE_HZ[band] / sampleRate
    val cosW = cos(omega)
    val sinW = sin(omega)
    val n0: Double
    val n1: Double
    val n2: Double
    val m0: Double
    val m1: Double
    val m2: Double
    when (band) {
      MID -> {
        val alpha = sinW / (2.0 * MID_Q)
        n0 = 1.0 + alpha * amplitude
        n1 = -2.0 * cosW
        n2 = 1.0 - alpha * amplitude
        m0 = 1.0 + alpha / amplitude
        m1 = -2.0 * cosW
        m2 = 1.0 - alpha / amplitude
      }
      else -> {
        val alpha = sinW / 2.0 * sqrt(2.0)
        val root = 2.0 * sqrt(amplitude) * alpha
        if (band == BASS) {
          n0 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosW + root)
          n1 = 2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cosW)
          n2 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosW - root)
          m0 = (amplitude + 1) + (amplitude - 1) * cosW + root
          m1 = -2 * ((amplitude - 1) + (amplitude + 1) * cosW)
          m2 = (amplitude + 1) + (amplitude - 1) * cosW - root
        } else {
          n0 = amplitude * ((amplitude + 1) + (amplitude - 1) * cosW + root)
          n1 = -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosW)
          n2 = amplitude * ((amplitude + 1) + (amplitude - 1) * cosW - root)
          m0 = (amplitude + 1) - (amplitude - 1) * cosW + root
          m1 = 2 * ((amplitude - 1) - (amplitude + 1) * cosW)
          m2 = (amplitude + 1) - (amplitude - 1) * cosW - root
        }
      }
    }
    b0[band] = n0 / m0
    b1[band] = n1 / m0
    b2[band] = n2 / m0
    a1[band] = m1 / m0
    a2[band] = m2 / m0
  }

  companion object {
    const val BASS = 0
    const val MID = 1
    const val TREBLE = 2
    private const val BANDS = 3
    private val CENTRE_HZ = doubleArrayOf(120.0, 1000.0, 6000.0)
    private const val MID_Q = 0.7
    private const val RAMP_DB_PER_SECOND = 240.0
    private const val TINY = 1e-25
  }
}
