/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.dsp

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioFxTest {
  private val rate = 48000
  private val chunk = 240

  private fun pseudoRandom(frames: Int): ByteArray {
    val out = ByteArray(frames * 4)
    var state = 12345L
    for (i in 0 until frames * 4) {
      state = state * 6364136223846793005L + 1442695040888963407L
      out[i] = (state shr 33).toByte()
    }
    return out
  }

  /** Runs [audio] through the chain chunk by chunk, as the pipeline does, returning what comes out. */
  private fun run(hub: AudioFxHub, audio: ByteArray, from: Int = 0, to: Int = audio.size / 4): ByteArray {
    val fx = AudioFx(rate, rate, hub)
    val out = audio.copyOf()
    var at = from
    while (at + chunk <= to) {
      val play = at.toLong()
      if (fx.prepare(play)) {
        fx.analyseAhead(audio, audio.size / 4, play, (audio.size / 4).toLong())
        val piece = out.copyOfRange(at * 4, (at + chunk) * 4)
        fx.process(piece, chunk, play)
        System.arraycopy(piece, 0, out, at * 4, piece.size)
      }
      at += chunk
    }
    return out
  }

  @Test
  fun withEverythingOffTheChainDoesNotTouchTheSamples() {
    val hub = AudioFxHub()
    val fx = AudioFx(rate, rate, hub)
    assertFalse(fx.prepare(0))
    val audio = pseudoRandom(rate)
    assertArrayEquals(audio, run(hub, audio))
  }

  @Test
  fun clampingKeepsEveryParameterInRange() {
    val hub = AudioFxHub()
    hub.setParams(true, -40.0, 99.0, Double.NaN, 400.0, -3.0)
    val p = hub.params
    assertEquals(-12.0, p.bassDb, 0.0)
    assertEquals(12.0, p.midDb, 0.0)
    assertEquals(0.0, p.trebleDb, 0.0)
    assertEquals(100.0, p.stereoWidth, 0.0)
    assertEquals(0.0, p.reverb, 0.0)
    assertTrue(p.levelling)
    assertTrue(FxParams.OFF.isNeutral)
    assertFalse(p.isNeutral)
  }

  @Test
  fun anEffectTurnedOffAgainRampsOutAndThenReturnsToExactBypass() {
    val hub = AudioFxHub()
    val fx = AudioFx(rate, rate, hub)
    val audio = TestSignals.sine(rate, rate, 300.0, 0.3)
    hub.setParams(false, 0.0, 6.0, 0.0, 50.0, 40.0)
    var at = 0
    while (at + chunk <= rate / 2) {
      assertTrue(fx.prepare(at.toLong()))
      fx.process(audio.copyOfRange(at * 4, (at + chunk) * 4), chunk, at.toLong())
      at += chunk
    }
    hub.setParams(false, 0.0, 0.0, 0.0, 0.0, 0.0)
    var chunksUntilBypass = 0
    while (fx.prepare(at.toLong())) {
      fx.process(audio.copyOfRange(at * 4, (at + chunk) * 4), chunk, at.toLong())
      at += chunk
      chunksUntilBypass++
      assertTrue("never returned to bypass", chunksUntilBypass < 200)
    }
    assertFalse(fx.prepare(at.toLong()))
  }

  @Test
  fun levellingBringsAQuietSineToTheTargetAndNeverClips() {
    val hub = AudioFxHub()
    hub.setParams(true, 0.0, 0.0, 0.0, 0.0, 0.0)
    val quiet = TestSignals.sine(8 * rate, rate, 1000.0, TestSignals.dbToLinear(-26.0))
    val out = run(hub, quiet)
    val rms = TestSignals.linearToDb(TestSignals.rms(out, 6 * rate, 8 * rate))
    assertEquals(-20.0, rms, 1.0)
  }

  @Test
  fun levellingNeverPushesSparsePeaksPastTheCeiling() {
    val hub = AudioFxHub()
    hub.setParams(true, 0.0, 0.0, 0.0, 0.0, 0.0)
    val audio = TestSignals.sine(10 * rate, rate, 700.0, TestSignals.dbToLinear(-30.0))
    for (second in 1 until 10) for (i in 0 until 30) TestSignals.put(audio, second * rate + i, 0.95 * 32768.0, 0.95 * 32768.0)
    val out = run(hub, audio)
    val ceiling = (Leveller.PEAK_CEILING * 32768.0).toInt() + 2
    assertTrue("peak ${TestSignals.peak(out, 0, 10 * rate)} exceeds $ceiling", TestSignals.peak(out, 0, 10 * rate) <= ceiling)
  }

  @Test
  fun anAllOnChainStaysFiniteAndInRangeOnLoudNoise() {
    val hub = AudioFxHub()
    hub.setParams(true, 12.0, 12.0, 12.0, 100.0, 100.0)
    val out = run(hub, pseudoRandom(3 * rate))
    assertEquals(3 * rate * 4, out.size)
    assertFalse("the all-on chain was a no-op", out.contentEquals(pseudoRandom(3 * rate)))
  }

  @Test
  fun aDiscontinuousFlushClearsEffectHistoryBeforeTheReplacementAudio() {
    val hub = AudioFxHub()
    hub.setParams(false, 0.0, 0.0, 0.0, 100.0, 100.0)
    val fx = AudioFx(rate, rate, hub)
    val tone = TestSignals.sine(rate, rate, 700.0, 0.7)
    for (at in 0 until rate step chunk) {
      val piece = tone.copyOfRange(at * 4, (at + chunk) * 4)
      fx.prepare(at.toLong())
      fx.process(piece, chunk, at.toLong())
    }
    fx.onFlush(rate.toLong())
    hub.setParams(false, 0.0, 0.0, 0.0, 100.0, 100.0)
    val silence = ByteArray(chunk * 4)
    assertTrue(fx.prepare(rate.toLong()))
    fx.process(silence, chunk, rate.toLong())
    assertEquals(0, TestSignals.peak(silence, 0, chunk))
  }

  @Test
  fun switchingLevellingOnRampsTheGainWithoutAStep() {
    val hub = AudioFxHub()
    val fx = AudioFx(rate, rate, hub)
    val audio = TestSignals.sine(rate, rate, 200.0, TestSignals.dbToLinear(-26.0))
    val ring = audio
    hub.setParams(true, 0.0, 0.0, 0.0, 0.0, 0.0)
    val output = ByteArray(audio.size)
    var at = 0
    while (at + chunk <= rate) {
      val piece = audio.copyOfRange(at * 4, (at + chunk) * 4)
      if (fx.prepare(at.toLong())) {
        fx.analyseAhead(ring, rate, at.toLong(), rate.toLong())
        fx.process(piece, chunk, at.toLong())
      }
      System.arraycopy(piece, 0, output, at * 4, piece.size)
      at += chunk
    }
    var worst = 0
    var steady = 0
    for (i in 1 until rate) {
      val step = Math.abs(TestSignals.left(output, i) - TestSignals.left(output, i - 1))
      if (i < rate / 2) worst = maxOf(worst, step) else steady = maxOf(steady, step)
    }
    assertTrue("ramp step $worst vs settled $steady", worst <= steady + 8)
  }

  @Test
  fun disablingLevellingFadesLimiterContributionToUnityBeforeExactBypass() {
    val hub = AudioFxHub()
    val fx = AudioFx(rate, rate, hub)
    val loud = TestSignals.sine(rate, rate, 1000.0, 0.99)
    hub.setParams(true, 0.0, 0.0, 0.0, 0.0, 0.0)
    var at = 0
    repeat(24) {
      val piece = loud.copyOfRange(at * 4, (at + chunk) * 4)
      fx.prepare(at.toLong())
      fx.analyseAhead(loud, rate, at.toLong(), rate.toLong())
      fx.process(piece, chunk, at.toLong())
      at += chunk
    }
    hub.setParams(false, 0.0, 0.0, 0.0, 0.0, 0.0)
    var chunks = 0
    while (fx.prepare(at.toLong())) {
      val piece = loud.copyOfRange(at * 4, (at + chunk) * 4)
      fx.process(piece, chunk, at.toLong())
      at += chunk
      chunks++
      assertTrue("limiter kept processing after its 50 ms fade", chunks <= 11)
    }
    val untouched = loud.copyOfRange(at * 4, (at + chunk) * 4)
    assertFalse(fx.prepare(at.toLong()))
    assertArrayEquals(untouched, loud.copyOfRange(at * 4, (at + chunk) * 4))
  }
}
