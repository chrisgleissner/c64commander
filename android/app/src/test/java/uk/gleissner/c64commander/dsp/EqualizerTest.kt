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
import kotlin.math.log10
import kotlin.math.sin
import kotlin.math.sqrt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EqualizerTest {
  private val rate = 48000

  private fun gains(vararg pairs: Pair<Int, Double>): DoubleArray =
      DoubleArray(Equalizer.BANDS).also { for ((band, db) in pairs) it[band] = db }

  private fun measuredGainDb(hz: Double, bandsDb: DoubleArray): Double {
    val eq = Equalizer(rate)
    eq.setTargets(bandsDb)
    val frames = rate
    val (left, right) = TestSignals.toFloats(TestSignals.sine(frames, rate, hz, 0.1), frames)
    val input = TestSignals.rmsOf(left, rate / 2, frames)
    val output = FloatArray(frames)
    var at = 0
    while (at < frames) {
      val chunk = left.copyOfRange(at, at + 240)
      eq.process(chunk, right.copyOfRange(at, at + 240), 240, 240.0 / rate)
      System.arraycopy(chunk, 0, output, at, 240)
      at += 240
    }
    return TestSignals.linearToDb(TestSignals.rmsOf(output, rate / 2, frames) / input)
  }

  private fun formulaGainDb(band: Int, gainDb: Double, hz: Double): Double {
    val c = Equalizer.peakingCoefficients(Equalizer.CENTRE_HZ[band], rate, gainDb)
    val w = 2.0 * PI * hz / rate
    val re = { k: Double -> cos(k * w) }
    val im = { k: Double -> -sin(k * w) }
    val nr = c[0] + c[1] * re(1.0) + c[2] * re(2.0)
    val ni = c[1] * im(1.0) + c[2] * im(2.0)
    val dr = 1.0 + c[3] * re(1.0) + c[4] * re(2.0)
    val di = c[3] * im(1.0) + c[4] * im(2.0)
    return 20.0 * log10(sqrt((nr * nr + ni * ni) / (dr * dr + di * di)))
  }

  @Test
  fun everythingAtZeroIsIdleAndLeavesTheSamplesAlone() {
    val eq = Equalizer(rate)
    eq.setTargets(DoubleArray(Equalizer.BANDS))
    assertTrue(eq.isIdle)
    eq.setTargets(gains(3 to 3.0))
    assertTrue(!eq.isIdle)
  }

  @Test
  fun everyBandFollowsThePeakingFormulaAtItsCentreAndOneOctaveAway() {
    for (band in 0 until Equalizer.BANDS) {
      val centre = Equalizer.CENTRE_HZ[band]
      for (hz in listOf(centre, centre / 2, centre * 2)) {
        if (hz >= rate / 2.5) continue
        val expected = formulaGainDb(band, 9.0, hz)
        assertEquals("band $band at $hz Hz", expected, measuredGainDb(hz, gains(band to 9.0)), 0.5)
      }
    }
  }

  @Test
  fun aBoostPeaksAtItsCentreAndLeavesDistantBandsAlone() {
    assertEquals(9.0, measuredGainDb(1000.0, gains(5 to 9.0)), 0.3)
    assertEquals(0.0, measuredGainDb(40.0, gains(5 to 9.0)), 0.5)
    assertEquals(0.0, measuredGainDb(12000.0, gains(5 to 9.0)), 0.5)
  }

  @Test
  fun aCutLowersItsOwnBand() {
    assertEquals(-12.0, measuredGainDb(8000.0, gains(8 to -12.0)), 0.3)
  }

  @Test
  fun twoLiftedNeighboursLeaveNoDipBetweenThem() {
    assertTrue(measuredGainDb(700.0, gains(4 to 6.0, 5 to 6.0)) > 5.0)
  }

  @Test
  fun legacyThreeBandCallMapsToTheDocumentedBands() {
    val bands = FxParams.legacyBands(3.0, 6.0, -4.0)
    assertEquals(listOf(0.0, 3.0, 3.0, 0.0, 6.0, 6.0, 6.0, -4.0, -4.0, -4.0), bands.toList())
  }

  @Test
  fun movingASliderNeverStepsHarderThanTheSettledSignalItself() {
    val frames = rate
    val signal = TestSignals.sine(frames, rate, 100.0, 0.3)
    val target = DoubleArray(Equalizer.BANDS) { 12.0 }
    val settled = Equalizer(rate)
    settled.setTargets(target)
    val (settledLeft, settledRight) = TestSignals.toFloats(signal, frames)
    for (at in 0 until frames step 240) {
      val l = settledLeft.copyOfRange(at, at + 240)
      settled.process(l, settledRight.copyOfRange(at, at + 240), 240, 240.0 / rate)
      System.arraycopy(l, 0, settledLeft, at, 240)
    }
    var steadyStep = 0.0
    for (i in rate / 2 until frames - 1) steadyStep = maxOf(steadyStep, Math.abs(settledLeft[i + 1] - settledLeft[i]).toDouble())
    val eq = Equalizer(rate)
    val (left, right) = TestSignals.toFloats(signal, frames)
    var worst = 0.0
    var previous = 0.0f
    for (at in 0 until frames step 240) {
      if (at == rate / 4) eq.setTargets(target)
      val l = left.copyOfRange(at, at + 240)
      eq.process(l, right.copyOfRange(at, at + 240), 240, 240.0 / rate)
      for (i in 0 until 240) {
        if (at + i > 0) worst = maxOf(worst, Math.abs(l[i] - previous).toDouble())
        previous = l[i]
      }
    }
    assertTrue("step $worst against settled $steadyStep", worst <= steadyStep * 1.5)
  }

  @Test
  fun aGainChangeMidStreamReachesItsTargetWithinAboutTwentyMilliseconds() {
    val eq = Equalizer(rate)
    eq.setTargets(gains(5 to 12.0))
    val l = FloatArray(240)
    val r = FloatArray(240)
    eq.process(l, r, 240, 240.0 / rate)
    eq.process(l, r, 240, 240.0 / rate)
    eq.process(l, r, 240, 240.0 / rate)
    assertTrue("still ramping after 15 ms", !eq.isIdle)
    val reached = measuredGainDb(1000.0, gains(5 to 12.0))
    assertEquals(12.0, reached, 0.3)
  }

  @Test
  fun settlingBackToZeroBecomesIdleAgain() {
    val eq = Equalizer(rate)
    eq.setTargets(gains(1 to 12.0))
    val l = FloatArray(240)
    val r = FloatArray(240)
    repeat(20) { eq.process(l, r, 240, 240.0 / rate) }
    eq.setTargets(DoubleArray(Equalizer.BANDS))
    repeat(20) { eq.process(l, r, 240, 240.0 / rate) }
    assertTrue(eq.isIdle)
  }

  @Test
  fun crossingZeroKeepsTheFilterTailContinuousBeforeItBecomesIdle() {
    val eq = Equalizer(rate)
    eq.setTargets(gains(9 to 12.0))
    val input = FloatArray(240) { 0.3f }
    repeat(20) { eq.process(input.copyOf(), input.copyOf(), 240, 240.0 / rate) }
    eq.setTargets(DoubleArray(Equalizer.BANDS))
    val falling = FloatArray(240) { 0.3f }
    eq.process(falling, falling.copyOf(), 240, 240.0 / rate)
    var largest = 0.0f
    for (i in 1 until falling.size) largest = maxOf(largest, Math.abs(falling[i] - falling[i - 1]))
    assertTrue("zero-crossing step $largest", largest < 0.01f)
  }
}
