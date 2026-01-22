package uk.gleissner.c64commander

import com.getcapacitor.PluginCall
import com.getcapacitor.JSObject
import androidx.documentfile.provider.DocumentFile
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

    plugin.readFile(call)

    // Give executor time to run
    Thread.sleep(100)

    verify(call).reject("uri is required")
  }

  @Test
  fun readFileRejectsWhenUriIsBlank() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("uri")).thenReturn("")

    plugin.readFile(call)

    // Give executor time to run
    Thread.sleep(100)

    verify(call).reject("uri is required")
  }

  @Test
  fun supportedLocalFileDetectionHonorsExtensions() {
    val method = FolderPickerPlugin::class.java.getDeclaredMethod(
      "isSupportedLocalFile",
      String::class.java,
      Set::class.java
    )
    method.isAccessible = true

    val allowed = setOf("sid")
    val sidResult = method.invoke(plugin, "demo.sid", allowed) as Boolean
    val zipResult = method.invoke(plugin, "demo.zip", allowed) as Boolean

    assertTrue(sidResult)
    assertFalse(zipResult)
  }

  @Test
  fun supportedLocalFileDetectionUsesDefaultExtensions() {
    val method = FolderPickerPlugin::class.java.getDeclaredMethod(
      "isSupportedLocalFile",
      String::class.java,
      Set::class.java
    )
    method.isAccessible = true

    val sidResult = method.invoke(plugin, "demo.sid", null) as Boolean
    val zipResult = method.invoke(plugin, "demo.zip", null) as Boolean
    val sevenZResult = method.invoke(plugin, "demo.7z", null) as Boolean
    val txtResult = method.invoke(plugin, "demo.txt", null) as Boolean

    assertTrue(sidResult)
    assertTrue(zipResult)
    assertTrue(sevenZResult)
    assertFalse(txtResult)
  }

  @Test
  fun collectFilesRespectsExtensionFilter() {
    val root = tempFolder.newFolder("picker-root")
    val sidFile = java.io.File(root, "demo.sid")
    val txtFile = java.io.File(root, "demo.txt")
    val subDir = java.io.File(root, "sub")
    subDir.mkdirs()
    val zipFile = java.io.File(subDir, "archive.zip")
    sidFile.writeText("sid")
    txtFile.writeText("txt")
    zipFile.writeText("zip")

    val method = FolderPickerPlugin::class.java.getDeclaredMethod(
      "collectFiles",
      DocumentFile::class.java,
      String::class.java,
      MutableList::class.java,
      Set::class.java
    )
    method.isAccessible = true

    val results = mutableListOf<JSObject>()
    val allowed = setOf("sid")
    method.invoke(plugin, DocumentFile.fromFile(root), "", results, allowed)

    assertEquals(1, results.size)
    assertEquals("demo.sid", results[0].getString("name"))
    assertEquals("/demo.sid", results[0].getString("path"))
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
