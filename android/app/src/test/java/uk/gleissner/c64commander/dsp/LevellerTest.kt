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

class LevellerTest {
  private val rate = 48000
  private val chunk = 240

  /** Plays [audio] (a whole tune, already in the ring) and returns the gain in dB used for each chunk. */
  private fun gains(audio: ByteArray, leveller: Leveller = Leveller(rate), startFrame: Long = 0): DoubleArray {
    val total = audio.size / 4
    val ringFrames = total
    leveller.reset(startFrame)
    val out = ArrayList<Double>()
    var play = startFrame
    while (play + chunk <= total) {
      leveller.analyse(audio, ringFrames, play, total.toLong())
      out.add(TestSignals.linearToDb(leveller.nextGain(play, chunk.toDouble() / rate)))
      play += chunk
    }
    return out.toDoubleArray()
  }

  private fun at(gains: DoubleArray, seconds: Double): Double = gains[(seconds * rate / chunk).toInt()]

  private fun sineRmsDb(seconds: Int, rmsDb: Double, hz: Double = 1000.0, start: Long = 0): ByteArray =
      TestSignals.sine(seconds * rate, rate, hz, TestSignals.dbToLinear(rmsDb + 3.0103), start)

  @Test
  fun aQuietTuneIsBroughtUpToTheTarget() {
    val g = gains(sineRmsDb(12, -30.0))
    assertEquals(10.0, at(g, 8.0), 0.7)
  }

  @Test
  fun aLoudTuneIsBroughtDownToTheTarget() {
    val g = gains(sineRmsDb(12, -9.0))
    assertEquals(-11.0, at(g, 8.0), 0.7)
  }

  @Test
  fun boostIsLimitedToTwelveDecibels() {
    assertEquals(12.0, at(gains(sineRmsDb(10, -50.0)), 8.0), 0.2)
  }

  @Test
  fun aLoudSineIsCutToTheTarget() {
    assertEquals(-13.9, at(gains(TestSignals.sine(10 * rate, rate, 1000.0, 0.7)), 8.0), 0.7)
  }

  @Test
  fun aNewTuneIsLevelledFromItsFirstSecond() {
    val g = gains(sineRmsDb(6, -30.0))
    assertEquals(10.0, at(g, 0.1), 1.0)
  }

  @Test
  fun aResetMidwayDropsTheOldTunesGain() {
    val loud = sineRmsDb(4, -9.0)
    val quiet = sineRmsDb(6, -34.0)
    val audio = TestSignals.concat(loud, quiet)
    val leveller = Leveller(rate)
    leveller.reset(0)
    var play = 0L
    val total = audio.size / 4
    while (play < 4L * rate) {
      leveller.analyse(audio, total, play, total.toLong())
      leveller.nextGain(play, chunk.toDouble() / rate)
      play += chunk
    }
    leveller.reset(play)
    leveller.analyse(audio, total, play, total.toLong())
    assertEquals(12.0, TestSignals.linearToDb(leveller.nextGain(play, chunk.toDouble() / rate)), 0.5)
  }

  @Test
  fun gainIsAlreadyDownBeforeALoudPassageArrives() {
    val loudAt = 10
    val audio = TestSignals.concat(sineRmsDb(loudAt, -40.0), sineRmsDb(6, -10.0, start = loudAt * rate.toLong()))
    val g = gains(audio)
    val before = at(g, loudAt - 3.0)
    val justBefore = at(g, loudAt - 0.15)
    assertEquals(12.0, before, 0.3)
    assertTrue("gain was $justBefore dB just before the loud passage", justBefore < before - 15.0)
  }

  @Test
  fun gainReleasesSlowlyAfterALoudPassage() {
    val audio = TestSignals.concat(sineRmsDb(6, -10.0), sineRmsDb(14, -40.0, start = 6L * rate))
    val g = gains(audio)
    val cut = at(g, 5.0)
    val afterOne = at(g, 8.0)
    val afterEight = at(g, 18.0)
    assertTrue("released too fast: $cut -> $afterOne", afterOne < cut + 12.0)
    assertTrue("never released: $afterEight", afterEight > cut + 15.0)
  }

  @Test
  fun silenceDoesNotPumpTheGainUp() {
    val audio = TestSignals.concat(sineRmsDb(5, -10.0), ByteArray(15 * rate * 4))
    val g = gains(audio)
    val loud = at(g, 4.0)
    assertTrue(at(g, 19.0) <= loud + 0.1)
    assertEquals(0.0, at(gains(ByteArray(10 * rate * 4)), 8.0), 0.0)
  }

  @Test
  fun anAudioFloorBelowTheGateIsNotBoosted() {
    assertEquals(0.0, at(gains(sineRmsDb(10, -70.0)), 8.0), 0.0)
  }

  @Test
  fun aPeakyQuietPassageIsNotBoostedIntoClipping() {
    val quiet = sineRmsDb(10, -34.0)
    for (second in 1 until 10) TestSignals.put(quiet, second * rate, 0.9 * 32768.0, 0.9 * 32768.0)
    val g = gains(quiet)
    val gain = TestSignals.dbToLinear(at(g, 8.0))
    assertTrue("gain $gain would clip a 0.9 peak", gain * 0.9 <= Leveller.PEAK_CEILING + 0.01)
  }

  @Test
  fun aRingThatHasWrappedStillAnalysesCorrectly() {
    val tune = sineRmsDb(3, -30.0)
    val ringFrames = rate
    val ring = ByteArray(ringFrames * 4)
    val leveller = Leveller(rate)
    leveller.reset(0)
    var play = 0L
    var written = 0L
    var last = 0.0
    while (play + chunk <= 3L * rate) {
      while (written < 3L * rate && written - play < rate - 2000) {
        System.arraycopy(tune, (written * 4).toInt(), ring, (written % ringFrames).toInt() * 4, 4 * 240)
        written += 240
      }
      leveller.analyse(ring, ringFrames, play, written)
      last = TestSignals.linearToDb(leveller.nextGain(play, chunk.toDouble() / rate))
      play += chunk
    }
    assertEquals(10.0, last, 1.0)
  }
}
