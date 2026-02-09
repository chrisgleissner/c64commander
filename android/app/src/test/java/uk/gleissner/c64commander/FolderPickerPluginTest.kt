/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import com.getcapacitor.PluginCall
import com.getcapacitor.JSObject
import com.getcapacitor.Bridge
import com.getcapacitor.Plugin
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.rules.TemporaryFolder
import org.mockito.Mockito.*
import org.robolectric.RobolectricTestRunner
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

}
