/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.Bridge
import org.apache.commons.net.ftp.FTPClient
import org.apache.commons.net.ftp.FTPFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.mockito.Mockito.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import org.mockito.ArgumentMatchers.eq
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import androidx.test.core.app.ApplicationProvider
import android.content.Context

@RunWith(RobolectricTestRunner::class)
class FtpClientPluginTest {
  @get:Rule
  val tempFolder = TemporaryFolder()

  @Test
  fun listDirectoryRejectsMissingHost() {
    val plugin = FtpClientPlugin()
    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn(null)
    val latch = CountDownLatch(1)
    doAnswer {
      latch.countDown()
      null
    }.`when`(call).reject("host is required")

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
    }.`when`(call).reject("host is required")

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
    }.`when`(call).reject("path is required")

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
    }.`when`(call).reject("host is required")

    plugin.listDirectory(call)

    assertTrue(latch.await(2, TimeUnit.SECONDS))
  }

  @Test
  fun listDirectoryRejectsOnLoginFailure() {
    val root = tempFolder.newFolder("ftp-root")

    val server = MockFtpServer(root, "secret")
    server.start()

    val plugin = FtpClientPlugin()
    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(server.port)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("wrong")

    val latch = CountDownLatch(1)
    doAnswer {
      latch.countDown()
      null
    }.`when`(call).reject("FTP login failed")

    plugin.listDirectory(call)

    assertTrue(latch.await(3, TimeUnit.SECONDS))
    server.stop()
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
    }.`when`(call).reject(any(String::class.java), any(Exception::class.java))

    ShadowLog.clear()
    plugin.listDirectory(call)

    assertTrue(latch.await(3, TimeUnit.SECONDS))
    val logs = ShadowLog.getLogsForTag("FtpClientPlugin")
    assertTrue(logs.any { it.msg?.contains("FTP listDirectory failed") == true })
  }

  @Test
  fun listDirectoryReturnsEntries() {
    val root = tempFolder.newFolder("ftp-root")
    File(root, "demo.sid").writeText("sid")
    File(root, "docs").mkdirs()

    val server = MockFtpServer(root, "secret")
    server.start()

    val plugin = FtpClientPlugin()
    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(server.port)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("secret")
    `when`(call.getString("path")).thenReturn("/")

    val latch = CountDownLatch(1)
    var resolved: JSObject? = null
    doAnswer { invocation ->
      resolved = invocation.getArgument(0) as JSObject
      latch.countDown()
      null
    }.`when`(call).resolve(any())

    plugin.listDirectory(call)
    assertTrue(latch.await(3, TimeUnit.SECONDS))

    val entries = resolved?.getJSONArray("entries")
    assertNotNull(entries)
    val names = buildList {
      for (idx in 0 until (entries?.length() ?: 0)) {
        add(entries?.getJSONObject(idx)?.getString("name"))
      }
    }
    assertTrue(names.contains("demo.sid"))
    assertTrue(names.contains("docs"))

    server.stop()
  }

  @Test
  fun listDirectorySkipsDotEntries() {
    val root = tempFolder.newFolder("ftp-root")
    File(root, "file.txt").writeText("x")

    val server = MockFtpServer(root, "secret")
    server.start()

    val plugin = FtpClientPlugin()
    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(server.port)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("secret")
    `when`(call.getString("path")).thenReturn("/")

    val latch = CountDownLatch(1)
    var resolved: JSObject? = null
    doAnswer { invocation ->
      resolved = invocation.getArgument(0) as JSObject
      latch.countDown()
      null
    }.`when`(call).resolve(any())

    plugin.listDirectory(call)
    assertTrue(latch.await(3, TimeUnit.SECONDS))

    val entries = resolved?.getJSONArray("entries")
    val names = buildList {
      for (idx in 0 until (entries?.length() ?: 0)) {
        add(entries?.getJSONObject(idx)?.getString("name"))
      }
    }
    assertTrue(names.none { it == "." || it == ".." })

    server.stop()
  }

  @Test
  fun readFileReturnsPayloadMetadata() {
    val root = tempFolder.newFolder("ftp-root-read")
    val payload = "HELLO"
    File(root, "songlengths.md5").writeText(payload)

    val server = MockFtpServer(root, "secret")
    server.start()

    val plugin = FtpClientPlugin()
    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(server.port)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("secret")
    `when`(call.getString("path")).thenReturn("/songlengths.md5")

    val latch = CountDownLatch(1)
    var resolved: JSObject? = null
    doAnswer { invocation ->
      resolved = invocation.getArgument(0) as JSObject
      latch.countDown()
      null
    }.`when`(call).resolve(any())

    plugin.readFile(call)
    assertTrue(latch.await(3, TimeUnit.SECONDS))

    assertNotNull(resolved)
    val encoded = resolved?.optString("data", "") ?: ""
    if (encoded.isNotEmpty()) {
      val decoded = String(Base64.decode(encoded, Base64.DEFAULT), Charsets.UTF_8)
      assertEquals(payload, decoded)
    }
    val sizeValue = resolved?.optInt("sizeBytes", -1) ?: -1
    assertEquals(payload.toByteArray().size, sizeValue)

    server.stop()
  }

  @Test
  fun readFileRejectsOnLoginFailure() {
    val root = tempFolder.newFolder("ftp-root-read-fail")
    File(root, "demo.sid").writeText("sid")

    val server = MockFtpServer(root, "secret")
    server.start()

    val plugin = FtpClientPlugin()
    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(server.port)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("wrong")
    `when`(call.getString("path")).thenReturn("/demo.sid")

    val latch = CountDownLatch(1)
    doAnswer {
      latch.countDown()
      null
    }.`when`(call).reject("FTP login failed")

    plugin.readFile(call)

    assertTrue(latch.await(3, TimeUnit.SECONDS))
    server.stop()
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
    }.`when`(call).reject(any(String::class.java), any(Exception::class.java))

    plugin.listDirectory(call)
    assertTrue(latch.await(3, TimeUnit.SECONDS))
  }

  @Test
  fun listDirectoryHandlesNullNameAndDisconnectFailure() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }

    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    val nullNamed = FTPFile().apply { name = null }
    val valid = FTPFile().apply {
      name = "valid.sid"
      size = 123
    }
    `when`(ftpClient.login("user", "secret")).thenReturn(true)
    `when`(ftpClient.mlistDir("/")).thenReturn(arrayOf(nullNamed, valid))
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
    }.`when`(call).resolve(any())

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

    doAnswer { throw RuntimeException("connect failed") }.`when`(ftpClient).connect(any(String::class.java), any(Int::class.java))
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
  fun buildPathHandlesTrailingSlash() {
    val plugin = FtpClientPlugin()
    val method = FtpClientPlugin::class.java.getDeclaredMethod(
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
    val method = FtpClientPlugin::class.java.getDeclaredMethod(
      "buildPath",
      String::class.java,
      String::class.java,
    )
    method.isAccessible = true

    val result = method.invoke(plugin, "", "file.txt") as String
    assertEquals("/file.txt", result)
  }

  @Test
  fun resolveListingUsesMlistWhenAvailable() {
    val plugin = FtpClientPlugin()
    val method = FtpClientPlugin::class.java.getDeclaredMethod(
      "resolveListing",
      FTPClient::class.java,
      String::class.java,
    )
    method.isAccessible = true

    val ftpClient = mock(FTPClient::class.java)
    val mlistFile = FTPFile().apply { name = "mlist.txt" }
    `when`(ftpClient.mlistDir("/")).thenReturn(arrayOf(mlistFile))

    @Suppress("UNCHECKED_CAST")
    val result = method.invoke(plugin, ftpClient, "/") as Array<FTPFile>

    assertEquals(1, result.size)
    assertEquals("mlist.txt", result[0].name)
    verify(ftpClient, never()).listFiles("/")
  }

  @Test
  fun resolveListingFallsBackWhenMlistEmpty() {
    val plugin = FtpClientPlugin()
    val method = FtpClientPlugin::class.java.getDeclaredMethod(
      "resolveListing",
      FTPClient::class.java,
      String::class.java,
    )
    method.isAccessible = true

    val ftpClient = mock(FTPClient::class.java)
    val listedFile = FTPFile().apply { name = "listed.txt" }
    `when`(ftpClient.mlistDir("/")).thenReturn(emptyArray())
    `when`(ftpClient.listFiles("/")).thenReturn(arrayOf(listedFile))

    @Suppress("UNCHECKED_CAST")
    val result = method.invoke(plugin, ftpClient, "/") as Array<FTPFile>

    assertEquals(1, result.size)
    assertEquals("listed.txt", result[0].name)
    verify(ftpClient).listFiles("/")
  }

  @Test
  fun resolveListingFallsBackToListFilesOnException() {
    val plugin = FtpClientPlugin()
    val method = FtpClientPlugin::class.java.getDeclaredMethod(
      "resolveListing",
      FTPClient::class.java,
      String::class.java,
    )
    method.isAccessible = true

    val ftpClient = mock(FTPClient::class.java)
    val listedFile = FTPFile().apply { name = "fallback.txt" }
    `when`(ftpClient.mlistDir("/")).thenThrow(RuntimeException("boom"))
    `when`(ftpClient.listFiles("/")).thenReturn(arrayOf(listedFile))

    @Suppress("UNCHECKED_CAST")
    val result = method.invoke(plugin, ftpClient, "/") as Array<FTPFile>

    assertEquals(1, result.size)
    assertEquals("fallback.txt", result[0].name)
    verify(ftpClient).listFiles("/")
  }
}
