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
import java.util.concurrent.ThreadPoolExecutor
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
  fun nativeExecutorMatchesMaximumJsFtpConcurrency() {
    val plugin = FtpClientPlugin()
    val field = FtpClientPlugin::class.java.getDeclaredField("executor")
    field.isAccessible = true
    val executor = field.get(plugin) as ThreadPoolExecutor

    assertEquals(3, executor.maximumPoolSize)
  }

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
  fun writeFileRejectsMissingPath() {
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

    plugin.writeFile(call)

    assertTrue(latch.await(2, TimeUnit.SECONDS))
  }

  @Test
  fun writeFileRejectsMissingData() {
    val plugin = FtpClientPlugin()
    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getString("path")).thenReturn("/Temp/demo.reu")
    `when`(call.getString("data")).thenReturn(null)
    val latch = CountDownLatch(1)
    doAnswer {
              latch.countDown()
              null
            }
            .`when`(call)
            .reject("data is required")

    plugin.writeFile(call)

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
  fun listDirectoryDoesNotCascadeToMlsdOrNlstOnTimeout() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }
    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    `when`(ftpClient.login("user", "secret")).thenReturn(true)
    `when`(ftpClient.isConnected).thenReturn(true)
    // A timeout on LIST means the firmware FTP data channel is buckling. The plugin
    // must fail fast and NOT open further MLSD/NLST PASV connections (those would
    // also time out and triple the connection churn that wedges the c64u firmware —
    // 1541ultimate issue #364).
    `when`(ftpClient.listFiles("/")).thenThrow(SocketTimeoutException("Read timed out"))

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(21)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("secret")
    `when`(call.getString("path")).thenReturn("/")

    val latch = CountDownLatch(1)
    doAnswer {
              latch.countDown()
              null
            }
            .`when`(call)
            .reject(any(String::class.java), any(Exception::class.java))

    plugin.listDirectory(call)

    assertTrue(latch.await(10, TimeUnit.SECONDS))
    verify(ftpClient, never()).mlistDir(any(String::class.java))
    verify(ftpClient, never()).listNames(any(String::class.java))
  }

  @Test
  fun listDirectoryRecursiveWalksTreeOnOneConnection() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }
    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    val music =
            FTPFile().apply {
              name = "music"
              type = FTPFile.DIRECTORY_TYPE
            }
    val rootSid = FTPFile().apply { name = "root.sid" }
    val childSid = FTPFile().apply { name = "song.sid" }
    `when`(ftpClient.login("user", "secret")).thenReturn(true)
    `when`(ftpClient.listFiles("/")).thenReturn(arrayOf(music, rootSid))
    `when`(ftpClient.listFiles("/music")).thenReturn(arrayOf(childSid))
    `when`(ftpClient.isConnected).thenReturn(true)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(21)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("secret")
    `when`(call.getString("path")).thenReturn("/")
    `when`(call.getInt("maxDepth")).thenReturn(8)
    `when`(call.getInt("maxEntries")).thenReturn(5000)

    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any())

    plugin.listDirectoryRecursive(call)

    verify(ftpClient).connect("127.0.0.1", 21)
    verify(ftpClient).disconnect()
    val entries = resolved?.getJSONArray("entries")
    assertEquals(2, entries?.length())
    val paths = buildList {
      for (idx in 0 until (entries?.length() ?: 0)) {
        add(entries?.getJSONObject(idx)?.getString("path"))
      }
    }
    assertTrue(paths.contains("/root.sid"))
    assertTrue(paths.contains("/music/song.sid"))
  }

  @Test
  fun listDirectoryRecursiveReportsCapsAsPartialFailures() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }
    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    val folder =
            FTPFile().apply {
              name = "folder"
              type = FTPFile.DIRECTORY_TYPE
            }
    val rootSid = FTPFile().apply { name = "root.sid" }
    `when`(ftpClient.login("user", "secret")).thenReturn(true)
    `when`(ftpClient.listFiles("/")).thenReturn(arrayOf(folder, rootSid))
    `when`(ftpClient.isConnected).thenReturn(true)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(21)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("secret")
    `when`(call.getString("path")).thenReturn("/")
    `when`(call.getInt("maxDepth")).thenReturn(0)
    `when`(call.getInt("maxEntries")).thenReturn(1)

    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any())

    plugin.listDirectoryRecursive(call)

    val failures = resolved?.getJSONArray("partialFailures")
    assertNotNull(failures)
    val messages = buildList {
      for (idx in 0 until (failures?.length() ?: 0)) {
        add(failures?.getJSONObject(idx)?.getString("message"))
      }
    }
    assertTrue(messages.any { it?.contains("max depth 0") == true })
    assertTrue(messages.any { it?.contains("stopped after 1 entries") == true })
  }

  @Test
  fun listDirectoryRecursiveReportsTimedOutOnDataChannelTimeout() {
    // Regression (HARD9-078): the response field was "timed_out" (snake_case)
    // while the JS side reads/declares nothing but camelCase fields, so this
    // "the walk aborted early" signal was never actually surfaced anywhere.
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }
    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    `when`(ftpClient.login("user", "secret")).thenReturn(true)
    `when`(ftpClient.listFiles("/")).thenThrow(SocketTimeoutException("data channel timed out"))
    `when`(ftpClient.isConnected).thenReturn(true)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(21)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("secret")
    `when`(call.getString("path")).thenReturn("/")
    `when`(call.getInt("maxDepth")).thenReturn(8)
    `when`(call.getInt("maxEntries")).thenReturn(5000)

    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any())

    plugin.listDirectoryRecursive(call)

    assertEquals(true, resolved?.getBoolean("timedOut"))
    val failures = resolved?.getJSONArray("partialFailures")
    assertNotNull(failures)
    assertEquals(1, failures?.length())
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
    `when`(ftpClient.retrieveFileStream(eq("/songlengths.md5")))
            .thenReturn(java.io.ByteArrayInputStream(payload.toByteArray(Charsets.UTF_8)))
    `when`(ftpClient.completePendingCommand()).thenReturn(true)
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
  fun cancelReadAfterCompletionDoesNotSpuriouslyAbortAReusedRequestId() {
    // Regression (HARD9-073): a cancelRead() arriving after readFile()
    // already finished (routine when it races natural completion on
    // navigate-away) used to re-add the requestId to cancelledReads with
    // nothing left to ever remove it - so a later read reusing that same
    // requestId (the JS-side counter resets on WebView reload while this
    // plugin instance survives) instantly and spuriously rejected.
    val payload = "HELLO"
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }
    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    `when`(ftpClient.login("user", "secret")).thenReturn(true)
    `when`(ftpClient.retrieveFileStream(eq("/songlengths.md5")))
            .thenReturn(java.io.ByteArrayInputStream(payload.toByteArray(Charsets.UTF_8)))
    `when`(ftpClient.completePendingCommand()).thenReturn(true)
    `when`(ftpClient.isConnected).thenReturn(true)

    val readCall = mock(PluginCall::class.java)
    `when`(readCall.getString("host")).thenReturn("127.0.0.1")
    `when`(readCall.getInt("port")).thenReturn(21)
    `when`(readCall.getString("username")).thenReturn("user")
    `when`(readCall.getString("password")).thenReturn("secret")
    `when`(readCall.getString("path")).thenReturn("/songlengths.md5")
    `when`(readCall.getString("requestId")).thenReturn("ftp-read-reused")

    // First read completes fully before any cancel arrives.
    plugin.readFile(readCall)
    verify(readCall).resolve(any())

    // A cancelRead for the same id arrives late, after completion.
    val cancelCall = mock(PluginCall::class.java)
    `when`(cancelCall.getString("requestId")).thenReturn("ftp-read-reused")
    plugin.cancelRead(cancelCall)
    verify(cancelCall).resolve()

    // The id is reused for a brand-new read; it must not be spuriously
    // rejected by the stale late-cancel mark.
    val reusedCall = mock(PluginCall::class.java)
    `when`(reusedCall.getString("host")).thenReturn("127.0.0.1")
    `when`(reusedCall.getInt("port")).thenReturn(21)
    `when`(reusedCall.getString("username")).thenReturn("user")
    `when`(reusedCall.getString("password")).thenReturn("secret")
    `when`(reusedCall.getString("path")).thenReturn("/songlengths.md5")
    `when`(reusedCall.getString("requestId")).thenReturn("ftp-read-reused")

    plugin.readFile(reusedCall)

    verify(reusedCall).resolve(any())
    verify(reusedCall, never()).reject(eq("FTP read aborted"))
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
    `when`(ftpClient.retrieveFileStream(eq("/missing.sid"))).thenReturn(null)
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
  fun writeFileStoresPayloadAndReturnsSize() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }

    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    `when`(ftpClient.login("user", "secret")).thenReturn(true)
    doAnswer { invocation ->
              val input = invocation.getArgument<java.io.InputStream>(1)
              val stored = input.readBytes().toString(Charsets.UTF_8)
              assertEquals("ABCD", stored)
              true
            }
            .`when`(ftpClient)
            .storeFile(eq("/Temp/demo.reu"), any())
    `when`(ftpClient.isConnected).thenReturn(true)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(21)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("secret")
    `when`(call.getString("path")).thenReturn("/Temp/demo.reu")
    `when`(call.getString("data")).thenReturn("QUJDRA==")

    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any())

    plugin.writeFile(call)

    verify(ftpClient).connect("127.0.0.1", 21)
    assertEquals(4, resolved?.optInt("sizeBytes", -1))
  }

  @Test
  fun writeFileRejectsOnLoginFailure() {
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
    `when`(call.getString("path")).thenReturn("/Temp/demo.reu")
    `when`(call.getString("data")).thenReturn("QUJDRA==")

    plugin.writeFile(call)

    verify(ftpClient).connect("127.0.0.1", 21)
    verify(call).reject("FTP login failed")
  }

  @Test
  fun writeFileUsesDefaultsAndRejectsWhenStoreFails() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }

    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    `when`(ftpClient.login("user", "")).thenReturn(true)
    `when`(ftpClient.storeFile(eq("/Temp/missing.reu"), any())).thenReturn(false)
    `when`(ftpClient.isConnected).thenReturn(true)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getString("path")).thenReturn("/Temp/missing.reu")
    `when`(call.getString("data")).thenReturn("QQ==")
    `when`(call.getInt("port")).thenReturn(null)
    `when`(call.getString("username")).thenReturn(null)
    `when`(call.getString("password")).thenReturn(null)

    plugin.writeFile(call)

    verify(ftpClient).connect("127.0.0.1", 21)
    verify(ftpClient).login("user", "")
    verify(call).reject("FTP file write failed")
  }

  @Test
  fun writeFileRejectsWithNormalizedTimeoutMessage() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }

    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    doAnswer { throw SocketTimeoutException("write timed out") }
            .`when`(ftpClient)
            .connect("127.0.0.1", 21)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getString("path")).thenReturn("/Temp/demo.reu")
    `when`(call.getString("data")).thenReturn("QQ==")
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

    plugin.writeFile(call)

    assertTrue((rejectedMessage ?: "").startsWith("FTP writeFile timed out after "))
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
    ordered.verify(ftpClient).setConnectTimeout(1500)
    ordered.verify(ftpClient).setDefaultTimeout(1500)
    ordered.verify(ftpClient).connect("127.0.0.1", 21)
    ordered.verify(ftpClient).setSoTimeout(4321)
  }

  @Test
  fun listDirectoryEnablesUtf8AutodetectionBeforeConnecting() {
    // Regression (HARD9-070): commons-net defaults to ISO-8859-1 on the
    // control channel with no UTF-8 autodetection - a USB stick with
    // non-ASCII filenames lists as mojibake and a subsequent RETR of the
    // re-encoded name 550s. autodetectUTF8 must be set before connect().
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }

    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    `when`(ftpClient.login("user", "secret")).thenReturn(true)
    `when`(ftpClient.listFiles("/")).thenReturn(emptyArray())

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(21)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("secret")
    `when`(call.getString("path")).thenReturn("/")

    plugin.listDirectory(call)

    val ordered = inOrder(ftpClient)
    ordered.verify(ftpClient).setAutodetectUTF8(true)
    ordered.verify(ftpClient).connect("127.0.0.1", 21)
  }

  @Test
  fun listDirectoryAppliesConfiguredConnectTimeoutSeparatelyFromTransferTimeout() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }

    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    `when`(ftpClient.login("user", "secret")).thenReturn(true)
    `when`(ftpClient.listFiles("/")).thenReturn(emptyArray())

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(21)
    `when`(call.getInt("connectTimeoutMs")).thenReturn(1200)
    `when`(call.getInt("timeoutMs")).thenReturn(4321)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("secret")
    `when`(call.getString("path")).thenReturn("/")

    plugin.listDirectory(call)

    val ordered = inOrder(ftpClient)
    ordered.verify(ftpClient).setConnectTimeout(1200)
    ordered.verify(ftpClient).setDefaultTimeout(1200)
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
                    1500,
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
  fun cancelReadRejectsMissingRequestId() {
    val plugin = FtpClientPlugin()
    val call = mock(PluginCall::class.java)
    `when`(call.getString("requestId")).thenReturn(null)

    plugin.cancelRead(call)

    verify(call).reject("requestId is required")
  }

  @Test
  fun cancelReadResolvesForKnownRequestId() {
    val plugin = FtpClientPlugin()
    val call = mock(PluginCall::class.java)
    `when`(call.getString("requestId")).thenReturn("ftp-read-7")

    plugin.cancelRead(call)

    verify(call).resolve()
  }

  @Test
  fun readFileWithZeroTimeoutDisablesIdleSocketTimeout() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }
    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    `when`(ftpClient.login("user", "")).thenReturn(true)
    `when`(ftpClient.retrieveFileStream(eq("/songlengths.md5")))
            .thenReturn(java.io.ByteArrayInputStream(ByteArray(0)))
    `when`(ftpClient.completePendingCommand()).thenReturn(true)
    `when`(ftpClient.isConnected).thenReturn(true)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getString("path")).thenReturn("/songlengths.md5")
    `when`(call.getInt("port")).thenReturn(21)
    // timeoutMs == 0 means "no idle timeout" for a slow multi-MB songlengths read.
    `when`(call.getInt("timeoutMs")).thenReturn(0)

    plugin.readFile(call)

    verify(ftpClient).soTimeout = 0
    verify(ftpClient).completePendingCommand()
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
  fun resolveListingReturnsEmptyArrayDirectlyWhenListFilesReturnsEmptyArray() {
    // Regression: empty array from listFiles means directory is empty — must NOT fall through to MLSD
    val plugin = FtpClientPlugin()
    val method =
            FtpClientPlugin::class.java.getDeclaredMethod(
                    "resolveListing",
                    FTPClient::class.java,
                    String::class.java,
            )
    method.isAccessible = true

    val ftpClient = mock(FTPClient::class.java)
    `when`(ftpClient.listFiles("/")).thenReturn(emptyArray())

    @Suppress("UNCHECKED_CAST") val result = method.invoke(plugin, ftpClient, "/") as Array<FTPFile>

    assertEquals(0, result.size)
    verify(ftpClient, never()).mlistDir("/")
    verify(ftpClient, never()).listNames("/")
  }

  @Test
  fun resolveListingFallsBackToMlistWhenListReturnsNull() {
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
    `when`(ftpClient.listFiles("/")).thenReturn(null)
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

  @Test
  fun resolveListingFallsBackToNlstWhenListAndMlistAreEmpty() {
    val plugin = FtpClientPlugin()
    val method =
            FtpClientPlugin::class.java.getDeclaredMethod(
                    "resolveListing",
                    FTPClient::class.java,
                    String::class.java,
            )
    method.isAccessible = true

    val ftpClient = mock(FTPClient::class.java)
    `when`(ftpClient.listFiles("/")).thenReturn(null)
    `when`(ftpClient.mlistDir("/")).thenReturn(emptyArray())
    `when`(ftpClient.listNames("/")).thenReturn(arrayOf("USB2", "demo.sid"))
    `when`(ftpClient.mlistFile("/USB2"))
            .thenReturn(
                    FTPFile().apply {
                      name = "USB2"
                      type = FTPFile.DIRECTORY_TYPE
                    }
            )
    `when`(ftpClient.mlistFile("/demo.sid"))
            .thenReturn(
                    FTPFile().apply {
                      name = "demo.sid"
                      type = FTPFile.FILE_TYPE
                    }
            )

    @Suppress("UNCHECKED_CAST") val result = method.invoke(plugin, ftpClient, "/") as Array<FTPFile>

    assertEquals(2, result.size)
    assertEquals("USB2", result[0].name)
    assertTrue(result[0].isDirectory)
    assertEquals("demo.sid", result[1].name)
    assertTrue(result[1].isFile)
    verify(ftpClient).listNames("/")
  }

  @Test
  fun resolveListingSynthesizesFilesWithoutCwdProbeWhenNlstMetadataMissing() {
    val plugin = FtpClientPlugin()
    val method =
            FtpClientPlugin::class.java.getDeclaredMethod(
                    "resolveListing",
                    FTPClient::class.java,
                    String::class.java,
            )
    method.isAccessible = true

    val ftpClient = mock(FTPClient::class.java)
    `when`(ftpClient.listFiles("/")).thenReturn(null)
    `when`(ftpClient.mlistDir("/")).thenReturn(emptyArray())
    `when`(ftpClient.listNames("/")).thenReturn(arrayOf("USB2", "demo.sid"))
    `when`(ftpClient.mlistFile("/USB2")).thenReturn(null)
    `when`(ftpClient.mlistFile("/demo.sid")).thenReturn(null)

    @Suppress("UNCHECKED_CAST") val result = method.invoke(plugin, ftpClient, "/") as Array<FTPFile>

    assertEquals(2, result.size)
    assertEquals("USB2", result[0].name)
    assertTrue(result[0].isFile)
    assertEquals("demo.sid", result[1].name)
    assertTrue(result[1].isFile)
    verify(ftpClient, never()).printWorkingDirectory()
    verify(ftpClient, never()).changeWorkingDirectory(any(String::class.java))
  }

  @Test
  fun resolveListingCapsNlstMetadataProbes() {
    val plugin = FtpClientPlugin()
    val method =
            FtpClientPlugin::class.java.getDeclaredMethod(
                    "resolveListing",
                    FTPClient::class.java,
                    String::class.java,
            )
    method.isAccessible = true

    val ftpClient = mock(FTPClient::class.java)
    val names = (1..70).map { "file-$it.sid" }.toTypedArray()
    `when`(ftpClient.listFiles("/")).thenReturn(null)
    `when`(ftpClient.mlistDir("/")).thenReturn(emptyArray())
    `when`(ftpClient.listNames("/")).thenReturn(names)

    @Suppress("UNCHECKED_CAST") val result = method.invoke(plugin, ftpClient, "/") as Array<FTPFile>

    assertEquals(64, result.size)
    verify(ftpClient, never()).mlistFile("/file-65.sid")
    verify(ftpClient, never()).changeWorkingDirectory(any(String::class.java))
  }

  // pingFtp tests — verifies control-channel-only probe (no PASV / no data channel)

  @Test
  fun pingFtpRejectsMissingHost() {
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

    plugin.pingFtp(call)

    assertTrue(latch.await(2, TimeUnit.SECONDS))
  }

  @Test
  fun pingFtpSucceedsWithoutOpeningDataChannel() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }
    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    `when`(ftpClient.login("user", "")).thenReturn(true)
    `when`(ftpClient.isConnected).thenReturn(true)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(21)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("")

    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any())

    plugin.pingFtp(call)

    verify(ftpClient).connect("127.0.0.1", 21)
    verify(ftpClient).login("user", "")
    verify(ftpClient).sendNoOp()
    // No PASV data channel must be opened
    verify(ftpClient, never()).enterLocalPassiveMode()
    verify(ftpClient, never()).listFiles(any(String::class.java))
    verify(ftpClient, never()).mlistDir(any(String::class.java))
    assertEquals(true, resolved?.getBool("ok"))
  }

  @Test
  fun pingFtpRejectsOnLoginFailure() {
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

    plugin.pingFtp(call)

    verify(ftpClient).connect("127.0.0.1", 21)
    verify(call).reject("FTP ping login failed")
    verify(ftpClient, never()).enterLocalPassiveMode()
  }

  @Test
  fun pingFtpUsesDefaultSettingsAndWarnsWhenDisconnectFails() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }
    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    `when`(ftpClient.login("user", "")).thenReturn(true)
    `when`(ftpClient.isConnected).thenReturn(true)
    doAnswer { throw RuntimeException("disconnect exploded") }.`when`(ftpClient).disconnect()

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(null)
    `when`(call.getString("username")).thenReturn(null)
    `when`(call.getString("password")).thenReturn(null)

    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any())

    ShadowLog.clear()
    plugin.pingFtp(call)

    verify(ftpClient).connect("127.0.0.1", 21)
    verify(ftpClient).login("user", "")
    verify(ftpClient).sendNoOp()
    assertEquals(true, resolved?.getBool("ok"))
    val logs = ShadowLog.getLogsForTag("FtpClientPlugin")
    assertTrue(logs.any { it.msg?.contains("Failed to disconnect FTP ping client") == true })
  }

  @Test
  fun pingFtpRejectsWithConfiguredTimeoutMessage() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }
    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    `when`(ftpClient.connect(eq("127.0.0.1"), eq(21))).thenThrow(SocketTimeoutException("timed out"))
    `when`(ftpClient.isConnected).thenReturn(false)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(null)
    `when`(call.getInt("connectTimeoutMs")).thenReturn(2500)

    plugin.pingFtp(call)

    verify(call).reject(eq("FTP pingFtp timed out after connect 2500ms / transfer 2500ms"), any(Exception::class.java))
  }

  @Test
  fun pingFtpRejectsOnConnectionError() {
    val plugin = FtpClientPlugin()
    plugin.runTask = { runnable -> runnable.run() }
    val ftpClient = mock(FTPClient::class.java)
    plugin.ftpClientFactory = { ftpClient }

    `when`(ftpClient.connect(eq("127.0.0.1"), eq(21))).thenThrow(RuntimeException("refused"))
    `when`(ftpClient.isConnected).thenReturn(false)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("host")).thenReturn("127.0.0.1")
    `when`(call.getInt("port")).thenReturn(21)
    `when`(call.getString("username")).thenReturn("user")
    `when`(call.getString("password")).thenReturn("")

    plugin.pingFtp(call)

    verify(call).reject(any(String::class.java), any(Exception::class.java))
  }
}
