/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */


package uk.gleissner.c64commander.dsp

import java.io.File
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.sin
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** The web tone plot draws the response of these filters; both sides are held to one shared fixture. */
@RunWith(RobolectricTestRunner::class)
class ToneResponseParityTest {
  private fun cascadeDb(gainsDb: DoubleArray, hz: Double, rate: Int): Double {
    var db = 0.0
    for (band in 0 until Equalizer.BANDS) {
      if (gainsDb[band] == 0.0) continue
      val c = Equalizer.peakingCoefficients(Equalizer.CENTRE_HZ[band], rate, gainsDb[band])
      val w = 2.0 * PI * hz / rate
      val nr = c[0] + c[1] * cos(w) + c[2] * cos(2 * w)
      val ni = -(c[1] * sin(w) + c[2] * sin(2 * w))
      val dr = 1.0 + c[3] * cos(w) + c[4] * cos(2 * w)
      val di = -(c[3] * sin(w) + c[4] * sin(2 * w))
      db += 10.0 * log10((nr * nr + ni * ni) / (dr * dr + di * di))
    }
    return db
  }

  @Test
  fun theFilterResponseMatchesTheSharedFixtureWithinATenthOfADecibel() {
    val fixture = JSONObject(File("../../tests/fixtures/toneResponseVectors.json").readText())
    assertEquals(Equalizer.BAND_Q, fixture.getDouble("q"), 0.0)
    val rate = fixture.getInt("sampleRate")
    val cases = fixture.getJSONArray("cases")
    assertTrue(cases.length() >= 5)
    for (i in 0 until cases.length()) {
      val case = cases.getJSONObject(i)
      val gains = DoubleArray(Equalizer.BANDS) { case.getJSONArray("gainsDb").getDouble(it) }
      val hz = case.getJSONArray("hz")
      val expected = case.getJSONArray("expectedDb")
      for (k in 0 until hz.length()) {
        assertEquals("case $i at ${hz.getDouble(k)} Hz", expected.getDouble(k), cascadeDb(gains, hz.getDouble(k), rate), 0.1)
      }
    }
  }
}
