package uk.gleissner.c64commander

import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.apache.commons.net.ftp.FTPClient
import org.apache.commons.net.ftp.FTPFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.mockito.Mockito.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

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

    plugin.listDirectory(call)

    assertTrue(latch.await(3, TimeUnit.SECONDS))
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
