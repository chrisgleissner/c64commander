package com.c64.commander.hvsc

import org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry
import org.apache.commons.compress.archivers.sevenz.SevenZOutputFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class HvscIngestionServiceTest {
  @Test
  fun installsBaselineAndAppliesUpdate() {
    val tempDir = Files.createTempDirectory("hvsc-test").toFile()
    val baselineArchive = File(tempDir, "hvsc-baseline.7z")
    val updateArchive = File(tempDir, "hvsc-update.7z")

    createArchiveFromDir(resolveFixtureDir("baseline"), baselineArchive)
    createArchiveFromDir(resolveFixtureDir("update"), updateArchive)

    val db = JdbcHvscDatabase.inMemory()
    val downloader = TestDownloader(
      mapOf(
        "baseline" to baselineArchive,
        "update" to updateArchive,
      ),
    )
    val releaseProvider = TestReleaseProvider(baselineVersion = 83, updateVersion = 84)

    val service = HvscIngestionService(db, releaseProvider, downloader)
    service.installOrUpdate(tempDir, null) { }

    // installOrUpdate runs baseline + updates, so baseline stays 83 while installed version advances to 84.
    val meta = db.getMeta()
    assertEquals(83, meta.installedBaselineVersion)
    assertEquals(84, meta.installedVersion)

    val listing = db.listSongs("/DEMOS/0-9")
    assertEquals("Songs: ${listing.map { it.virtualPath }}", 2, listing.size)
    val song = db.getSongByVirtualPath("/DEMOS/0-9/8-Bit_Bard.sid")
    assertNotNull(song)
    assertEquals(34, song?.durationSeconds)
  }

  @Test
  fun reapplyingUpdateIsIdempotent() {
    val tempDir = Files.createTempDirectory("hvsc-test2").toFile()
    val baselineArchive = File(tempDir, "hvsc-baseline.7z")
    val updateArchive = File(tempDir, "hvsc-update.7z")

    createArchiveFromDir(resolveFixtureDir("baseline"), baselineArchive)
    createArchiveFromDir(resolveFixtureDir("update"), updateArchive)

    val db = JdbcHvscDatabase.inMemory()
    val downloader = TestDownloader(
      mapOf(
        "baseline" to baselineArchive,
        "update" to updateArchive,
      ),
    )
    val releaseProvider = TestReleaseProvider(baselineVersion = 83, updateVersion = 84)

    val service = HvscIngestionService(db, releaseProvider, downloader)
    service.installOrUpdate(tempDir, null) { }
    service.installOrUpdate(tempDir, null) { }

    val meta = db.getMeta()
    assertEquals(84, meta.installedVersion)
    val listing = db.listSongs("/DEMOS/0-9")
    assertEquals("Songs: ${listing.map { it.virtualPath }}", 2, listing.size)
  }

  @Test
  fun updateFailureDoesNotAdvanceVersion() {
    val tempDir = Files.createTempDirectory("hvsc-test3").toFile()
    val baselineArchive = File(tempDir, "hvsc-baseline.7z")
    val updateArchive = File(tempDir, "hvsc-update.7z")

    createArchiveFromDir(resolveFixtureDir("baseline"), baselineArchive)
    createArchiveFromDir(resolveFixtureDir("update"), updateArchive)

    val db = JdbcHvscDatabase.inMemory()
    val downloader = FailingUpdateDownloader(
      baselineArchive = baselineArchive,
    )
    val releaseProvider = TestReleaseProvider(baselineVersion = 83, updateVersion = 84)
    val service = HvscIngestionService(db, releaseProvider, downloader)

    try {
      service.installOrUpdate(tempDir, null) { }
    } catch (_: Exception) {
      // expected
    }

    val meta = db.getMeta()
    assertEquals(83, meta.installedVersion)
  }

  @Test
  fun updateRemovesDeletedSongs() {
    val tempDir = Files.createTempDirectory("hvsc-test4").toFile()
    val baselineArchive = File(tempDir, "hvsc-baseline.7z")
    val updateArchive = File(tempDir, "hvsc-update.7z")

    createArchiveFromDir(resolveFixtureDir("baseline"), baselineArchive)
    createArchiveFromDir(resolveFixtureDir("update"), updateArchive)

    val db = JdbcHvscDatabase.inMemory()
    val downloader = TestDownloader(
      mapOf(
        "baseline" to baselineArchive,
        "update" to updateArchive,
      ),
    )
    val releaseProvider = TestReleaseProvider(baselineVersion = 83, updateVersion = 84)
    val service = HvscIngestionService(db, releaseProvider, downloader)

    service.installOrUpdate(tempDir, null) { }

    assertEquals(null, db.getSongByVirtualPath("/DEMOS/0-9/10_Orbyte.sid"))
    assertNotNull(db.getSongByVirtualPath("/DEMOS/0-9/8-Bit_Bard.sid"))
  }

  @Test
  fun emitsStructuredProgressEvents() {
    val tempDir = Files.createTempDirectory("hvsc-test5").toFile()
    val baselineArchive = File(tempDir, "hvsc-baseline.7z")
    val updateArchive = File(tempDir, "hvsc-update.7z")

    createArchiveFromDir(resolveFixtureDir("baseline"), baselineArchive)
    createArchiveFromDir(resolveFixtureDir("update"), updateArchive)

    val db = JdbcHvscDatabase.inMemory()
    val downloader = TestDownloader(
      mapOf(
        "baseline" to baselineArchive,
        "update" to updateArchive,
      ),
    )
    val releaseProvider = TestReleaseProvider(baselineVersion = 83, updateVersion = 84)
    val service = HvscIngestionService(db, releaseProvider, downloader)
    val events = mutableListOf<HvscIngestionService.Progress>()

    service.installOrUpdate(tempDir, null) { event ->
      events.add(event)
    }

    assertTrue(events.any { it.stage == "archive_validation" })
    assertTrue(events.any { it.stage == "sid_metadata_parsing" })
    assertTrue(events.any { it.stage == "database_insertion" })
    assertTrue(events.any { it.stage == "complete" })
    val sample = events.firstOrNull()
    assertNotNull(sample?.ingestionId)
    assertTrue(events.any { it.processedCount != null })
    assertTrue(events.any { it.totalCount != null })
  }

  @Test
  fun archiveInspectorDetectsHvscContents() {
    val tempDir = Files.createTempDirectory("hvsc-test6").toFile()
    val baselineArchive = File(tempDir, "hvsc-baseline.7z")
    createArchiveFromDir(resolveFixtureDir("baseline"), baselineArchive)

    val inspection = HvscArchiveInspector.inspect(baselineArchive)
    assertTrue(inspection.sidEntries > 0)
    assertTrue(inspection.hasSonglengths)
    assertTrue(inspection.compressionMethods.isNotEmpty())
  }

  private fun createArchiveFromDir(sourceDir: File, targetArchive: File) {
    if (targetArchive.exists()) targetArchive.delete()
    SevenZOutputFile(targetArchive).use { output ->
      addDirectory(output, sourceDir, "")
    }
  }

  private fun resolveFixtureDir(name: String): File {
    val cwd = File(System.getProperty("user.dir") ?: ".")
    val candidates = listOf(
      cwd.resolve("app/src/test/fixtures/hvsc/$name"),
      cwd.resolve("android/app/src/test/fixtures/hvsc/$name"),
      cwd.resolve("src/test/fixtures/hvsc/$name"),
      cwd.resolve("../app/src/test/fixtures/hvsc/$name"),
      cwd.resolve("../android/app/src/test/fixtures/hvsc/$name"),
    )
    return candidates.firstOrNull { it.exists() }
      ?: throw IllegalStateException("Fixture directory not found: $name (cwd=${cwd.path})")
  }

  private fun addDirectory(output: SevenZOutputFile, dir: File, prefix: String) {
    val files = dir.listFiles()?.sortedBy { it.name } ?: return
    for (file in files) {
      val entryName = if (prefix.isBlank()) file.name else "$prefix/${file.name}"
      if (file.isDirectory) {
        addDirectory(output, file, entryName)
      } else {
        val entry = SevenZArchiveEntry().apply {
          name = entryName
          size = file.length()
        }
        output.putArchiveEntry(entry)
        file.inputStream().use { input ->
          val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
          while (true) {
            val read = input.read(buffer)
            if (read <= 0) break
            output.write(buffer, 0, read)
          }
        }
        output.closeArchiveEntry()
      }
    }
  }

  private class TestReleaseProvider(
    private val baselineVersion: Int,
    private val updateVersion: Int,
  ) : HvscReleaseProvider {
    override fun fetchLatestVersions(): Pair<Int, Int> = baselineVersion to updateVersion

    override fun buildBaselineUrl(version: Int): String = "baseline"

    override fun buildUpdateUrl(version: Int): String = "update"
  }

  private class TestDownloader(
    private val mapping: Map<String, File>,
  ) : HvscDownloadClient {
    override fun download(url: String, target: File, onProgress: ((progress: DownloadProgress) -> Unit)?) {
      val source = mapping[url] ?: throw IllegalStateException("Missing fixture for $url")
      source.inputStream().use { input ->
        target.outputStream().use { output ->
          val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
          while (true) {
            val read = input.read(buffer)
            if (read <= 0) break
            output.write(buffer, 0, read)
          }
        }
      }
      val size = target.length()
      onProgress?.invoke(DownloadProgress(100, size, size))
    }
  }

  private class FailingUpdateDownloader(
    private val baselineArchive: File,
  ) : HvscDownloadClient {
    override fun download(url: String, target: File, onProgress: ((progress: DownloadProgress) -> Unit)?) {
      if (url == "update") {
        throw IllegalStateException("Simulated download failure")
      }
      baselineArchive.inputStream().use { input ->
        target.outputStream().use { output ->
          val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
          while (true) {
            val read = input.read(buffer)
            if (read <= 0) break
            output.write(buffer, 0, read)
          }
        }
      }
      val size = target.length()
      onProgress?.invoke(DownloadProgress(100, size, size))
    }
  }
}
