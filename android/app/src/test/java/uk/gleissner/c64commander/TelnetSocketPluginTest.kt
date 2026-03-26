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
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketAddress
import java.net.SocketTimeoutException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog

@RunWith(RobolectricTestRunner::class)
class TelnetSocketPluginTest {
  private lateinit var plugin: TelnetSocketPlugin
  private lateinit var context: Context

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    plugin = TelnetSocketPlugin()
    plugin.runTask = { runnable -> runnable.run() }
    injectBridge(plugin, context)
    ShadowLog.clear()
  }

  @Test
  fun connectRejectsMissingHost() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("   ")

    plugin.connect(call)

    verify(call).reject("host is required")
  }

  @Test
  fun connectUsesDefaultsAndUpdatesConnectionState() {
    val socket = FakeSocket()
    plugin.socketFactory = { socket }

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("c64u")
    `when`(call.getInt("port")).thenReturn(null)
    `when`(call.getInt("timeoutMs")).thenReturn(null)

    plugin.connect(call)

    verify(call).resolve()
    assertEquals("c64u", socket.connectedHost)
    assertEquals(23, socket.connectedPort)
    assertEquals(5_000, socket.connectTimeoutMs)
    assertEquals(500, socket.soTimeoutValue)

    val stateCall = mock(PluginCall::class.java)
    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(stateCall)
            .resolve(any())

    plugin.isConnected(stateCall)

    assertTrue(resolved?.getBool("connected") == true)
  }

  @Test
  fun connectRejectsOnSocketFailureAndLogsError() {
    plugin.socketFactory = { FakeSocket(connectFailure = RuntimeException("boom")) }

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("c64u")
    `when`(call.getInt("port")).thenReturn(6400)
    `when`(call.getInt("timeoutMs")).thenReturn(250)

    plugin.connect(call)

    verify(call).reject(anyString(), any(Exception::class.java))
    assertTrue(
            ShadowLog.getLogsForTag("TelnetSocketPlugin").any {
              it.msg?.contains("Telnet connect failed: boom") == true
            },
    )
  }

  @Test
  fun disconnectClosesResourcesAndClearsConnectionState() {
    val socket = FakeSocket()
    plugin.socketFactory = { socket }

    val connectCall = mock(PluginCall::class.java)
    `when`(connectCall.getString("host")).thenReturn("c64u")
    plugin.connect(connectCall)

    val disconnectCall = mock(PluginCall::class.java)
    plugin.disconnect(disconnectCall)

    verify(disconnectCall).resolve()

    val stateCall = mock(PluginCall::class.java)
    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(stateCall)
            .resolve(any())

    plugin.isConnected(stateCall)

    assertFalse(resolved?.getBool("connected") == true)
    assertTrue(socket.closed)
  }

  @Test
  fun disconnectLogsCloseFailuresAndStillResolves() {
    val input = TrackingInputStream(closeFailure = RuntimeException("input close failed"))
    val output = TrackingOutputStream(closeFailure = RuntimeException("output close failed"))
    val socket =
            FakeSocket(
                    input = input,
                    output = output,
                    closeFailure = RuntimeException("socket close failed")
            )
    plugin.socketFactory = { socket }

    val connectCall = mock(PluginCall::class.java)
    `when`(connectCall.getString("host")).thenReturn("c64u")
    plugin.connect(connectCall)

    val disconnectCall = mock(PluginCall::class.java)
    plugin.disconnect(disconnectCall)

    verify(disconnectCall).resolve()
    val messages = ShadowLog.getLogsForTag("TelnetSocketPlugin").mapNotNull { it.msg }
    assertTrue(
            messages.any { it.contains("Failed to close Telnet input stream: input close failed") }
    )
    assertTrue(
            messages.any {
              it.contains("Failed to close Telnet output stream: output close failed")
            }
    )
    assertTrue(messages.any { it.contains("Failed to close Telnet socket: socket close failed") })
  }

  @Test
  fun sendRejectsMissingData() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("data")).thenReturn(null)

    plugin.send(call)

    verify(call).reject("data is required")
  }

  @Test
  fun sendRejectsWhenNotConnected() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("data"))
            .thenReturn(Base64.encodeToString("READY".toByteArray(), Base64.NO_WRAP))

    plugin.send(call)

    verify(call).reject("Not connected")
  }

  @Test
  fun sendWritesDecodedPayload() {
    val output = TrackingOutputStream()
    val socket = FakeSocket(output = output)
    plugin.socketFactory = { socket }

    val connectCall = mock(PluginCall::class.java)
    `when`(connectCall.getString("host")).thenReturn("c64u")
    plugin.connect(connectCall)

    val sendCall = mock(PluginCall::class.java)
    val payload = "HELLO".toByteArray()
    `when`(sendCall.getString("data")).thenReturn(Base64.encodeToString(payload, Base64.NO_WRAP))

    plugin.send(sendCall)

    verify(sendCall).resolve()
    assertArrayEquals(payload, output.writtenBytes())
    assertTrue(output.flushed)
  }

  @Test
  fun sendRejectsOnWriteFailureAndLogsError() {
    val socket =
            FakeSocket(
                    output = TrackingOutputStream(writeFailure = RuntimeException("write failed"))
            )
    plugin.socketFactory = { socket }

    val connectCall = mock(PluginCall::class.java)
    `when`(connectCall.getString("host")).thenReturn("c64u")
    plugin.connect(connectCall)

    val sendCall = mock(PluginCall::class.java)
    `when`(sendCall.getString("data"))
            .thenReturn(Base64.encodeToString("HELLO".toByteArray(), Base64.NO_WRAP))

    plugin.send(sendCall)

    verify(sendCall).reject(anyString(), any(Exception::class.java))
    assertTrue(
            ShadowLog.getLogsForTag("TelnetSocketPlugin").any {
              it.msg?.contains("Telnet send failed: write failed") == true
            },
    )
  }

  @Test
  fun readRejectsWhenNotConnected() {
    val call = mock(PluginCall::class.java)
    `when`(call.getInt("timeoutMs")).thenReturn(100)

    plugin.read(call)

    verify(call).reject("Not connected")
  }

  @Test
  fun readReturnsPayloadAndAppliesRequestedTimeout() {
    val socket = FakeSocket(input = TrackingInputStream(payload = "READY\r\n".toByteArray()))
    plugin.socketFactory = { socket }

    val connectCall = mock(PluginCall::class.java)
    `when`(connectCall.getString("host")).thenReturn("c64u")
    plugin.connect(connectCall)

    val readCall = mock(PluginCall::class.java)
    `when`(readCall.getInt("timeoutMs")).thenReturn(1_250)
    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(readCall)
            .resolve(any())

    plugin.read(readCall)

    val decoded = String(Base64.decode(resolved?.getString("data"), Base64.DEFAULT))
    assertEquals("READY\r\n", decoded)
    assertEquals(1_250, socket.soTimeoutValue)
  }

  @Test
  fun readReturnsEmptyPayloadOnSocketTimeout() {
    val socket =
            FakeSocket(
                    input = TrackingInputStream(readFailure = SocketTimeoutException("timed out"))
            )
    plugin.socketFactory = { socket }

    val connectCall = mock(PluginCall::class.java)
    `when`(connectCall.getString("host")).thenReturn("c64u")
    plugin.connect(connectCall)

    val readCall = mock(PluginCall::class.java)
    `when`(readCall.getInt("timeoutMs")).thenReturn(null)
    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(readCall)
            .resolve(any())

    plugin.read(readCall)

    assertEquals("", resolved?.getString("data"))
    assertEquals(500, socket.soTimeoutValue)
  }

  @Test
  fun readRejectsOnReadFailureAndLogsError() {
    val socket =
            FakeSocket(input = TrackingInputStream(readFailure = RuntimeException("read failed")))
    plugin.socketFactory = { socket }

    val connectCall = mock(PluginCall::class.java)
    `when`(connectCall.getString("host")).thenReturn("c64u")
    plugin.connect(connectCall)

    val readCall = mock(PluginCall::class.java)
    `when`(readCall.getInt("timeoutMs")).thenReturn(50)

    plugin.read(readCall)

    verify(readCall).reject(anyString(), any(Exception::class.java))
    assertTrue(
            ShadowLog.getLogsForTag("TelnetSocketPlugin").any {
              it.msg?.contains("Telnet read failed: read failed") == true
            },
    )
  }

  private fun injectBridge(target: Plugin, ctx: Context) {
    val bridge = mock(Bridge::class.java)
    `when`(bridge.context).thenReturn(ctx)
    val field = Plugin::class.java.getDeclaredField("bridge")
    field.isAccessible = true
    field.set(target, bridge)
  }
}

