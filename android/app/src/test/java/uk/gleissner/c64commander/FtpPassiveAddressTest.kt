/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketException
import java.net.SocketTimeoutException
import org.apache.commons.net.ftp.FTPClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class FtpPassiveAddressTest {
  @Test
  fun aPasvReplyNamingAnotherAddressStillOpensTheDataConnectionToTheControlHost() {
    val previous = System.getProperty(FTPClient.FTP_IP_ADDRESS_FROM_PASV_RESPONSE)
    // Model a process where the library default trusts the 227 address, so only the plugin can hold the line.
    System.setProperty(FTPClient.FTP_IP_ADDRESS_FROM_PASV_RESPONSE, "true")
    try {
      PasvAdvertisingFtpServer(advertisedHost = "203.0.113.9").use { server ->
        val plugin = FtpClientPlugin()
        plugin.runTask = { runnable -> runnable.run() }
        val call = mock(PluginCall::class.java)
        `when`(call.getString("host")).thenReturn("127.0.0.1")
        `when`(call.getInt("port")).thenReturn(server.port)
        `when`(call.getInt("timeoutMs")).thenReturn(3_000)
        var resolved: JSObject? = null
        doAnswer { invocation ->
                  resolved = invocation.getArgument(0) as JSObject
                  null
                }
                .`when`(call)
                .resolve(any())

        plugin.listDirectory(call)

        assertTrue("the data connection must reach the control host", server.dataConnectionAccepted)
        assertEquals("games", resolved?.getJSONArray("entries")?.getJSONObject(0)?.getString("name"))
      }
    } finally {
      if (previous == null) {
        System.clearProperty(FTPClient.FTP_IP_ADDRESS_FROM_PASV_RESPONSE)
      } else {
        System.setProperty(FTPClient.FTP_IP_ADDRESS_FROM_PASV_RESPONSE, previous)
      }
    }
  }
}

/** Answers one FTP session on loopback and advertises [advertisedHost] in its 227 reply. */
private class PasvAdvertisingFtpServer(private val advertisedHost: String) : AutoCloseable {
  private val control = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
  private val passive = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
  val port: Int = control.localPort
  /* The passive listener exists only on loopback, so a connection here reached the control host. */
  @Volatile var dataConnectionAccepted = false
  private val thread = Thread(::serve, "pasv-advertising-ftp").apply { isDaemon = true }

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
            "SYST" -> reply("215 UNIX Type: L8")
            "PASV" -> {
              val address = advertisedHost.replace('.', ',')
              reply("227 Entering Passive Mode ($address,${passive.localPort / 256},${passive.localPort % 256})")
            }
            "LIST" -> sendListing(::reply)
            else -> reply("502 not implemented")
          }
        }
      }
    } catch (error: SocketException) {
      if (!control.isClosed) throw IllegalStateException("Fake FTP server failed", error)
    }
  }

  private fun sendListing(reply: (String) -> Unit) {
    passive.soTimeout = 3_000
    val data =
            try {
              passive.accept()
            } catch (error: SocketTimeoutException) {
              reply("425 no data connection: ${error.message}")
              return
            }
    reply("150 listing")
    data.use {
      dataConnectionAccepted = true
      it.getOutputStream().write("drwxr-xr-x   1 user     group           0 Jan  1 00:00 games\r\n".toByteArray())
    }
    reply("226 done")
  }

  override fun close() {
    control.close()
    passive.close()
    thread.join(2_000)
  }
}
