/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import com.getcapacitor.Bridge
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class StreamUdpPluginTest {
  private lateinit var plugin: StreamUdpPlugin
  private lateinit var context: Context
  private val received = ArrayList<Pair<String, String>>()
  private lateinit var latch: CountDownLatch

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    plugin = StreamUdpPlugin()
    injectBridge(plugin, context)
    received.clear()
    latch = CountDownLatch(1)
    plugin.emitDatagram = { name, data ->
      received.add(name to data)
      latch.countDown()
    }
  }

  @Test
  fun bindRejectsMissingName() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("name")).thenReturn(null)
    plugin.bind(call)
    verify(call).reject("name is required")
  }

  @Test
  fun bindRejectsMissingPort() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("name")).thenReturn("video")
    `when`(call.getInt("port")).thenReturn(null)
    plugin.bind(call)
    verify(call).reject("port is required")
  }

  @Test
  fun bindBindsAPortAndForwardsAReceivedDatagram() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("name")).thenReturn("video")
    `when`(call.getInt("port")).thenReturn(0) // ephemeral
    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any())

    plugin.bind(call)
    verify(call).resolve(any())
    assertNotNull(resolved)
    val port = resolved!!.getInteger("port")!!
    assertTrue("expected an OS-assigned port", port > 0)

    // Send a datagram to the bound port; the plugin must forward it base64-encoded.
    val payload = byteArrayOf(0x01, 0x08, 0x0c, 0x7f)
    DatagramSocket().use { sender ->
      sender.send(DatagramPacket(payload, payload.size, InetAddress.getByName("127.0.0.1"), port))
    }

    assertTrue("no datagram received", latch.await(3, TimeUnit.SECONDS))
    assertEquals(1, received.size)
    assertEquals("video", received[0].first)
    assertEquals(Base64.encodeToString(payload, Base64.NO_WRAP), received[0].second)

    val closeCall = mock(PluginCall::class.java)
    `when`(closeCall.getString("name")).thenReturn("video")
    plugin.close(closeCall)
    verify(closeCall).resolve(any())
  }

  @Test
  fun closeRejectsMissingName() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("name")).thenReturn(null)
    plugin.close(call)
    verify(call).reject("name is required")
  }

  private fun injectBridge(target: Plugin, ctx: Context) {
    val bridge = mock(Bridge::class.java)
    `when`(bridge.context).thenReturn(ctx)
    val field = Plugin::class.java.getDeclaredField("bridge")
    field.isAccessible = true
    field.set(target, bridge)
  }
}
