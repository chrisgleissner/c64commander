/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.getcapacitor.Bridge
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner
import uk.gleissner.c64commander.dsp.AudioFxHub
import uk.gleissner.c64commander.dsp.TestSignals

@RunWith(RobolectricTestRunner::class)
class StreamUdpPluginAudioFxTest {
  private lateinit var plugin: StreamUdpPlugin
  private val hub = AudioFxHub()

  @Before
  fun setUp() {
    plugin = StreamUdpPlugin()
    val bridge = mock(Bridge::class.java)
    `when`(bridge.context).thenReturn(ApplicationProvider.getApplicationContext<Context>())
    val field = Plugin::class.java.getDeclaredField("bridge")
    field.isAccessible = true
    field.set(plugin, bridge)
    plugin.fxHub = hub
  }

  private fun call(configure: (PluginCall) -> Unit = {}): Pair<PluginCall, () -> JSObject?> {
    val call = mock(PluginCall::class.java)
    configure(call)
    var resolved: JSObject? = null
    doAnswer {
          resolved = it.getArgument(0) as JSObject
          null
        }
        .`when`(call)
        .resolve(any())
    return call to { resolved }
  }

  @Test
  fun setAudioProcessingStoresClampedValuesAndResolvesEmpty() {
    val (c, resolved) =
        call {
          `when`(it.getBoolean("levelling", false)).thenReturn(true)
          `when`(it.getDouble("bassDb")).thenReturn(30.0)
          `when`(it.getDouble("midDb")).thenReturn(-3.0)
          `when`(it.getDouble("trebleDb")).thenReturn(-50.0)
          `when`(it.getDouble("stereoWidth")).thenReturn(250.0)
          `when`(it.getDouble("reverb")).thenReturn(25.0)
        }
    plugin.setAudioProcessing(c)
    val p = hub.params
    assertTrue(p.levelling)
    assertEquals(12.0, p.bassDb, 0.0)
    assertEquals(-3.0, p.midDb, 0.0)
    assertEquals(-12.0, p.trebleDb, 0.0)
    assertEquals(100.0, p.stereoWidth, 0.0)
    assertEquals(25.0, p.reverb, 0.0)
    assertEquals(0, resolved()!!.length())
  }

  @Test
  fun missingFieldsFallBackToTheOffDefaults() {
    plugin.setAudioProcessing(call().first)
    assertTrue(hub.params.isNeutral)
  }

  @Test
  fun setSpectrumEnabledTogglesTheTap() {
    plugin.setSpectrumEnabled(call { `when`(it.getBoolean("enabled", false)).thenReturn(true) }.first)
    assertTrue(hub.spectrumEnabled)
    val (c, resolved) = call()
    plugin.setSpectrumEnabled(c)
    assertFalse(hub.spectrumEnabled)
    assertEquals(0, resolved()!!.length())
  }

  @Test
  fun readSpectrumReportsTheContractShape() {
    hub.spectrumEnabled = true
    hub.analyzer.prepare(48000)
    val block = TestSignals.sine(1600, 48000, 1000.0, 0.5)
    repeat(4) { hub.analyzer.feed(block, 1600, 48000) }
    val (c, resolved) = call()
    plugin.readSpectrum(c)
    val result = resolved()!!
    assertTrue(result.getBoolean("enabled"))
    assertTrue(result.getBoolean("active"))
    assertEquals(4, result.getInt("sequence"))
    assertEquals(48000, result.getInt("sampleRate"))
    assertEquals(48, result.getJSONArray("bands").length())
    assertEquals(-6.0, result.getInt("peakDb").toDouble(), 1.0)
    assertFalse(result.getBoolean("clipped"))
    val channels = result.getJSONArray("channels")
    assertEquals(2, channels.length())
    assertEquals("left", channels.getJSONObject(0).getString("id"))
    assertEquals("right", channels.getJSONObject(1).getString("id"))
    for (i in 0 until 2) {
      assertEquals(-9.0, channels.getJSONObject(i).getDouble("rmsDb"), 1.5)
      assertEquals(-6.0, channels.getJSONObject(i).getDouble("peakDb"), 1.0)
      assertFalse(channels.getJSONObject(i).getBoolean("clipped"))
    }
  }

  @Test
  fun readSpectrumWhileDisabledIsAFlatFloor() {
    val (c, resolved) = call()
    plugin.readSpectrum(c)
    val result = resolved()!!
    assertFalse(result.getBoolean("enabled"))
    assertFalse(result.getBoolean("active"))
    for (i in 0 until 48) assertEquals(-100, result.getJSONArray("bands").getInt(i))
  }
}
