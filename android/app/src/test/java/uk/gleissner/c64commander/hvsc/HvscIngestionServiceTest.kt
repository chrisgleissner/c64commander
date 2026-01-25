package uk.gleissner.c64commander.hvsc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry
import org.apache.commons.compress.archivers.sevenz.SevenZOutputFile
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicLong
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class HvscIngestionServiceTest {
  @get:Rule
  val tempFolder = TemporaryFolder()

  private class InMemoryHvscDatabase : HvscDatabase {
    private val idCounter = AtomicLong(1)
    private val updateStatus = mutableMapOf<Int, Pair<String, String?>>()
    private val songsByPath = mutableMapOf<String, StoredSong>()
    private var meta = HvscMeta(
      installedBaselineVersion = null,
      installedVersion = 0,
      ingestionState = "idle",
      lastUpdateCheckUtcMs = null,
      ingestionError = null,
    )

    data class StoredSong(val id: Long, val record: HvscSongRecord)

    override fun getMeta(): HvscMeta = meta

    override fun updateMeta(
      installedBaselineVersion: Int?,
      installedVersion: Int?,
      ingestionState: String?,
      lastUpdateCheckUtcMs: Long?,
      ingestionError: String?,
      clearIngestionError: Boolean,
    ) {
      meta = meta.copy(
        installedBaselineVersion = installedBaselineVersion ?: meta.installedBaselineVersion,
        installedVersion = installedVersion ?: meta.installedVersion,
        ingestionState = ingestionState ?: meta.ingestionState,
        lastUpdateCheckUtcMs = lastUpdateCheckUtcMs ?: meta.lastUpdateCheckUtcMs,
        ingestionError = when {
          clearIngestionError -> null
          ingestionError != null -> ingestionError
          else -> meta.ingestionError
        },
      )
    }

    override fun markUpdateApplied(version: Int, status: String, error: String?) {
      updateStatus[version] = status to error
    }

    override fun isUpdateApplied(version: Int): Boolean {
      return updateStatus[version]?.first == "success"
    }

    override fun upsertSongs(songs: List<HvscSongRecord>) {
      songs.forEach { record ->
        val existing = songsByPath[record.virtualPath]
        if (existing != null) {
          songsByPath[record.virtualPath] = existing.copy(record = record)
        } else {
          songsByPath[record.virtualPath] = StoredSong(idCounter.getAndIncrement(), record)
        }
      }
    }

    override fun updateDurationsByMd5(durations: Map<String, Int>) {
      val updated = songsByPath.mapValues { (_, stored) ->
        val nextDuration = durations[stored.record.md5]
        if (nextDuration == null) stored else stored.copy(record = stored.record.copy(durationSeconds = nextDuration))
      }
      songsByPath.clear()
      songsByPath.putAll(updated)
    }

    override fun updateDurationsByVirtualPath(durations: Map<String, Int>) {
      val updated = songsByPath.mapValues { (path, stored) ->
        val nextDuration = durations[path]
        if (nextDuration == null) stored else stored.copy(record = stored.record.copy(durationSeconds = nextDuration))
      }
      songsByPath.clear()
      songsByPath.putAll(updated)
    }

    override fun deleteByVirtualPaths(paths: List<String>) {
      paths.forEach { songsByPath.remove(it) }
    }

    override fun listFolders(path: String): List<String> {
      val normalized = normalizeFolder(path)
      val depth = if (normalized == "/") 0 else normalized.split("/").size - 1
      return songsByPath.values
        .map { it.record.dirPath }
        .filter { it.startsWith(normalized) }
        .mapNotNull { dir ->
          val segments = dir.trimStart('/').split("/")
          val index = depth
          segments.getOrNull(index)?.takeIf { it.isNotBlank() }
        }
        .distinct()
        .sorted()
    }

    override fun listSongs(path: String): List<HvscSongSummary> {
      val normalized = normalizeFolder(path)
      return songsByPath.values
        .filter { it.record.dirPath == normalized }
        .map { stored ->
          HvscSongSummary(
            id = stored.id,
            virtualPath = stored.record.virtualPath,
            fileName = stored.record.fileName,
            durationSeconds = stored.record.durationSeconds,
          )
        }
        .sortedBy { it.fileName }
    }

    override fun getSongById(id: Long): HvscSongDetail? {
      val stored = songsByPath.values.firstOrNull { it.id == id } ?: return null
      return stored.record.toDetail(stored.id)
    }

    override fun getSongByVirtualPath(path: String): HvscSongDetail? {
      val stored = songsByPath[path] ?: return null
      return stored.record.toDetail(stored.id)
    }

    override fun getDurationByMd5(md5: String): Int? {
      return songsByPath.values.firstOrNull { it.record.md5 == md5 }?.record?.durationSeconds
    }

    override fun withTransaction(block: () -> Unit) {
      block()
    }

    override fun close() = Unit

    private fun normalizeFolder(path: String): String {
      if (path.isBlank() || path == "/") return "/"
      return "/" + path.trim('/').trim()
    }

    private fun HvscSongRecord.toDetail(id: Long): HvscSongDetail {
      return HvscSongDetail(
        id = id,
        virtualPath = virtualPath,
        fileName = fileName,
        durationSeconds = durationSeconds,
        md5 = md5,
        data = data,
      )
    }
  }

  private fun createZip(target: File, entries: Map<String, ByteArray>) {
    ZipOutputStream(target.outputStream().buffered()).use { output ->
      entries.forEach { (name, bytes) ->
        val entry = ZipEntry(name)
        output.putNextEntry(entry)
        output.write(bytes)
        output.closeEntry()
      }
    }
  }

  private fun md5Hex(data: ByteArray): String {
    val digest = MessageDigest.getInstance("MD5")
    return digest.digest(data).joinToString("") { "%02x".format(it) }
  }

  private fun createSevenZ(target: File, entries: Map<String, ByteArray>) {
    if (target.exists()) target.delete()
    SevenZOutputFile(target).use { output ->
      entries.forEach { (name, bytes) ->
        val entry = SevenZArchiveEntry().apply {
          this.name = name
          size = bytes.size.toLong()
        }
        output.putArchiveEntry(entry)
        output.write(bytes)
        output.closeArchiveEntry()
      }
    }
  }

  @Test
  fun getCacheStatusFindsBaselineAndUpdates() {
    val workDir = tempFolder.newFolder("hvsc")
    File(workDir, "hvsc-baseline-80.zip").writeBytes(byteArrayOf(1))
    File(workDir, "hvsc-update-81.zip").writeBytes(byteArrayOf(1))
    File(workDir, "hvsc-update-83.7z").writeBytes(byteArrayOf(1))
    File(workDir, "hvsc-update-82.zip").writeBytes(byteArrayOf(1))

    val service = HvscIngestionService(InMemoryHvscDatabase())
    val status = service.getCacheStatus(workDir)

    assertEquals(80, status.baselineVersion)
    assertEquals(listOf(81, 82, 83), status.updateVersions)
  }

  @Test
  fun checkForUpdatesWhenNoInstallUsesBaselineLatest() {
    val database = InMemoryHvscDatabase()
    val releaseProvider = object : HvscReleaseProvider {
      override fun fetchLatestVersions(): Pair<Int, Int> = 80 to 82
      override fun buildBaselineUrl(version: Int): String = "baseline-$version"
      override fun buildUpdateUrl(version: Int): String = "update-$version"
    }
    val service = HvscIngestionService(database, releaseProvider)

    val status = service.checkForUpdates()

    assertEquals(82, status.latestVersion)
    assertEquals(0, status.installedVersion)
    assertEquals(listOf(81, 82), status.requiredUpdates)
    assertEquals(80, status.baselineVersion)
    assertNotNull(database.getMeta().lastUpdateCheckUtcMs)
  }

  @Test(expected = IllegalStateException::class)
  fun ingestCachedThrowsWhenNoArchivesFound() {
    val workDir = tempFolder.newFolder("hvsc-empty")
    val service = HvscIngestionService(InMemoryHvscDatabase())

    service.ingestCached(workDir, null) { }
  }

  @Test
  fun installOrUpdateUsesCachedArchivesAndAppliesUpdates() {
    val workDir = tempFolder.newFolder("hvsc")

    val baselineSid = byteArrayOf(1, 2, 3)
    val baselineMd5 = md5Hex(baselineSid)
    val baselineSonglengths = """
      ; /Demos/Test.sid
      $baselineMd5=0:30.000
    """.trimIndent().toByteArray()
    createSevenZ(
      File(workDir, "hvsc-baseline-80.7z"),
      mapOf(
        "C64Music/Demos/Test.sid" to baselineSid,
        "C64Music/Songlengths.md5" to baselineSonglengths,
      ),
    )

    val updateSid = byteArrayOf(9, 8, 7)
    val updateMd5 = md5Hex(updateSid)
    val updateSonglengths = """
      $updateMd5=1:00
    """.trimIndent().toByteArray()
    val deletionList = """
      Demos/Test.sid
    """.trimIndent().toByteArray()
    createSevenZ(
      File(workDir, "hvsc-update-81.7z"),
      mapOf(
        "C64Music/update/Demos/Updated.sid" to updateSid,
        "C64Music/update/Songlengths.md5" to updateSonglengths,
        "C64Music/update-delete.txt" to deletionList,
      ),
    )

    val database = InMemoryHvscDatabase()
    val releaseProvider = object : HvscReleaseProvider {
      override fun fetchLatestVersions(): Pair<Int, Int> = 80 to 81
      override fun buildBaselineUrl(version: Int): String = "baseline-$version"
      override fun buildUpdateUrl(version: Int): String = "update-$version"
    }
    val downloader = object : HvscDownloadClient {
      override fun download(url: String, target: File, onProgress: ((DownloadProgress) -> Unit)?) {
        throw IllegalStateException("Downloader should not be used for cached archives")
      }
    }

    val service = HvscIngestionService(database, releaseProvider, downloader)
    val progress = mutableListOf<HvscIngestionService.Progress>()

    val meta = service.installOrUpdate(workDir, null) { progress.add(it) }

    assertEquals(80, meta.installedBaselineVersion)
    assertEquals(81, meta.installedVersion)
    assertEquals("ready", meta.ingestionState)
    assertNull(meta.ingestionError)
    assertTrue(database.isUpdateApplied(81))

    val songs = database.listSongs("/Demos")
    assertEquals(1, songs.size)
    assertEquals("Updated.sid", songs[0].fileName)
    assertEquals(60, songs[0].durationSeconds)
    assertFalse(database.listSongs("/Demos").any { it.fileName == "Test.sid" })

    assertTrue(progress.any { it.stage == "archive_validation" })
    assertTrue(progress.any { it.stage == "database_insertion" })
  }

  @Test
  fun ingestExtractedBaselineFolderUsesSonglengthsTxt() {
    val workDir = tempFolder.newFolder("hvsc-extracted")
    val baselineDir = File(workDir, "hvsc-baseline-80")
    val musicDir = File(baselineDir, "C64Music/Demos")
    musicDir.mkdirs()

    val sidData = byteArrayOf(1, 2, 3, 4)
    File(musicDir, "Test.sid").writeBytes(sidData)
    val songlengths = """
      Demos/Test.sid 0:45
    """.trimIndent()
    File(baselineDir, "C64Music/Songlengths.txt").writeText(songlengths)

    val database = InMemoryHvscDatabase()
    val releaseProvider = object : HvscReleaseProvider {
      override fun fetchLatestVersions(): Pair<Int, Int> = 80 to 80
      override fun buildBaselineUrl(version: Int): String = "baseline-$version"
      override fun buildUpdateUrl(version: Int): String = "update-$version"
    }
    val service = HvscIngestionService(database, releaseProvider)

    val meta = service.installOrUpdate(workDir, null) { }

    assertEquals(80, meta.installedBaselineVersion)
    assertEquals(80, meta.installedVersion)
    val songs = database.listSongs("/Demos")
    assertEquals(1, songs.size)
    assertEquals("Test.sid", songs[0].fileName)
    assertEquals(45, songs[0].durationSeconds)
  }
}
