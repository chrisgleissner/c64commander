/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import com.getcapacitor.PluginCall
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Bridge
import com.getcapacitor.Plugin
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.rules.TemporaryFolder
import org.mockito.Mockito.*
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
class FolderPickerPluginTest {
  private lateinit var plugin: FolderPickerPlugin

  @get:Rule
  val tempFolder = TemporaryFolder()

  @Before
  fun setUp() {
    plugin = FolderPickerPlugin()
  }

  @Test
  fun readFileRejectsWhenUriIsMissing() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("uri")).thenReturn(null)

    val latch = CountDownLatch(1)
    doAnswer {
      latch.countDown()
      null
    }.`when`(call).reject("uri is required")

    plugin.readFile(call)
    assertTrue(latch.await(2, TimeUnit.SECONDS))
  }

  @Test
  fun readFileRejectsWhenUriIsBlank() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("uri")).thenReturn("")

    val latch = CountDownLatch(1)
    doAnswer {
      latch.countDown()
      null
    }.`when`(call).reject("uri is required")

    plugin.readFile(call)
    assertTrue(latch.await(2, TimeUnit.SECONDS))
  }

  @Test
  fun listChildrenRejectsWhenTreeUriMissing() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("treeUri")).thenReturn(null)

    val latch = CountDownLatch(1)
    doAnswer {
      latch.countDown()
      null
    }.`when`(call).reject("treeUri is required")

    plugin.listChildren(call)
    assertTrue(latch.await(2, TimeUnit.SECONDS))
  }

  @Test
  fun readFileFromTreeRejectsWhenTreeUriMissing() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("treeUri")).thenReturn(null)
    `when`(call.getString("path")).thenReturn("/demo.sid")

    val latch = CountDownLatch(1)
    doAnswer {
      latch.countDown()
      null
    }.`when`(call).reject("treeUri is required")

    plugin.readFileFromTree(call)
    assertTrue(latch.await(2, TimeUnit.SECONDS))
  }

  @Test
  fun readFileFromTreeRejectsWhenPathMissing() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("treeUri")).thenReturn("content://tree")
    `when`(call.getString("path")).thenReturn(null)

    val latch = CountDownLatch(1)
    doAnswer {
      latch.countDown()
      null
    }.`when`(call).reject("path is required")

    plugin.readFileFromTree(call)
    assertTrue(latch.await(2, TimeUnit.SECONDS))
  }

  private fun setPluginBridge(target: FolderPickerPlugin, context: Context) {
    val bridge = mock(Bridge::class.java)
    `when`(bridge.context).thenReturn(context)
    val field = Plugin::class.java.getDeclaredField("bridge")
    field.isAccessible = true
    field.set(target, bridge)
  }

  @Test
  fun readFileReturnsBase64Data() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)

    val file = tempFolder.newFile("demo.bin")
    file.writeBytes(byteArrayOf(1, 2, 3, 4))
    val uri = android.net.Uri.fromFile(file)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("uri")).thenReturn(uri.toString())

    val latch = CountDownLatch(1)
    var resolved: JSObject? = null
    doAnswer { invocation ->
      resolved = invocation.getArgument(0) as JSObject
      latch.countDown()
      null
    }.`when`(call).resolve(any())

    plugin.readFile(call)
    assertTrue(latch.await(2, TimeUnit.SECONDS))
    assertNotNull(resolved?.getString("data"))
  }

  @Test
  fun readFileRejectsFileExceedingMaxReadFileBytes() {
    // HARD9-044: without a cap, readFile fully buffers the file then Base64-
    // encodes it (~1.33x on top), driving the app into OOM for a large file.
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    plugin.maxReadFileBytes = 10L

    val file = tempFolder.newFile("big.dnp")
    file.writeBytes(ByteArray(20) { 1 })
    val uri = android.net.Uri.fromFile(file)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("uri")).thenReturn(uri.toString())

    val latch = CountDownLatch(1)
    var rejectedMessage: String? = null
    doAnswer { invocation ->
      rejectedMessage = invocation.getArgument(0) as String?
      latch.countDown()
      null
    }.`when`(call).reject(anyString(), any(Exception::class.java))

    plugin.readFile(call)

    assertTrue(latch.await(2, TimeUnit.SECONDS))
    assertNotNull(rejectedMessage)
    assertTrue(rejectedMessage!!.contains("maximum readable size"))
  }

  @Test
  fun readFileLogsWhenReadFails() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("uri")).thenReturn("content://invalid")

    val latch = CountDownLatch(1)
    doAnswer {
      latch.countDown()
      null
    }.`when`(call).reject(anyString(), any(Exception::class.java))

    ShadowLog.clear()
    plugin.readFile(call)

    assertTrue(latch.await(2, TimeUnit.SECONDS))
    val logs = ShadowLog.getLogsForTag("FolderPickerPlugin")
    assertTrue(logs.any { it.msg?.contains("SAF readFile failed") == true })
  }

  @Test
  fun releasePersistedUrisReleasesPersistedSafGrant() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    val uri = Uri.parse("content://com.android.externalstorage.documents/tree/primary%3AC64Music")
    context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    assertTrue(context.contentResolver.persistedUriPermissions.any { it.uri == uri && it.isReadPermission })

    val call = mock(PluginCall::class.java)
    var resolved: JSObject? = null
    doAnswer { invocation ->
      resolved = invocation.getArgument(0) as JSObject
      null
    }.`when`(call).resolve(any())

    plugin.releasePersistedUris(call)

    assertNotNull(resolved)
    assertTrue(resolved?.get("released") is JSArray)
    assertFalse(context.contentResolver.persistedUriPermissions.any { it.uri == uri })
    verify(call, never()).reject(anyString(), any(Exception::class.java))
  }

  @Test
  fun getPersistedUrisReturnsJsArray() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    val uri = Uri.parse("content://com.android.externalstorage.documents/tree/primary%3AC64Music")
    context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)

    val call = mock(PluginCall::class.java)
    var resolved: JSObject? = null
    doAnswer { invocation ->
      resolved = invocation.getArgument(0) as JSObject
      null
    }.`when`(call).resolve(any())

    plugin.getPersistedUris(call)

    assertTrue(resolved?.get("uris") is JSArray)
  }

}
