/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.dsp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StereoWidenerTest {
  private val rate = 48000

  private fun widen(width: Double, frames: Int, fromSide: Double = 0.0): Pair<FloatArray, FloatArray> {
    val widener = StereoWidener(rate)
    widener.setTarget(width)
    val mono = TestSignals.sine(frames, rate, 440.0, 0.4)
    val sideSource = TestSignals.sine(frames, rate, 1500.0, 0.4)
    val left = FloatArray(frames) { TestSignals.left(mono, it) / 32768.0f + (fromSide * TestSignals.left(sideSource, it) / 32768.0).toFloat() }
    val right = FloatArray(frames) { TestSignals.right(mono, it) / 32768.0f - (fromSide * TestSignals.left(sideSource, it) / 32768.0).toFloat() }
    for (at in 0 until frames step 240) {
      val l = left.copyOfRange(at, at + 240)
      val r = right.copyOfRange(at, at + 240)
      widener.process(l, r, 240, 240.0 / rate)
      System.arraycopy(l, 0, left, at, 240)
      System.arraycopy(r, 0, right, at, 240)
    }
    return Pair(left, right)
  }

  @Test
  fun offIsIdleAndNeverTouchesTheSamples() {
    val widener = StereoWidener(rate)
    assertTrue(widener.isIdle)
    val l = FloatArray(240) { it / 300.0f }
    val r = FloatArray(240) { -it / 300.0f }
    val copyLeft = l.copyOf()
    val copyRight = r.copyOf()
    widener.process(l, r, 240, 240.0 / rate)
    assertTrue(l.contentEquals(copyLeft) && r.contentEquals(copyRight))
  }

  @Test
  fun theMonoDownmixIsUnchangedWhateverTheWidth() {
    val frames = rate
    val (left, right) = widen(1.0, frames)
    val mono = TestSignals.sine(frames, rate, 440.0, 0.4)
    for (i in 4800 until frames) {
      val mid = (left[i] + right[i]) * 0.5f
      assertEquals(TestSignals.left(mono, i) / 32768.0f, mid, 1e-5f)
    }
  }

  @Test
  fun aMonoSourceGainsASideSignalButNothingEscapesTheMidLevelPlusTheSideGain() {
    val frames = rate
    val (left, right) = widen(1.0, frames)
    var side = 0.0
    var peak = 0.0f
    for (i in 4800 until frames) {
      side += ((left[i] - right[i]) * 0.5).toDouble().let { it * it }
      peak = maxOf(peak, Math.abs(left[i]), Math.abs(right[i]))
    }
    assertTrue("no side signal was added", Math.sqrt(side / (frames - 4800)) > 0.05)
    assertTrue("peak $peak", peak <= 0.4f * (1.0f + 2.0f * StereoWidener.MAX_SIDE_GAIN.toFloat()))
  }

  @Test
  fun halfWidthAddsLessSideThanFullWidth() {
    val frames = rate
    fun sideRms(width: Double): Double {
      val (l, r) = widen(width, frames)
      return TestSignals.rmsOf(FloatArray(frames) { (l[it] - r[it]) * 0.5f }, 4800, frames)
    }
    assertTrue(sideRms(0.5) < sideRms(1.0) * 0.7)
  }

  @Test
  fun anExistingSideSignalIsKept() {
    val frames = rate
    val (left, right) = widen(0.0, frames, fromSide = 0.5)
    val side = TestSignals.rmsOf(FloatArray(frames) { (left[it] - right[it]) * 0.5f }, 4800, frames)
    assertEquals(0.5 * 0.4 / Math.sqrt(2.0), side, 0.01)
  }

  @Test
  fun switchingOnRampsWithoutAJump() {
    val widener = StereoWidener(rate)
    widener.setTarget(1.0)
    val l = FloatArray(240) { 0.3f }
    val r = FloatArray(240) { 0.3f }
    widener.process(l, r, 240, 240.0 / rate)
    var worst = 0.0f
    for (i in 1 until 240) worst = maxOf(worst, Math.abs(l[i] - l[i - 1]))
    assertTrue("step $worst", worst < 0.01f)
  }

  @Test
  fun turningOffClearsDelayedHistoryBeforeSilenceIsWidenedAgain() {
    val widener = StereoWidener(rate)
    widener.setTarget(1.0)
    repeat(20) {
      val tone = FloatArray(240) { 0.6f }
      widener.process(tone, tone.copyOf(), 240, 240.0 / rate)
    }
    widener.setTarget(0.0)
    repeat(12) { widener.process(FloatArray(240), FloatArray(240), 240, 240.0 / rate) }
    assertTrue(widener.isIdle)
    widener.setTarget(1.0)
    val silentLeft = FloatArray(240)
    val silentRight = FloatArray(240)
    widener.process(silentLeft, silentRight, 240, 240.0 / rate)
    assertEquals(0.0, silentLeft.maxOf { Math.abs(it) }.toDouble(), 0.0)
    assertEquals(0.0, silentRight.maxOf { Math.abs(it) }.toDouble(), 0.0)
  }
}
