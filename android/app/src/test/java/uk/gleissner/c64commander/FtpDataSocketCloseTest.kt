/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import com.getcapacitor.PluginCall
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.SocketTimeoutException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.any
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class FtpDataSocketCloseTest {
  @Test
  fun aReadWhoseRetrReplyTimesOutClosesTheDataConnectionItAlreadyOpened() {
    SilentRetrFtpServer().use { server ->
      val plugin = FtpClientPlugin()
      plugin.runTask = { runnable -> runnable.run() }
      val call = mock(PluginCall::class.java)
      `when`(call.getString("host")).thenReturn("127.0.0.1")
      `when`(call.getString("path")).thenReturn("/USB0/tune.sid")
      `when`(call.getInt("port")).thenReturn(server.port)
      `when`(call.getInt("timeoutMs")).thenReturn(1_000)

      plugin.readFile(call)

      verify(call).reject(anyString(), any(Exception::class.java))
      assertTrue("the client must have opened the data connection", server.dataConnectionAccepted.await(5, TimeUnit.SECONDS))
      assertEquals("the client must close the data connection", true, server.dataClosedByClient(5_000))
    }
  }
}

/** Accepts the passive data connection for RETR, then never answers it on the control connection. */
private class SilentRetrFtpServer : AutoCloseable {
  private val control = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
  private val passive = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
  val port: Int = control.localPort
  val dataConnectionAccepted = CountDownLatch(1)
  @Volatile private var data: Socket? = null
  private val thread = Thread(::serve, "silent-retr-ftp").apply { isDaemon = true }

  init {
    thread.start()
  }

  private fun serve() {
    try {
      control.accept().use { socket ->
        val reader = socket.getInputStream().bufferedReader(Charsets.US_ASCII)
        val writer = socket.getOutputStream().bufferedWriter(Charsets.US_ASCII)
        fun reply(line: String) {
          writer.write(line + "\r\n")
          writer.flush()
        }
        reply("220 ready")
        while (true) {
          val line = reader.readLine() ?: break
          when (line.substringBefore(' ').uppercase()) {
            "USER" -> reply("331 password please")
            "PASS" -> reply("230 logged in")
            "TYPE" -> reply("200 type set")
            "PASV" -> reply("227 Entering Passive Mode (127,0,0,1,${passive.localPort / 256},${passive.localPort % 256})")
            "RETR" -> {
              passive.soTimeout = 3_000
              data = passive.accept()
              dataConnectionAccepted.countDown()
            }
            else -> reply("502 not implemented")
          }
        }
      }
    } catch (error: SocketException) {
      if (!control.isClosed) throw IllegalStateException("Fake FTP server failed", error)
    }
  }

  /** True once the client has closed its end of the data connection, false if it is still open after [timeoutMs]. */
  fun dataClosedByClient(timeoutMs: Int): Boolean {
    val socket = data ?: return false
    socket.soTimeout = timeoutMs
    return try {
      socket.getInputStream().read() == -1
    } catch (timeout: SocketTimeoutException) {
      false
    } catch (reset: SocketException) {
      true
    }
  }

  override fun close() {
    data?.close()
    control.close()
    passive.close()
    thread.join(2_000)
  }
}
