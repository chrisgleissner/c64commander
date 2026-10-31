/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.dsp

import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner
import uk.gleissner.c64commander.AudioProcessingBridge
import kotlin.math.PI
import kotlin.math.sin

class WaveWindowTest {
  private val rate = 48000
  private val ring = FloatArray(1 shl 17)

  private fun fill(from: Long, to: Long, value: (Long) -> Float) {
    for (index in from until to) ring[(index and (ring.size - 1).toLong()).toInt()] = value(index)
  }

  private fun sine(hz: Double, amplitude: Double = 0.9): (Long) -> Float =
      { index -> (amplitude * sin(2.0 * PI * hz * index / rate)).toFloat() }

  @Test
  fun a440HertzSineYieldsATriggeredWindowThatStartsAtAnUpwardCrossing() {
    fill(0, 6000, sine(440.0))
    val window = WaveWindow.extract(ring, end = 6000, heldFrom = 0)
    assertTrue(window.triggered)
    assertTrue("starts before the search span", window.start >= 6000 - WaveWindow.SEARCH_SAMPLES)
    assertTrue("runs past the frame's position", window.start + WaveWindow.WINDOW_SAMPLES <= 6000)
    assertTrue("sample before the start is ${ring[(window.start - 1).toInt()]}", ring[(window.start - 1).toInt()] <= -0.02f)
    assertTrue("start sample is ${ring[window.start.toInt()]}", ring[window.start.toInt()] >= 0.0f)
    val period = rate / 440.0
    val crossing = Math.round(window.start / period) * period
    assertTrue("start ${window.start} is ${window.start - crossing} samples after the crossing", window.start - crossing in 0.0..1.0)
  }

  @Test
  fun theWindowStartsAtTheFirstQualifyingCrossingInTheSearchSpan() {
    fill(0, 6000, sine(440.0))
    val window = WaveWindow.extract(ring, end = 6000, heldFrom = 0)
    for (earlier in 6000 - WaveWindow.SEARCH_SAMPLES until window.start) {
      val rising = ring[(earlier - 1).toInt()] <= -0.02f && ring[earlier.toInt()] >= 0.0f
      assertFalse("a crossing at $earlier precedes the start ${window.start}", rising)
    }
  }

  @Test
  fun eachPointIsTheMeanOfFourSamplesScaledToAByte() {
    fill(0, 6000, sine(440.0))
    val window = WaveWindow.extract(ring, end = 6000, heldFrom = 0)
    assertEquals(WaveWindow.POINTS, window.points.size)
    for (point in intArrayOf(0, 1, 100, 255)) {
      val first = window.start.toInt() + point * 4
      val mean = (0 until 4).sumOf { ring[first + it].toDouble() } / 4.0
      assertEquals("point $point", Math.round(mean * 127.0).toInt(), window.points[point].toInt())
    }
  }

  @Test
  fun silenceAndDirectCurrentFindNoCrossingAndCoverTheNewestSamples() {
    for (level in floatArrayOf(0.0f, 0.5f, -0.5f)) {
      fill(0, 6000, { level })
      val window = WaveWindow.extract(ring, end = 6000, heldFrom = 0)
      assertFalse("level $level", window.triggered)
      assertEquals("level $level", 6000L - WaveWindow.WINDOW_SAMPLES, window.start)
    }
  }

  @Test
  fun aRiseThatDoesNotStartAtOrBelowMinusTwoHundredthsIsNotATrigger() {
    fill(0, 6000, { index -> if (index % 200 < 100) -0.019f else 0.3f })
    assertFalse(WaveWindow.extract(ring, end = 6000, heldFrom = 0).triggered)
    fill(0, 6000, { index -> if (index % 200 < 100) -0.02f else 0.3f })
    assertTrue(WaveWindow.extract(ring, end = 6000, heldFrom = 0).triggered)
  }

  @Test
  fun fullScaleMapsToPlusAndMinus127AndOverloadIsClamped() {
    fill(0, 6000, { 1.0f })
    assertTrue(WaveWindow.extract(ring, end = 6000, heldFrom = 0).points.all { it.toInt() == 127 })
    fill(0, 6000, { -1.0f })
    assertTrue(WaveWindow.extract(ring, end = 6000, heldFrom = 0).points.all { it.toInt() == -127 })
    fill(0, 6000, { 1.7f })
    assertTrue(WaveWindow.extract(ring, end = 6000, heldFrom = 0).points.all { it.toInt() == 127 })
    fill(0, 6000, { -1.7f })
    assertTrue(WaveWindow.extract(ring, end = 6000, heldFrom = 0).points.all { it.toInt() == -127 })
  }

