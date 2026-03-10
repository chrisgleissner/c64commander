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
import java.net.SocketTimeoutException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.apache.commons.net.ftp.FTPClient
import org.apache.commons.net.ftp.FTPFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.eq
import org.mockito.Mockito.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.inOrder
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog

@RunWith(RobolectricTestRunner::class)
class FtpClientPluginTest {
  @get:Rule val tempFolder = TemporaryFolder()

  @Test
  fun listDirectoryRejectsMissingHost() {
    val plugin = FtpClientPlugin()
    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn(null)
    val latch = CountDownLatch(1)
    doAnswer {
              latch.countDown()
              null
            }
            .`when`(call)
            .reject("host is required")

    plugin.listDirectory(call)

    assertTrue(latch.await(2, TimeUnit.SECONDS))
  }

  @Test
  fun readFileRejectsMissingHost() {
    val plugin = FtpClientPlugin()
    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn(null)
    val latch = CountDownLatch(1)
    doAnswer {
              latch.countDown()
              null
            }
            .`when`(call)
            .reject("host is required")

    plugin.readFile(call)

    assertTrue(latch.await(2, TimeUnit.SECONDS))
  }

  @Test
  fun readFileRejectsMissingPath() {
    val plugin = FtpClientPlugin()
    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getString("path")).thenReturn(null)
    val latch = CountDownLatch(1)
    doAnswer {
              latch.countDown()
              null
            }
            .`when`(call)
            .reject("path is required")

    plugin.readFile(call)

