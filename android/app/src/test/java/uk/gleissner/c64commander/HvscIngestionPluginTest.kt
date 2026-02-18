package uk.gleissner.c64commander

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.getcapacitor.Bridge
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

private open class TestableHvscIngestionPlugin : HvscIngestionPlugin() {
  val progressEvents = mutableListOf<JSObject>()

  public override fun notifyListeners(eventName: String?, data: JSObject?) {
    if (eventName == "hvscProgress" && data != null) {
      progressEvents.add(data)
    }
    super.notifyListeners(eventName, data)
  }
}

@RunWith(RobolectricTestRunner::class)
class HvscIngestionPluginTest {
  private lateinit var context: Context
  private lateinit var plugin: TestableHvscIngestionPlugin

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    plugin = TestableHvscIngestionPlugin()
    injectBridge(plugin, context)
  }

  private fun injectBridge(target: Plugin, ctx: Context) {
    val bridge = mock(Bridge::class.java)
    `when`(bridge.context).thenReturn(ctx)
    val field = Plugin::class.java.getDeclaredField("bridge")
    field.isAccessible = true
    field.set(target, bridge)
  }

  @Test
  fun ingestHvscRejectsMissingArchivePath() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("relativeArchivePath")).thenReturn(null)

    plugin.ingestHvsc(call)

    verify(call).reject("relativeArchivePath is required")
    verify(call, never()).resolve(any(JSObject::class.java))
  }

  @Test
  fun ingestHvscRejectsInvalidMode() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("relativeArchivePath")).thenReturn("hvsc-baseline-1.7z")
    `when`(call.getString("mode")).thenReturn("invalid")

    plugin.ingestHvsc(call)

    verify(call).reject("mode must be baseline or update")
    verify(call, never()).resolve(any(JSObject::class.java))
  }

  @Test
  fun cancelIngestionAlwaysResolves() {
    val call = mock(PluginCall::class.java)

    plugin.cancelIngestion(call)

    verify(call).resolve()
  }

  @Test
  fun getIngestionStatsResolvesWithMetadataRows() {
    val call = mock(PluginCall::class.java)
    val resolveLatch = CountDownLatch(1)
    val payloadHolder = arrayOfNulls<JSObject>(1)

    doAnswer { invocation ->
      payloadHolder[0] = invocation.getArgument(0) as JSObject
      resolveLatch.countDown()
      null
    }.`when`(call).resolve(any(JSObject::class.java))

    plugin.getIngestionStats(call)

    assertTrue(resolveLatch.await(5, TimeUnit.SECONDS))
    assertTrue((payloadHolder[0]?.getLong("metadataRows") ?: -1L) >= 0L)
  }

  @Test
  fun emitProgressPublishesExpectedPayloadShape() {
    val method = HvscIngestionPlugin::class.java.getDeclaredMethod(
      "emitProgress",
      String::class.java,
      String::class.java,
      Int::class.javaPrimitiveType,
      Int::class.javaObjectType,
      String::class.java,
      Int::class.javaPrimitiveType,
      Int::class.javaPrimitiveType,
    )
    method.isAccessible = true

    method.invoke(
      plugin,
      "sid_metadata_parsing",
      "Processing HVSC archive…",
      12,
      20,
      "/MUSICIANS/A/Artist/Tiny.sid",
      5,
      1,
    )

    assertTrue(plugin.progressEvents.isNotEmpty())
    val event = plugin.progressEvents.last()
    assertEquals("sid_metadata_parsing", event.getString("stage"))
    assertEquals(12, event.getInt("processedCount"))
    assertEquals(20, event.getInt("totalCount"))
    assertEquals(60, event.getInt("percent"))
    assertEquals(5, event.getInt("songsUpserted"))
    assertEquals(1, event.getInt("songsDeleted"))
  }
}
