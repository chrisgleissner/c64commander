package uk.gleissner.c64commander

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.getcapacitor.Bridge
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import java.io.File
import java.lang.reflect.Method
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
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
            }
            .`when`(call)
            .resolve(any(JSObject::class.java))

    plugin.getIngestionStats(call)

    assertTrue(resolveLatch.await(5, TimeUnit.SECONDS))
    assertTrue((payloadHolder[0]?.getLong("metadataRows") ?: -1L) >= 0L)
  }

  @Test
  fun emitProgressPublishesExpectedPayloadShape() {
    val method =
            HvscIngestionPlugin::class.java.getDeclaredMethod(
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

  @Test
  fun buildIngestionFailureMessageClassifiesUnsupportedSevenZipMethod() {
    val method: Method =
            HvscIngestionPlugin::class.java.getDeclaredMethod(
                    "buildIngestionFailureMessage",
                    Exception::class.java,
            )
    method.isAccessible = true

    val result =
            method.invoke(
                    plugin,
                    IllegalStateException(
                            "Unsupported compression method [3, 4, 1] used in entry demo.7z"
                    ),
            ) as
                    String

    assertEquals(
            "HVSC 7z method chain [3, 4, 1] is unsupported by Android native extraction; retry will use the non-native fallback extractor",
            result,
    )
  }

  @Test
  fun readArchiveChunkReturnsBoundedBase64Payload() {
    val archiveDir = File(context.filesDir, "hvsc/cache")
    archiveDir.mkdirs()
    val archiveFile = File(archiveDir, "baseline.7z")
    archiveFile.writeBytes(byteArrayOf(1, 2, 3, 4, 5, 6))

    val call = mock(PluginCall::class.java)
    `when`(call.getString("relativeArchivePath")).thenReturn("hvsc/cache/baseline.7z")
    `when`(call.getLong("offsetBytes")).thenReturn(2L)
    `when`(call.getInt("lengthBytes")).thenReturn(3)

    val payloadHolder = arrayOfNulls<JSObject>(1)
    doAnswer { invocation ->
              payloadHolder[0] = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any(JSObject::class.java))

    plugin.readArchiveChunk(call)

    val payload = payloadHolder[0]
    assertEquals(3, payload?.getInteger("sizeBytes"))
    assertEquals(false, payload?.getBoolean("eof"))
    assertEquals("AwQF", payload?.getString("data"))
  }

  @Test
  fun readArchiveChunkMarksEofWhenOffsetStartsAtFinalByteRange() {
    val archiveDir = File(context.filesDir, "hvsc/cache")
    archiveDir.mkdirs()
    val archiveFile = File(archiveDir, "final-range.7z")
    archiveFile.writeBytes(byteArrayOf(10, 11, 12, 13, 14, 15))

    val call = mock(PluginCall::class.java)
    `when`(call.getString("relativeArchivePath")).thenReturn("hvsc/cache/final-range.7z")
    `when`(call.getLong("offsetBytes")).thenReturn(4L)
    `when`(call.getInt("lengthBytes")).thenReturn(8)

    val payloadHolder = arrayOfNulls<JSObject>(1)
    doAnswer { invocation ->
              payloadHolder[0] = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any(JSObject::class.java))

    plugin.readArchiveChunk(call)

    val payload = payloadHolder[0]
    assertEquals(2, payload?.getInteger("sizeBytes"))
    assertEquals(true, payload?.getBoolean("eof"))
    assertEquals("Dg8=", payload?.getString("data"))
  }

  @Test
  fun readArchiveChunkRejectsNegativeOffsetsBeforeTouchingFilesystem() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("relativeArchivePath")).thenReturn("hvsc/cache/missing.7z")
    `when`(call.getLong("offsetBytes")).thenReturn(-1L)
    `when`(call.getInt("lengthBytes")).thenReturn(4)

    plugin.readArchiveChunk(call)

    verify(call).reject("offsetBytes must be >= 0")
    verify(call, never()).resolve(any(JSObject::class.java))
  }
}
