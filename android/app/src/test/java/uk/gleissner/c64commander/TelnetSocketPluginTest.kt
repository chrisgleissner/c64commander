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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
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
import org.mockito.Mockito.doThrow
import org.mockito.Mockito.mock
import org.mockito.Mockito.times
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
    var connectResolved: JSObject? = null
    doAnswer { invocation ->
              connectResolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any())

    plugin.connect(call)

    verify(call).resolve(any())
    assertEquals(0, connectResolved?.length())
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
    var disconnectResolved: JSObject? = null
    doAnswer { invocation ->
              disconnectResolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(disconnectCall)
            .resolve(any())
    plugin.disconnect(disconnectCall)

    verify(disconnectCall).resolve(any())
    assertEquals(0, disconnectResolved?.length())

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
    var disconnectResolved: JSObject? = null
    doAnswer { invocation ->
              disconnectResolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(disconnectCall)
            .resolve(any())
    plugin.disconnect(disconnectCall)

    verify(disconnectCall).resolve(any())
    assertEquals(0, disconnectResolved?.length())
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
  fun disconnectEmitsEmptyObjectOnCaughtException() {
    val disconnectCall = mock(PluginCall::class.java)
    var disconnectResolved: JSObject? = null
    doThrow(RuntimeException("resolve failed"))
            .doAnswer { invocation: org.mockito.invocation.InvocationOnMock ->
              disconnectResolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(disconnectCall)
            .resolve(any())

    plugin.disconnect(disconnectCall)

    verify(disconnectCall, times(2)).resolve(any())
    assertEquals(0, disconnectResolved?.length())
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
    var sendResolved: JSObject? = null
    doAnswer { invocation ->
              sendResolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(sendCall)
            .resolve(any())

    plugin.send(sendCall)

    verify(sendCall).resolve(any())
    assertEquals(0, sendResolved?.length())
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
    // The SequencedInputStream's null tail throws SocketTimeoutException,
    // simulating an idle-but-live peer (data read, then timeout). A plain
    // TrackingInputStream would return -1 after the payload, which is EOF
    // (HARD20-006) and must reject — not the scenario this test exercises.
    val socket =
            FakeSocket(
                    input = SequencedInputStream(listOf("READY\r\n".toByteArray(), null))
            )
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
  fun readRejectsWithConnectionClosedOnImmediateEofAndMarksSocketDead() {
    // HARD20-006: read() == -1 is EOF (peer closed), not a benign empty
    // timeout read. The plugin must reject with a distinct connection-closed
    // message and close the socket so isConnected() reports false afterward.
    val socket = FakeSocket(input = TrackingInputStream(payload = byteArrayOf()))
    plugin.socketFactory = { socket }

    val connectCall = mock(PluginCall::class.java)
    `when`(connectCall.getString("host")).thenReturn("c64u")
    plugin.connect(connectCall)

    val readCall = mock(PluginCall::class.java)
    `when`(readCall.getInt("timeoutMs")).thenReturn(50)
    plugin.read(readCall)

    val messageCaptor = org.mockito.ArgumentCaptor.forClass(String::class.java)
    verify(readCall).reject(messageCaptor.capture(), any(Exception::class.java))
    assertTrue(
            "HARD20-006: EOF must reject with a distinct connection-closed message",
            messageCaptor.value?.contains("Connection closed", ignoreCase = true) == true,
    )

    val stateCall = mock(PluginCall::class.java)
    var state: JSObject? = null
    doAnswer { invocation ->
              state = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(stateCall)
            .resolve(any())
    plugin.isConnected(stateCall)

    assertFalse(
            "HARD20-006: isConnected must report false after EOF closes the socket",
            state?.getBool("connected") == true,
    )
  }

  @Test
  fun readRejectsWithConnectionClosedOnMidStreamEofAndMarksSocketDead() {
    // HARD20-006: EOF after a partial read must still surface as a closed
    // connection rather than returning a truncated payload silently. Uses a
    // ByteArrayInputStream so the -1 EOF at buffer exhaustion is the JDK's
    // own semantics, not a custom stream's.
    val socket =
            FakeSocket(
                    input = java.io.ByteArrayInputStream("PARTIAL\r\n".toByteArray()),
            )
    plugin.socketFactory = { socket }

    val connectCall = mock(PluginCall::class.java)
    `when`(connectCall.getString("host")).thenReturn("c64u")
    plugin.connect(connectCall)

    val readCall = mock(PluginCall::class.java)
    `when`(readCall.getInt("timeoutMs")).thenReturn(50)
    plugin.read(readCall)

    val messageCaptor = org.mockito.ArgumentCaptor.forClass(String::class.java)
    verify(readCall).reject(messageCaptor.capture(), any(Exception::class.java))
    assertTrue(
            "HARD20-006: mid-stream EOF must reject with a distinct connection-closed message",
            messageCaptor.value?.contains("Connection closed", ignoreCase = true) == true,
    )

    val stateCall = mock(PluginCall::class.java)
    var state: JSObject? = null
    doAnswer { invocation ->
              state = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(stateCall)
            .resolve(any())
    plugin.isConnected(stateCall)

    assertFalse(
            "HARD20-006: isConnected must report false after mid-stream EOF",
            state?.getBool("connected") == true,
    )
  }

  @Test
  fun readCoalescesSplitPayloadWithinRequestedTimeout() {
    val socket =
            FakeSocket(
                    input =
                            SequencedInputStream(
                                    listOf(
                                            "ULTIMATE ".toByteArray(),
                                            "64\r\n".toByteArray(),
                                            null,
                                    ),
                            ),
            )
    plugin.socketFactory = { socket }

    val connectCall = mock(PluginCall::class.java)
    `when`(connectCall.getString("host")).thenReturn("c64u")
    plugin.connect(connectCall)

    val readCall = mock(PluginCall::class.java)
    `when`(readCall.getInt("timeoutMs")).thenReturn(250)
    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(readCall)
            .resolve(any())

    plugin.read(readCall)

    val decoded = String(Base64.decode(resolved?.getString("data"), Base64.DEFAULT))
    assertEquals("ULTIMATE 64\r\n", decoded)
    assertEquals(250, socket.soTimeoutValue)
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

  @Test
  fun handleOnDestroyWaitsForInFlightTaskBeforeClosingSocket() {
    // Uses the plugin's REAL single-thread executor (does not override runTask)
    // so connect() genuinely runs on a separate thread, reproducing the actual
    // race handleOnDestroy() must avoid (HARD9-072): closing the socket from the
    // destroy thread while an in-flight task is still touching it.
    val realPlugin = TelnetSocketPlugin()
    injectBridge(realPlugin, context)

    val startedLatch = CountDownLatch(1)
    val released = AtomicBoolean(false)
    val socket = BlockingConnectSocket(startedLatch, released)
    realPlugin.socketFactory = { socket }

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("c64u")
    realPlugin.connect(call)

    assertTrue("connect() task did not start on the executor thread", startedLatch.await(1, TimeUnit.SECONDS))

    Thread {
              Thread.sleep(100)
              released.set(true)
            }
            .start()

    val destroyStartNs = System.nanoTime()
    invokeHandleOnDestroy(realPlugin)
    val destroyDurationMs = (System.nanoTime() - destroyStartNs) / 1_000_000

    // Proves handleOnDestroy genuinely waited for the in-flight task to finish
    // (~100ms) instead of returning immediately and racing closeSocket() against
    // it on a different thread.
    assertTrue(
            "Expected handleOnDestroy to wait for the in-flight task (waited ${destroyDurationMs}ms)",
            destroyDurationMs >= 90,
    )
  }

  private fun invokeHandleOnDestroy(target: TelnetSocketPlugin) {
    val method = TelnetSocketPlugin::class.java.getDeclaredMethod("handleOnDestroy")
    method.isAccessible = true
    method.invoke(target)
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

private class BlockingConnectSocket(
        private val startedLatch: CountDownLatch,
        private val released: AtomicBoolean,
) : Socket() {
  // Simulates a blocking socket call that does NOT respond to Thread.interrupt()
  // (matches real java.net.Socket I/O semantics - only closing the socket, or in
  // this case flipping `released`, unblocks it), so the test can prove
  // handleOnDestroy() actually waits rather than relying on shutdownNow()'s
  // interrupt to unblock it.
  override fun connect(endpoint: SocketAddress?, timeout: Int) {
    startedLatch.countDown()
    while (!released.get()) {
      try {
        Thread.sleep(5)
      } catch (_: InterruptedException) {
        // Ignored - a plain blocking Socket.connect() would not unwind here either.
      }
    }
  }

  override fun getInputStream(): InputStream = TrackingInputStream()

  override fun getOutputStream(): OutputStream = TrackingOutputStream()
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

private class SequencedInputStream(
        private val chunks: List<ByteArray?>,
        private val closeFailure: Exception? = null,
) : InputStream() {
  private var index = 0

  override fun read(): Int {
    throw UnsupportedOperationException("Single-byte reads are not used in this test")
  }

  override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
    if (index >= chunks.size) {
      throw SocketTimeoutException("timed out")
    }

    val chunk = chunks[index++] ?: throw SocketTimeoutException("timed out")
    val bytesToCopy = minOf(length, chunk.size)
    chunk.copyInto(buffer, destinationOffset = offset, startIndex = 0, endIndex = bytesToCopy)
    return bytesToCopy
  }

  override fun close() {
    closeFailure?.let { throw it }
  }
}
