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
import java.net.ConnectException
import java.net.InetAddress
import org.apache.commons.net.ftp.FTPClient
import org.apache.commons.net.ftp.FTPFile
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.anyInt
import org.mockito.ArgumentMatchers.eq
import org.mockito.Mockito.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.doThrow
import org.mockito.Mockito.inOrder
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class FtpDualHomedConnectTest {
  private val ethernetAddress = InetAddress.getByAddress(byteArrayOf(192.toByte(), 0, 2, 10))
  private val wifiAddress = InetAddress.getByAddress(byteArrayOf(198.toByte(), 51, 100, 20))

  private fun pluginResolving(vararg addresses: InetAddress): Pair<FtpClientPlugin, FTPClient> {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }
    plugin.hostResolver = HostAddressResolver { host ->
      assertEquals("ultimate.example", host)
      addresses.toList()
    }
    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }
    `when`(ftpClient.login("user", "")).thenReturn(true)
    `when`(ftpClient.isConnected).thenReturn(true)
    return plugin to ftpClient
  }

  private fun callFor(host: String): Pair<PluginCall, () -> JSObject?> {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn(host)
    `when`(call.getInt("port")).thenReturn(21)
    `when`(call.getInt("connectTimeoutMs")).thenReturn(1_500)
    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any())
    return call to { resolved }
  }

  @Test
  fun listDirectoryConnectsThroughTheNextResolvedAddressWhenTheFirstRefuses() {
    val (plugin, ftpClient) = pluginResolving(wifiAddress, ethernetAddress)
    doThrow(ConnectException("Connection refused")).`when`(ftpClient).connect(wifiAddress, 21)
    `when`(ftpClient.listFiles("/"))
            .thenReturn(
                    arrayOf(
                            FTPFile().apply {
                              name = "games"
                              type = FTPFile.DIRECTORY_TYPE
                            },
                    ),
            )
    val (call, resolved) = callFor("ultimate.example")

    plugin.listDirectory(call)

    val order = inOrder(ftpClient)
    order.verify(ftpClient).connectTimeout = 750
    order.verify(ftpClient).connect(wifiAddress, 21)
    order.verify(ftpClient).disconnect()
    order.verify(ftpClient).connect(ethernetAddress, 21)
    order.verify(ftpClient).connectTimeout = 1_500
    verify(ftpClient, never()).connect(any<String>(), anyInt())
    assertEquals("games", resolved()?.getJSONArray("entries")?.getJSONObject(0)?.getString("name"))
  }

  @Test
  fun pingFtpConnectsThroughTheNextResolvedAddressWhenTheFirstRefuses() {
    val (plugin, ftpClient) = pluginResolving(wifiAddress, ethernetAddress)
    doThrow(ConnectException("Connection refused")).`when`(ftpClient).connect(wifiAddress, 21)
    val (call, resolved) = callFor("ultimate.example")

    plugin.pingFtp(call)

    verify(ftpClient).connect(ethernetAddress, 21)
    verify(ftpClient).sendNoOp()
    assertEquals(true, resolved()?.getBool("ok"))
  }

  @Test
  fun pingFtpRejectsWithTheLastFailureWhenEveryResolvedAddressRefuses() {
    val (plugin, ftpClient) = pluginResolving(wifiAddress, ethernetAddress)
    doThrow(ConnectException("first refused")).`when`(ftpClient).connect(wifiAddress, 21)
    doThrow(ConnectException("second refused")).`when`(ftpClient).connect(ethernetAddress, 21)
    val (call, _) = callFor("ultimate.example")

    plugin.pingFtp(call)

    verify(call).reject(eq("second refused"), any(Exception::class.java))
    verify(ftpClient, never()).login(any(String::class.java), any(String::class.java))
  }

  @Test
  fun aLiteralIpAddressIsConnectedAsGivenWithoutResolvingIt() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }
    plugin.hostResolver = HostAddressResolver { host -> throw AssertionError("resolved literal $host") }
    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }
    `when`(ftpClient.login("user", "")).thenReturn(true)
    val (call, _) = callFor("203.0.113.7")

    plugin.pingFtp(call)

    verify(ftpClient).connect("203.0.113.7", 21)
    verify(ftpClient, never()).connect(any(InetAddress::class.java), anyInt())
  }
}
