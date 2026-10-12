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

class EqualizerTest {
  private val rate = 48000

  private fun gainDbAt(hz: Double, bassDb: Double, midDb: Double, trebleDb: Double): Double {
    val eq = Equalizer(rate)
    eq.setTargets(bassDb, midDb, trebleDb)
    val frames = rate
    val (left, right) = TestSignals.toFloats(TestSignals.sine(frames, rate, hz, 0.1), frames)
    val input = TestSignals.rmsOf(left, rate / 2, frames)
    var at = 0
    val chunk = FloatArray(240)
    val chunkRight = FloatArray(240)
    val output = FloatArray(frames)
    while (at < frames) {
      System.arraycopy(left, at, chunk, 0, 240)
      System.arraycopy(right, at, chunkRight, 0, 240)
      eq.process(chunk, chunkRight, 240, 240.0 / rate)
      System.arraycopy(chunk, 0, output, at, 240)
      at += 240
    }
    return TestSignals.linearToDb(TestSignals.rmsOf(output, rate / 2, frames) / input)
  }

  @Test
  fun everythingAtZeroIsIdleAndLeavesTheSamplesAlone() {
    val eq = Equalizer(rate)
    eq.setTargets(0.0, 0.0, 0.0)
    assertTrue(eq.isIdle)
    eq.setTargets(3.0, 0.0, 0.0)
    assertTrue(!eq.isIdle)
  }

  @Test
  fun bassBoostRaisesLowFrequenciesAndLeavesTheMidsAlone() {
    assertEquals(9.0, gainDbAt(40.0, 9.0, 0.0, 0.0), 1.0)
    assertEquals(0.0, gainDbAt(1000.0, 9.0, 0.0, 0.0), 1.0)
    assertEquals(0.0, gainDbAt(10000.0, 9.0, 0.0, 0.0), 0.5)
  }

  @Test
  fun midBandPeaksAtItsCentreFrequency() {
    assertEquals(6.0, gainDbAt(1000.0, 0.0, 6.0, 0.0), 0.3)
    assertEquals(0.0, gainDbAt(40.0, 0.0, 6.0, 0.0), 1.0)
  }

  @Test
  fun trebleCutLowersHighFrequencies() {
    assertEquals(-12.0, gainDbAt(15000.0, 0.0, 0.0, -12.0), 1.5)
    assertEquals(0.0, gainDbAt(200.0, 0.0, 0.0, -12.0), 0.5)
  }

  @Test
  fun bassCutLowersLowFrequencies() {
    assertEquals(-12.0, gainDbAt(40.0, -12.0, 0.0, 0.0), 1.5)
  }

  @Test
  fun movingASliderNeverStepsHarderThanTheSettledSignalItself() {
    val eq = Equalizer(rate)
    val frames = rate
    val signal = TestSignals.sine(frames, rate, 100.0, 0.3)
    val (left, right) = TestSignals.toFloats(signal, frames)
    val settled = Equalizer(rate)
    settled.setTargets(12.0, 12.0, 12.0)
    val (settledLeft, settledRight) = TestSignals.toFloats(signal, frames)
    for (at in 0 until frames step 240) {
      val l = settledLeft.copyOfRange(at, at + 240)
      settled.process(l, settledRight.copyOfRange(at, at + 240), 240, 240.0 / rate)
      System.arraycopy(l, 0, settledLeft, at, 240)
    }
    var steadyStep = 0.0
    for (i in rate / 2 until frames - 1) steadyStep = maxOf(steadyStep, Math.abs(settledLeft[i + 1] - settledLeft[i]).toDouble())
    var worst = 0.0
    var previous = 0.0f
    for (at in 0 until frames step 240) {
      if (at == rate / 4) eq.setTargets(12.0, 12.0, 12.0)
      val l = left.copyOfRange(at, at + 240)
      eq.process(l, right.copyOfRange(at, at + 240), 240, 240.0 / rate)
      for (i in 0 until 240) {
        if (at + i > 0) worst = maxOf(worst, Math.abs(l[i] - previous).toDouble())
        previous = l[i]
      }
    }
    assertTrue("step $worst against settled $steadyStep", worst <= steadyStep * 1.25)
  }

  @Test
  fun settlingBackToZeroBecomesIdleAgain() {
    val eq = Equalizer(rate)
    eq.setTargets(12.0, 0.0, 0.0)
    val l = FloatArray(240)
    val r = FloatArray(240)
    repeat(20) { eq.process(l, r, 240, 240.0 / rate) }
    eq.setTargets(0.0, 0.0, 0.0)
    repeat(20) { eq.process(l, r, 240, 240.0 / rate) }
    assertTrue(eq.isIdle)
  }

  @Test
  fun crossingZeroKeepsTheFilterTailContinuousBeforeItBecomesIdle() {
    val eq = Equalizer(rate)
    eq.setTargets(0.0, 0.0, 12.0)
    val input = FloatArray(240) { 0.3f }
    repeat(20) { eq.process(input.copyOf(), input.copyOf(), 240, 240.0 / rate) }
    eq.setTargets(0.0, 0.0, 0.0)
    val falling = FloatArray(240) { 0.3f }
    eq.process(falling, falling.copyOf(), 240, 240.0 / rate)
    var largest = 0.0f
    for (i in 1 until falling.size) largest = maxOf(largest, Math.abs(falling[i] - falling[i - 1]))
    assertTrue("zero-crossing step $largest", largest < 0.01f)
  }
}
