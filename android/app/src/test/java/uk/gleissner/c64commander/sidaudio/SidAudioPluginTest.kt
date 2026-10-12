/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.sidaudio

import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.MessageHandler
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginResult
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.robolectric.RobolectricTestRunner
import uk.gleissner.c64commander.PipelineClock

/**
 * The plugin layer, through real `PluginCall`s built from the JSON the WebView sends.
 *
 * Real calls rather than mocks, because the defect this exists for was in how a call's numbers are
 * read: JavaScript numbers that fit in 32 bits arrive as `Integer`, and `PluginCall.getLong` returns
 * null for those — so every sequence number and buffer id read as missing, and nothing played.
 */
@RunWith(RobolectricTestRunner::class)
class SidAudioPluginTest {
  private val handler = mock(MessageHandler::class.java)
  private val results = mutableListOf<Pair<PluginResult?, PluginResult?>>()
  private lateinit var plugin: SidAudioPlugin
  private lateinit var host: RecordingHost
  private val clock =
      object : PipelineClock {
        var now = 0L

        override fun nanoTime(): Long = now

        override fun park(nanos: Long) {
          now += nanos
        }
      }

  private class RecordingOutput : FeedOutput {
    var frames = 0L
    var flushes = 0
    val samples = mutableListOf<Short>()

    override fun offer(data: ByteArray, offset: Int, length: Int) {
      frames += length / 4
      for (i in 0 until length / 2) samples.add(((data[offset + i * 2].toInt() and 0xFF) or (data[offset + i * 2 + 1].toInt() shl 8)).toShort())
    }

    override fun flush() {
      flushes += 1
    }

    override fun pause() = Unit

    override fun resume() = Unit

    override fun setGain(gain: Double) = Unit

    override fun bufferedMs(): Double = 0.0

    override fun ringMs(): Double = 0.0

    override fun underruns(): Int = 0
  }

  private class RecordingHost : FeedOutputHost {
    var output: RecordingOutput? = null

    override fun open(settings: FeedTrackSettings): FeedOutput = RecordingOutput().also { output = it }

    override fun isCurrent(output: FeedOutput): Boolean = this.output === output

    override fun close(output: FeedOutput) = Unit
  }

  @Before
  fun setUp() {
    doAnswer { invocation ->
          results.add(invocation.getArgument<PluginResult?>(1) to invocation.getArgument<PluginResult?>(2))
          null
        }
        .`when`(handler)
        .sendResponseMessage(any(), any(), any())
    plugin = SidAudioPlugin()
    host = RecordingHost()
    plugin.feed = LocalAudioFeed(host, clock) { _, _, _ -> }
  }

  private fun call(method: String, vararg fields: Pair<String, Any>): PluginCall {
    val data = JSObject()
    for ((key, value) in fields) data.put(key, value)
    return PluginCall(handler, "SidAudio", "cb-$method", method, data)
  }

  private fun pump() {
    repeat(50) { plugin.feed.runOnce() }
  }

  private fun lastError(): String? = results.last().second?.let { JSObject(it.toString()).optString("message") }

  private fun openSession(serial: Int = 1) =
      plugin.openSession(
          call("openSession", "serial" to serial, "sampleRate" to 48000, "bufferMs" to 15000, "maxRingMs" to 20000, "trackBursts" to 16, "primeMs" to 600))

  private fun base64Pcm(frames: Int, value: Int): String {
    val bytes = ByteArray(frames * 4)
    for (i in 0 until frames * 2) {
      bytes[i * 2] = (value and 0xFF).toByte()
      bytes[i * 2 + 1] = ((value shr 8) and 0xFF).toByte()
    }
    return Base64.encodeToString(bytes, Base64.NO_WRAP)
  }

  @Test
  fun `takes sequence numbers that JavaScript sends as 32-bit numbers`() {
    openSession()
    plugin.enqueuePcm(call("enqueuePcm", "serial" to 1, "seq" to 1, "data" to base64Pcm(100, 1234)))
    pump()
    assertNull(results.last().second)
    assertEquals(100L, host.output!!.frames)
    assertEquals(1234, host.output!!.samples.first().toInt())
  }

