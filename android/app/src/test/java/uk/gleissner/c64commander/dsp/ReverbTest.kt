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

class ReverbTest {
  private val rate = 48000

  private fun run(reverb: Reverb, left: FloatArray, right: FloatArray) {
    for (at in 0 until left.size step 240) {
      val l = left.copyOfRange(at, at + 240)
      val r = right.copyOfRange(at, at + 240)
      reverb.process(l, r, 240, 240.0 / rate)
      System.arraycopy(l, 0, left, at, 240)
      System.arraycopy(r, 0, right, at, 240)
    }
  }

  @Test
  fun offIsIdleAndLeavesTheSamplesAlone() {
    val reverb = Reverb(rate)
    assertTrue(reverb.isIdle)
    val l = FloatArray(240) { it / 300.0f }
    val r = l.copyOf()
    reverb.process(l, r, 240, 240.0 / rate)
    for (i in 0 until 240) assertEquals(i / 300.0f, l[i], 0.0f)
  }

  @Test
  fun anImpulseRingsOnThenDecaysBelowAudibilityAndStaysFinite() {
    val reverb = Reverb(rate)
    reverb.setTarget(1.0)
    val frames = rate * 6
    val left = FloatArray(frames)
    val right = FloatArray(frames)
    left[2400] = 0.8f
    right[2400] = 0.8f
    run(reverb, left, right)
    assertTrue(left.all { it - it == 0.0f })
    val early = TestSignals.rmsOf(left, 3000, 3000 + rate / 2)
    val late = TestSignals.rmsOf(left, frames - rate, frames)
    assertTrue("no tail: $early", early > 1e-3)
    assertTrue("tail did not decay: $late", TestSignals.linearToDb(late) < -90.0)
  }

  @Test
  fun theTailIsStereoNotJustMono() {
    val reverb = Reverb(rate)
    reverb.setTarget(1.0)
    val frames = rate
    val left = FloatArray(frames)
    val right = FloatArray(frames)
    left[100] = 0.8f
    right[100] = 0.8f
    run(reverb, left, right)
    var difference = 0.0
    for (i in 2400 until frames) difference += Math.abs(left[i] - right[i])
    assertTrue(difference > 0.01)
  }

  @Test
  fun loudContinuousInputStaysBounded() {
    val reverb = Reverb(rate)
    reverb.setTarget(1.0)
    val frames = rate * 3
    val signal = TestSignals.sine(frames, rate, 220.0, 0.9)
    val (left, right) = TestSignals.toFloats(signal, frames)
    run(reverb, left, right)
    val peak = left.maxOf { Math.abs(it) }
    assertTrue("peak $peak", peak < 3.0f)
    assertTrue(left.all { it - it == 0.0f })
  }

  @Test
  fun aNonFiniteInputIsContainedAndTheNetworkRecovers() {
    val reverb = Reverb(rate)
    reverb.setTarget(1.0)
    val l = FloatArray(240)
    val r = FloatArray(240)
    l[10] = Float.NaN
    reverb.process(l, r, 240, 240.0 / rate)
    assertTrue(l.all { it - it == 0.0f } && r.all { it - it == 0.0f })
    val clean = FloatArray(240) { 0.1f }
    val cleanRight = FloatArray(240) { 0.1f }
    reverb.process(clean, cleanRight, 240, 240.0 / rate)
    assertTrue(clean.all { it - it == 0.0f })
  }

  @Test
  fun turningOffRampsOutThenGoesIdleWithAClearedNetwork() {
    val reverb = Reverb(rate)
    reverb.setTarget(1.0)
    val l = FloatArray(240) { 0.3f }
    val r = FloatArray(240) { 0.3f }
    repeat(30) { reverb.process(l, r, 240, 240.0 / rate) }
    reverb.setTarget(0.0)
    repeat(30) { reverb.process(FloatArray(240), FloatArray(240), 240, 240.0 / rate) }
    assertTrue(reverb.isIdle)
    reverb.setTarget(1.0)
    val silentLeft = FloatArray(240)
    reverb.process(silentLeft, FloatArray(240), 240, 240.0 / rate)
    assertEquals(0.0, silentLeft.maxOf { Math.abs(it) }.toDouble(), 0.0)
  }

  @Test
  fun changingTheAmountRampsWithoutAStep() {
    val reverb = Reverb(rate)
    reverb.setTarget(1.0)
    val l = FloatArray(240) { 0.4f }
    val r = FloatArray(240) { 0.4f }
    val precedingDry = 0.4f
    reverb.process(l, r, 240, 240.0 / rate)
    var worst = 0.0f
    worst = Math.abs(l[0] - precedingDry)
    for (i in 1 until 240) worst = maxOf(worst, Math.abs(l[i] - l[i - 1]))
    assertTrue("step $worst", worst < 0.01f)
  }
}