    assertTrue(latch.await(2, TimeUnit.SECONDS))
  }

  @Test
  fun listDirectoryRejectsBlankHost() {
    val plugin = FtpClientPlugin()
    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("   ")
    val latch = CountDownLatch(1)
    doAnswer {
              latch.countDown()
              null
            }
            .`when`(call)
            .reject("host is required")

    plugin.listDirectory(call)

    assertTrue(latch.await(2, TimeUnit.SECONDS))
  }

  @Test
  fun listDirectoryRejectsOnLoginFailure() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }
    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    `when`(ftpClient.login("user", "wrong")).thenReturn(false)
    `when`(ftpClient.isConnected).thenReturn(true)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(21)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("wrong")

    plugin.listDirectory(call)

    verify(ftpClient).connect("127.0.0.1", 21)
    verify(call).reject("FTP login failed")
  }

  @Test
  fun listDirectoryRejectsOnExceptionAndCoversDefaults() {
    val plugin = FtpClientPlugin()
    val call = mock(PluginCall::class.java)

    `when`(call.getString("host")).thenReturn("127.0.0.1")

    // Force default branches:
    // port -> 21, username -> "user", password -> "", path -> "/"
    `when`(call.getInt("port")).thenReturn(null)
    `when`(call.getString("username")).thenReturn(null)
    `when`(call.getString("password")).thenReturn(null)
    `when`(call.getString("path")).thenReturn(null)

    val latch = CountDownLatch(1)
    doAnswer {
              latch.countDown()
              null
            }
            .`when`(call)
            .reject(any(String::class.java), any(Exception::class.java))

    ShadowLog.clear()
    plugin.listDirectory(call)

    assertTrue(latch.await(10, TimeUnit.SECONDS))
    val logs = ShadowLog.getLogsForTag("FtpClientPlugin")
    assertTrue(logs.any { it.msg?.contains("FTP listDirectory failed") == true })
  }

  @Test
  fun listDirectoryReturnsEntries() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }
    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    val demo =
            FTPFile().apply {
              name = "demo.sid"
              size = 3
            }
    val docs =
            FTPFile().apply {
              name = "docs"
              type = FTPFile.DIRECTORY_TYPE
            }
    `when`(ftpClient.login("user", "secret")).thenReturn(true)
    `when`(ftpClient.listFiles("/")).thenReturn(arrayOf(demo, docs))
    `when`(ftpClient.isConnected).thenReturn(true)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(21)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("secret")
    `when`(call.getString("path")).thenReturn("/")

    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any())

    plugin.listDirectory(call)
    verify(ftpClient).connect("127.0.0.1", 21)

    val entries = resolved?.getJSONArray("entries")
    assertNotNull(entries)
    val names = buildList {
      for (idx in 0 until (entries?.length() ?: 0)) {
        add(entries?.getJSONObject(idx)?.getString("name"))
      }
    }
    assertTrue(names.contains("demo.sid"))
    assertTrue(names.contains("docs"))
  }

  @Test
  fun listDirectorySkipsDotEntries() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }
    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    val dot = FTPFile().apply { name = "." }
    val dotdot = FTPFile().apply { name = ".." }
    val file = FTPFile().apply { name = "file.txt" }
    `when`(ftpClient.login("user", "secret")).thenReturn(true)
    `when`(ftpClient.listFiles("/")).thenReturn(arrayOf(dot, dotdot, file))
    `when`(ftpClient.isConnected).thenReturn(true)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(21)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("secret")
    `when`(call.getString("path")).thenReturn("/")

    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any())

    plugin.listDirectory(call)
    verify(ftpClient).connect("127.0.0.1", 21)

    val entries = resolved?.getJSONArray("entries")
    val names = buildList {
      for (idx in 0 until (entries?.length() ?: 0)) {
        add(entries?.getJSONObject(idx)?.getString("name"))
      }
    }
    assertTrue(names.none { it == "." || it == ".." })
  }

  @Test
  fun readFileReturnsPayloadMetadata() {
    val payload = "HELLO"
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }
    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    `when`(ftpClient.login("user", "secret")).thenReturn(true)
    doAnswer { invocation ->
              val output = invocation.getArgument<java.io.ByteArrayOutputStream>(1)
              output.write(payload.toByteArray(Charsets.UTF_8))
              true
            }
            .`when`(ftpClient)
            .retrieveFile(eq("/songlengths.md5"), any())
    `when`(ftpClient.isConnected).thenReturn(true)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(21)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("secret")
    `when`(call.getString("path")).thenReturn("/songlengths.md5")

    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any())

    plugin.readFile(call)
    verify(ftpClient).connect("127.0.0.1", 21)

    assertNotNull(resolved)
    val encoded = resolved?.optString("data", "") ?: ""
    if (encoded.isNotEmpty()) {
      val decoded = String(Base64.decode(encoded, Base64.DEFAULT), Charsets.UTF_8)
      assertEquals(payload, decoded)
    }
    val sizeValue = resolved?.optInt("sizeBytes", -1) ?: -1
    assertEquals(payload.toByteArray().size, sizeValue)
  }

  @Test
  fun readFileRejectsOnLoginFailure() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }
    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    `when`(ftpClient.login("user", "wrong")).thenReturn(false)
    `when`(ftpClient.isConnected).thenReturn(true)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(21)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("wrong")
    `when`(call.getString("path")).thenReturn("/demo.sid")

    plugin.readFile(call)

    verify(ftpClient).connect("127.0.0.1", 21)
    verify(call).reject("FTP login failed")
  }

  @Test
  fun listDirectoryUsesTraceContextOnException() {
    val plugin = FtpClientPlugin()
    val context = ApplicationProvider.getApplicationContext<Context>()
    val bridge = mock(Bridge::class.java)
    `when`(bridge.context).thenReturn(context)
    val field = Plugin::class.java.getDeclaredField("bridge")
    field.isAccessible = true
    field.set(plugin, bridge)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(2)
    val traceContext = JSObject()
    traceContext.put("correlationId", "corr-ftp")
    traceContext.put("trackInstanceId", 99)
    traceContext.put("playlistItemId", "pl-9")
    traceContext.put("sourceKind", "hvsc")
    traceContext.put("localAccessMode", "ftp")
    traceContext.put("lifecycleState", "playing")
    `when`(call.getObject("traceContext")).thenReturn(traceContext)

    val latch = CountDownLatch(1)
    doAnswer {
              latch.countDown()
              null
            }
            .`when`(call)
            .reject(any(String::class.java), any(Exception::class.java))

    plugin.listDirectory(call)
    assertTrue(latch.await(10, TimeUnit.SECONDS))
  }

  @Test
  fun listDirectoryHandlesNullNameAndDisconnectFailure() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }

    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    val nullNamed = FTPFile().apply { name = null }
    val valid =
            FTPFile().apply {
              name = "valid.sid"
              size = 123
            }
    `when`(ftpClient.login("user", "secret")).thenReturn(true)
    `when`(ftpClient.listFiles("/")).thenReturn(arrayOf(nullNamed, valid))
    `when`(ftpClient.isConnected).thenReturn(true)
    doAnswer { throw RuntimeException("disconnect failed") }.`when`(ftpClient).disconnect()

    val context = ApplicationProvider.getApplicationContext<Context>()
    val bridge = mock(Bridge::class.java)
    `when`(bridge.context).thenReturn(context)
    val bridgeField = Plugin::class.java.getDeclaredField("bridge")
    bridgeField.isAccessible = true
    bridgeField.set(plugin, bridge)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(21)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("secret")
    `when`(call.getString("path")).thenReturn("/")

    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any())

    plugin.listDirectory(call)

    verify(ftpClient).connect("127.0.0.1", 21)
    val entries = resolved?.getJSONArray("entries")
    assertEquals(1, entries?.length())
    assertEquals("valid.sid", entries?.getJSONObject(0)?.getString("name"))
  }

  @Test
  fun readFileUsesDefaultsAndRejectsWhenReadFails() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }

    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    `when`(ftpClient.login("user", "")).thenReturn(true)
    `when`(ftpClient.retrieveFile(eq("/missing.sid"), any())).thenReturn(false)
    `when`(ftpClient.isConnected).thenReturn(true)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getString("path")).thenReturn("/missing.sid")
    `when`(call.getInt("port")).thenReturn(null)
    `when`(call.getString("username")).thenReturn(null)
    `when`(call.getString("password")).thenReturn(null)

    plugin.readFile(call)

    verify(ftpClient).connect("127.0.0.1", 21)
    verify(ftpClient).login("user", "")
    verify(call).reject("FTP file read failed")
  }

  @Test
  fun readFileCoversTraceAndDisconnectWarningOnException() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }

    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    doAnswer { throw RuntimeException("connect failed") }
            .`when`(ftpClient)
            .connect(any(String::class.java), any(Int::class.java))
    `when`(ftpClient.isConnected).thenReturn(true)
    doAnswer { throw RuntimeException("disconnect failed") }.`when`(ftpClient).disconnect()

    val context = ApplicationProvider.getApplicationContext<Context>()
    val bridge = mock(Bridge::class.java)
    `when`(bridge.context).thenReturn(context)
    val bridgeField = Plugin::class.java.getDeclaredField("bridge")
    bridgeField.isAccessible = true
    bridgeField.set(plugin, bridge)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getString("path")).thenReturn("/x")
    val traceContext = JSObject()
    traceContext.put("correlationId", "corr-read")
    traceContext.put("trackInstanceId", 123)
    traceContext.put("playlistItemId", "p-22")
    traceContext.put("sourceKind", "hvsc")
    traceContext.put("localAccessMode", "ftp")
    traceContext.put("lifecycleState", "stopped")
    `when`(call.getObject("traceContext")).thenReturn(traceContext)

    plugin.readFile(call)

    verify(call).reject(any(String::class.java), any(Exception::class.java))
  }

  @Test
  fun listDirectoryAppliesConfiguredTimeouts() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }

    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    `when`(ftpClient.login("user", "secret")).thenReturn(true)
    `when`(ftpClient.listFiles("/")).thenReturn(emptyArray())

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(21)
    `when`(call.getInt("timeoutMs")).thenReturn(4321)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("secret")
    `when`(call.getString("path")).thenReturn("/")

    plugin.listDirectory(call)

    val ordered = inOrder(ftpClient)
    ordered.verify(ftpClient).setConnectTimeout(4321)
    ordered.verify(ftpClient).setDefaultTimeout(4321)
    ordered.verify(ftpClient).connect("127.0.0.1", 21)
    ordered.verify(ftpClient).setSoTimeout(4321)
  }

  @Test
  fun listDirectoryDoesNotMislabelSocketSetupFailureAsTimeout() {
    val plugin = FtpClientPlugin()
    val method =
            FtpClientPlugin::class.java.getDeclaredMethod(
                    "buildFailureMessage",
                    String::class.java,
                    Exception::class.java,
                    Int::class.javaPrimitiveType,
            )
    method.isAccessible = true

    val message =
            method.invoke(
                    plugin,
                    "listDirectory",
                    NullPointerException(
                            "Attempt to invoke virtual method 'void java.net.Socket.setSoTimeout(int)' on a null object reference"
                    ),
                    8000,
            ) as
                    String

    assertEquals(
            "Attempt to invoke virtual method 'void java.net.Socket.setSoTimeout(int)' on a null object reference",
            message,
    )
  }

  @Test
  fun readFileRejectsWithNormalizedTimeoutMessage() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }

    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    doAnswer { throw SocketTimeoutException("connect timed out") }
            .`when`(ftpClient)
            .connect("127.0.0.1", 21)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getString("path")).thenReturn("/demo.sid")
    `when`(call.getInt("port")).thenReturn(21)
    `when`(call.getInt("timeoutMs")).thenReturn(2500)

    var rejectedMessage: String? = null
    doAnswer { invocation ->
              rejectedMessage = invocation.getArgument(0)
              null
            }
            .`when`(call)
            .reject(any(String::class.java))
    doAnswer { invocation ->
              rejectedMessage = invocation.getArgument(0)
              null
            }
            .`when`(call)
            .reject(any(String::class.java), any(Exception::class.java))

    plugin.readFile(call)

    assertTrue((rejectedMessage ?: "").startsWith("FTP readFile timed out after "))
  }

  @Test
  fun buildPathHandlesTrailingSlash() {
    val plugin = FtpClientPlugin()
    val method =
            FtpClientPlugin::class.java.getDeclaredMethod(
                    "buildPath",
                    String::class.java,
                    String::class.java,
            )
    method.isAccessible = true

    val result = method.invoke(plugin, "/folder/", "file.txt") as String
    assertEquals("/folder/file.txt", result)
  }

  @Test
  fun buildPathHandlesBlankBase() {
    val plugin = FtpClientPlugin()
    val method =
            FtpClientPlugin::class.java.getDeclaredMethod(
                    "buildPath",
                    String::class.java,
                    String::class.java,
            )
    method.isAccessible = true

    val result = method.invoke(plugin, "", "file.txt") as String
    assertEquals("/file.txt", result)
  }

  @Test
  fun resolveListingUsesListWhenAvailable() {
    val plugin = FtpClientPlugin()
    val method =
            FtpClientPlugin::class.java.getDeclaredMethod(
                    "resolveListing",
                    FTPClient::class.java,
                    String::class.java,
            )
    method.isAccessible = true

    val ftpClient = mock(FTPClient::class.java)
    val listedFile = FTPFile().apply { name = "listed.txt" }
    `when`(ftpClient.listFiles("/")).thenReturn(arrayOf(listedFile))

    @Suppress("UNCHECKED_CAST") val result = method.invoke(plugin, ftpClient, "/") as Array<FTPFile>

    assertEquals(1, result.size)
    assertEquals("listed.txt", result[0].name)
    verify(ftpClient, never()).mlistDir("/")
  }

  @Test
  fun resolveListingFallsBackToMlistWhenListEmpty() {
    val plugin = FtpClientPlugin()
    val method =
            FtpClientPlugin::class.java.getDeclaredMethod(
                    "resolveListing",
                    FTPClient::class.java,
                    String::class.java,
            )
    method.isAccessible = true

    val ftpClient = mock(FTPClient::class.java)
    val listedFile = FTPFile().apply { name = "mlist.txt" }
    `when`(ftpClient.listFiles("/")).thenReturn(emptyArray())
    `when`(ftpClient.mlistDir("/")).thenReturn(arrayOf(listedFile))

    @Suppress("UNCHECKED_CAST") val result = method.invoke(plugin, ftpClient, "/") as Array<FTPFile>

    assertEquals(1, result.size)
    assertEquals("mlist.txt", result[0].name)
    verify(ftpClient).mlistDir("/")
  }

  @Test
  fun resolveListingFallsBackToMlistOnListException() {
    val plugin = FtpClientPlugin()
    val method =
            FtpClientPlugin::class.java.getDeclaredMethod(
                    "resolveListing",
                    FTPClient::class.java,
                    String::class.java,
            )
    method.isAccessible = true

    val ftpClient = mock(FTPClient::class.java)
    val listedFile = FTPFile().apply { name = "fallback.txt" }
    `when`(ftpClient.listFiles("/")).thenThrow(RuntimeException("boom"))
    `when`(ftpClient.mlistDir("/")).thenReturn(arrayOf(listedFile))

    @Suppress("UNCHECKED_CAST") val result = method.invoke(plugin, ftpClient, "/") as Array<FTPFile>

    assertEquals(1, result.size)
    assertEquals("fallback.txt", result[0].name)
    verify(ftpClient).mlistDir("/")
  }
}