private class FakeSocket(
        private val input: InputStream = TrackingInputStream(),
        private val output: OutputStream = TrackingOutputStream(),
        private val connectFailure: Exception? = null,
        private val closeFailure: Exception? = null,
) : Socket() {
  var connectedHost: String? = null
  var connectedPort: Int? = null
  var connectTimeoutMs: Int? = null
  var soTimeoutValue: Int = 0
  var closed = false
  private var connected = false

  override fun connect(endpoint: SocketAddress?, timeout: Int) {
    connectFailure?.let { throw it }
    val address = endpoint as InetSocketAddress
    connectedHost = address.hostString
    connectedPort = address.port
    connectTimeoutMs = timeout
    connected = true
    closed = false
  }

  override fun getInputStream(): InputStream = input

  override fun getOutputStream(): OutputStream = output

  override fun setSoTimeout(timeout: Int) {
    soTimeoutValue = timeout
  }

  override fun getSoTimeout(): Int = soTimeoutValue

  override fun isConnected(): Boolean = connected

  override fun isClosed(): Boolean = closed

  override fun close() {
    closeFailure?.let { throw it }
    connected = false
    closed = true
  }
}

private class TrackingInputStream(
        private val payload: ByteArray = byteArrayOf(),
        private val readFailure: Exception? = null,
        private val closeFailure: Exception? = null,
) : InputStream() {
  private var index = 0

  override fun read(): Int {
    readFailure?.let { throw it }
    if (index >= payload.size) {
      return -1
    }
    return payload[index++].toInt() and 0xff
  }

  override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
    readFailure?.let { throw it }
    if (index >= payload.size) {
      return -1
    }
    val remaining = payload.size - index
    val bytesToCopy = minOf(length, remaining)
    payload.copyInto(
            buffer,
            destinationOffset = offset,
            startIndex = index,
            endIndex = index + bytesToCopy
    )
    index += bytesToCopy
    return bytesToCopy
  }

  override fun close() {
    closeFailure?.let { throw it }
  }
}

private class TrackingOutputStream(
        private val writeFailure: Exception? = null,
        private val closeFailure: Exception? = null,
) : OutputStream() {
  private val buffer = ArrayList<Byte>()
  var flushed = false

  override fun write(byteValue: Int) {
    writeFailure?.let { throw it }
    buffer.add(byteValue.toByte())
  }

  override fun write(bytes: ByteArray, offset: Int, length: Int) {
    writeFailure?.let { throw it }
    bytes.copyOfRange(offset, offset + length).forEach { buffer.add(it) }
  }

  override fun flush() {
    writeFailure?.let { throw it }
    flushed = true
  }

  override fun close() {
    closeFailure?.let { throw it }
  }

  fun writtenBytes(): ByteArray = buffer.toByteArray()
}
