package uk.gleissner.c64commander.hvsc

import androidx.test.core.app.ApplicationProvider
import android.content.Context
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AndroidHvscDatabaseTest {
  @Test
  fun metaUpdatesPersist() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val db = AndroidHvscDatabase(context)
    db.updateMeta(installedBaselineVersion = 82, installedVersion = 83, ingestionState = "ready", lastUpdateCheckUtcMs = 100L, ingestionError = null, clearIngestionError = true)

    val meta = db.getMeta()
    assertEquals(82, meta.installedBaselineVersion)
    assertEquals(83, meta.installedVersion)
    assertEquals("ready", meta.ingestionState)
    assertEquals(100L, meta.lastUpdateCheckUtcMs)
    assertNull(meta.ingestionError)
    db.close()
  }

  @Test
  fun songCrudQueriesWork() {
    val context = ApplicationProvider.getApplicationContext<Context>()
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

    val folders = db.listFolders("/")
    assertTrue(folders.contains("/DEMOS/0-9"))

    val songs = db.listSongs("/DEMOS/0-9")
    assertEquals(1, songs.size)
    assertEquals("demo.sid", songs[0].fileName)

    val detailByPath = db.getSongByVirtualPath("/DEMOS/0-9/demo.sid")
    assertNotNull(detailByPath)
    assertEquals("abc123", detailByPath?.md5)

    val detailById = db.getSongById(detailByPath!!.id)
    assertNotNull(detailById)
    assertEquals("demo.sid", detailById?.fileName)

    assertEquals(120, db.getDurationByMd5("abc123"))

    db.updateDurationsByMd5(mapOf("abc123" to 90))
    assertEquals(90, db.getDurationByMd5("abc123"))

    db.deleteByVirtualPaths(listOf("/DEMOS/0-9/demo.sid"))
    assertNull(db.getSongByVirtualPath("/DEMOS/0-9/demo.sid"))
    db.close()
  }

  @Test
  fun updateAppliedTracking() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val db = AndroidHvscDatabase(context)
    assertFalse(db.isUpdateApplied(84))
    db.markUpdateApplied(84, "success", null)
    assertTrue(db.isUpdateApplied(84))
    db.close()
  }
}