  @Test
  fun theWindowNeverReadsSamplesAfterTheFramesPosition() {
    ring.fill(1.0f)
    fill(0, 1500, { 0.0f })
    val window = WaveWindow.extract(ring, end = 1500, heldFrom = 0)
    assertFalse(window.triggered)
    assertTrue("a sample past the position was read", window.points.all { it.toInt() == 0 })
  }

  @Test
  fun theWindowNeverReadsSamplesTheRingNoLongerHolds() {
    ring.fill(1.0f)
    fill(3000, 3600, { 0.0f })
    val window = WaveWindow.extract(ring, end = 3600, heldFrom = 3000)
    assertFalse(window.triggered)
    assertTrue("samples before the held span were read", window.points.all { it.toInt() == 0 })
    assertTrue("oldest read ${window.oldestRead}", window.oldestRead >= 3000)
  }

  @Test
  fun aCrossingAtTheOldestHeldSampleIsNotUsedBecauseItsPredecessorIsNotHeld() {
    ring.fill(-1.0f)
    fill(3000, 4100, { index -> if (index == 3000L) 0.5f else 0.0f })
    val window = WaveWindow.extract(ring, end = 4100, heldFrom = 3000)
    assertFalse(window.triggered)
  }

  @Test
  fun aStreamShorterThanTheWindowIsPaddedWithSilenceBeforeItsFirstSample() {
    ring.fill(1.0f)
    fill(0, 500, sine(440.0))
    val window = WaveWindow.extract(ring, end = 500, heldFrom = 0)
    assertTrue(window.start < 0)
    val silentPoints = (-window.start).toInt() / WaveWindow.SAMPLES_PER_POINT - 1
    assertTrue(silentPoints > 0)
    for (point in 0 until silentPoints) assertEquals("point $point", 0, window.points[point].toInt())
  }
}

@RunWith(RobolectricTestRunner::class)
class AudioProcessingBridgeWaveWindowTest {
  private val rate = 48000
  private var clock = 5_000_000_000L
  private val hub = AudioFxHub { clock }.also {
    it.spectrumEnabled = true
    it.analyzer.prepareFor(live = false, sourceRate = rate, outputRate = rate)
  }
  private val bridge = AudioProcessingBridge { hub }

  init {
    for (block in 0 until 4) hub.analyzer.feed(TestSignals.sine(24000, rate, 440.0, 0.5, block * 24000L), 24000, rate)
    hub.analyzer.presentAt(framesAheadOfSpeaker = 30000L, timestampNanos = clock)
  }

  private fun read(request: JSObject?): JSObject {
    val call = mock(PluginCall::class.java)
    `when`(call.data).thenReturn(request)
    var resolved: JSObject? = null
    doAnswer {
          resolved = it.getArgument(0) as JSObject
          null
        }
        .`when`(call)
        .resolve(any())
    bridge.readSpectrum(call)
    return resolved!!
  }

  @Test
  fun aWaveRequestAddsA344CharacterBase64WindowAndItsTriggerFlag() {
    val result = read(JSObject().put("wave", true))
    val encoded = result.getString("wave")!!
    assertEquals(344, encoded.length)
    val bytes = Base64.decode(encoded, Base64.DEFAULT)
    assertEquals(WaveWindow.POINTS, bytes.size)
    assertTrue(bytes.any { it.toInt() > 40 })
    assertTrue(result.getBoolean("waveTriggered"))
  }

  @Test
  fun aRequestWithoutTheFlagCarriesNoWave() {
    val result = read(JSObject().put("targetNanos", clock + 10_000_000L))
    assertFalse(result.has("wave"))
    assertFalse(result.has("waveTriggered"))
    assertTrue((0 until 48).any { result.getJSONArray("bands").getInt(it) > -100 })
  }

  @Test
  fun aRequestWithNoBodyAtAllStillWorks() {
    val result = read(null)
    assertFalse(result.has("wave"))
  }

  @Test
  fun bandsFalseReturnsAFlatFloorOfBandsWithTheMetersAndTheWave() {
    val result = read(JSObject().put("wave", true).put("bands", false))
    for (i in 0 until 48) assertEquals(-100, result.getJSONArray("bands").getInt(i))
    assertEquals(48, result.getJSONArray("bands").length())
    assertEquals(-6.0, result.getInt("peakDb").toDouble(), 1.0)
    assertEquals(2, result.getJSONArray("channels").length())
    assertTrue(result.has("wave"))
  }

  @Test
  fun everyFrameAheadCarriesItsOwnWindowWhenAskedFor() {
    val request = JSObject().put("wave", true).put("targetNanos", clock + 10_000_000L).put("count", 4).put("stepNanos", 16_700_000)
    val result = read(request)
    val ahead = result.getJSONArray("ahead")
    assertTrue(ahead.length() > 0)
    for (i in 0 until ahead.length()) assertEquals(344, ahead.getJSONObject(i).getString("wave").length)
  }
}