  @Test
  fun `enqueues a native buffer range, and takes an ephemeral buffer out of the store`() {
    openSession()
    val buffer = plugin.store.create(48000, retained = false, blockFrames = 1000)
    buffer.appendBytes(Base64.decode(base64Pcm(1000, 77), Base64.NO_WRAP), 0, 4000)
    plugin.enqueueBuffer(call("enqueueBuffer", "serial" to 1, "seq" to 1, "bufferId" to buffer.id.toInt(), "startFrame" to 200, "frames" to 300))
    pump()
    assertEquals(300L, host.output!!.frames)
    assertNull(plugin.store.get(buffer.id))
  }

  @Test
  fun `a buffer that no longer exists is skipped, so the segments after it still play`() {
    openSession()
    plugin.enqueueBuffer(call("enqueueBuffer", "serial" to 1, "seq" to 1, "bufferId" to 999, "startFrame" to 0, "frames" to 10))
    assertTrue(JSObject(results.last().first.toString()).getBoolean("missing"))
    plugin.enqueuePcm(call("enqueuePcm", "serial" to 1, "seq" to 2, "data" to base64Pcm(50, 9)))
    pump()
    assertEquals(50L, host.output!!.frames)
  }

  @Test
  fun `a flush takes its place in the stream and drops what was sent before it`() {
    openSession()
    plugin.enqueuePcm(call("enqueuePcm", "serial" to 1, "seq" to 1, "data" to base64Pcm(10, 1)))
    pump()
    plugin.flush(call("flush", "serial" to 1, "seq" to 3))
    plugin.enqueuePcm(call("enqueuePcm", "serial" to 1, "seq" to 2, "data" to base64Pcm(10, 2)))
    plugin.enqueuePcm(call("enqueuePcm", "serial" to 1, "seq" to 4, "data" to base64Pcm(10, 4)))
    pump()
    assertEquals(1, host.output!!.flushes)
    assertEquals(20L, host.output!!.frames)
    assertEquals(4, host.output!!.samples.last().toInt())
  }

  @Test
  fun `rejects calls that leave out what they need, by name`() {
    plugin.enqueuePcm(call("enqueuePcm", "serial" to 1, "data" to ""))
    assertEquals("seq is required", lastError())
    plugin.enqueueBuffer(call("enqueueBuffer", "serial" to 1, "seq" to 1))
    assertEquals("bufferId is required", lastError())
    plugin.openSession(call("openSession"))
    assertEquals("serial is required", lastError())
    plugin.render(call("render", "renderer" to 5, "seconds" to 0.5))
    assertTrue(lastError()!!.contains("Unknown libSidplayEZ renderer"))
  }

  @Test
  fun `reports a session's stats once the feed has published them`() {
    openSession()
    plugin.enqueuePcm(call("enqueuePcm", "serial" to 1, "seq" to 1, "data" to base64Pcm(480, 5)))
    pump()
    plugin.stats(call("stats", "serial" to 1))
    val stats = JSObject(results.last().first.toString())
    assertTrue(stats.getBoolean("known"))
    assertEquals(480, stats.getInt("writtenFrames"))
    plugin.stats(call("stats", "serial" to 42))
    assertTrue(!JSObject(results.last().first.toString()).getBoolean("known"))
  }

  @Test
  fun `releases buffers by id, whatever width the ids arrive in`() {
    val a = plugin.store.create(48000, retained = true)
    val b = plugin.store.create(48000, retained = true)
    plugin.releaseBuffers(call("releaseBuffers", "bufferIds" to JSONArray(listOf(a.id.toInt(), b.id))))
    assertNull(plugin.store.get(a.id))
    assertNull(plugin.store.get(b.id))
    assertNotNull(results.last().first)
  }
}
