package uk.gleissner.c64commander

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.getcapacitor.Bridge
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner
import uk.gleissner.c64commander.hvsc.AndroidHvscDatabase
import uk.gleissner.c64commander.hvsc.HvscSchema
import uk.gleissner.c64commander.hvsc.HvscSongRecord
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
class HvscIngestionPluginTest {
  private lateinit var context: Context

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    context.deleteDatabase(HvscSchema.DATABASE_NAME)
  }

  private fun setPluginBridge(target: HvscIngestionPlugin, context: Context) {
    val bridge = mock(Bridge::class.java)
    `when`(bridge.context).thenReturn(context)
    val field = Plugin::class.java.getDeclaredField("bridge")
    field.isAccessible = true
    field.set(target, bridge)
  }

  @Test
  fun getStatusAndCacheStatusResolvePayloads() {
    val plugin = HvscIngestionPlugin()
    setPluginBridge(plugin, context)

    val workDir = File(context.filesDir, "hvsc")
    workDir.mkdirs()
    File(workDir, "hvsc-baseline-80.zip").writeBytes(byteArrayOf(1))

    val statusCall = mock(PluginCall::class.java)
    val statusLatch = CountDownLatch(1)
    var statusPayload: JSObject? = null
    doAnswer { invocation ->
      statusPayload = invocation.getArgument(0) as JSObject
      statusLatch.countDown()
      null
    }.`when`(statusCall).resolve(any())
    plugin.getHvscStatus(statusCall)
    assertTrue(statusLatch.await(2, TimeUnit.SECONDS))
    assertNotNull(statusPayload?.getInteger("installedVersion"))

    val cacheCall = mock(PluginCall::class.java)
    val cacheLatch = CountDownLatch(1)
    var cachePayload: JSObject? = null
    doAnswer { invocation ->
      cachePayload = invocation.getArgument(0) as JSObject
      cacheLatch.countDown()
      null
    }.`when`(cacheCall).resolve(any())
    plugin.getHvscCacheStatus(cacheCall)
    assertTrue(cacheLatch.await(2, TimeUnit.SECONDS))
    assertEquals(80, cachePayload?.getInteger("baselineVersion"))
  }

  @Test
  fun getFolderListingAndSongResolveFromDatabase() {
    val plugin = HvscIngestionPlugin()
    setPluginBridge(plugin, context)

    val db = AndroidHvscDatabase(context)
    val record = HvscSongRecord(
      virtualPath = "/DEMOS/0-9/demo.sid",
      dirPath = "/DEMOS/0-9",
      fileName = "demo.sid",
      sizeBytes = 12,
      md5 = "abc123",
      durationSeconds = 120,
      data = byteArrayOf(1, 2, 3),
      sourceVersion = 84,
      createdAtUtcMs = 1L,
      updatedAtUtcMs = 2L,
    )
    db.upsertSongs(listOf(record))
    val songDetail = db.getSongByVirtualPath("/DEMOS/0-9/demo.sid")
    val songId = songDetail?.id ?: 0
    db.close()

    val listingCall = mock(PluginCall::class.java)
    `when`(listingCall.getString("path")).thenReturn("/DEMOS/0-9")
    val listingLatch = CountDownLatch(1)
    var listingPayload: JSObject? = null
    doAnswer { invocation ->
      listingPayload = invocation.getArgument(0) as JSObject
      listingLatch.countDown()
      null
    }.`when`(listingCall).resolve(any())

    plugin.getHvscFolderListing(listingCall)
    assertTrue(listingLatch.await(2, TimeUnit.SECONDS))
    val songs = listingPayload?.getJSONArray("songs")
    assertEquals(1, songs?.length())

    val songCall = mock(PluginCall::class.java)
    `when`(songCall.getLong("id")).thenReturn(songId)
    val songLatch = CountDownLatch(1)
    var songPayload: JSObject? = null
    doAnswer { invocation ->
      songPayload = invocation.getArgument(0) as JSObject
      songLatch.countDown()
      null
    }.`when`(songCall).resolve(any())

    plugin.getHvscSong(songCall)
    assertTrue(songLatch.await(2, TimeUnit.SECONDS))
    assertEquals("demo.sid", songPayload?.getString("fileName"))
    assertNotNull(songPayload?.getString("dataBase64"))
  }

  @Test
  fun getDurationByMd5RejectsMissingMd5() {
    val plugin = HvscIngestionPlugin()
    setPluginBridge(plugin, context)

    val call = mock(PluginCall::class.java)
    `when`(call.getString("md5")).thenReturn(null)
    val latch = CountDownLatch(1)
    doAnswer {
      latch.countDown()
      null
    }.`when`(call).reject("md5 is required")

    plugin.getHvscDurationByMd5(call)
    assertTrue(latch.await(2, TimeUnit.SECONDS))
  }
}
