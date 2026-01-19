package com.c64.commander.hvsc

import org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry
import org.apache.commons.compress.archivers.sevenz.SevenZOutputFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import java.io.File
import java.nio.file.Files

class HvscIngestionServiceTest {
  @Test
  fun installsBaselineAndAppliesUpdate() {
    val tempDir = Files.createTempDirectory("hvsc-test").toFile()
    val baselineArchive = File(tempDir, "hvsc-baseline.7z")
    val updateArchive = File(tempDir, "hvsc-update.7z")

    createArchiveFromDir(
      resolveFixture("hvsc/complete"),
      baselineArchive,
    )
    createArchiveFromDir(
      resolveFixture("hvsc/update/update"),
      updateArchive,
    )

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

    val meta = db.getMeta()
    assertEquals(83, meta.installedBaselineVersion)
    assertEquals(84, meta.installedVersion)

    val listing = db.listSongs("/DEMOS/0-9")
    assertEquals("Songs: ${listing.map { it.virtualPath }}", 3, listing.size)
    val song = db.getSongByVirtualPath("/DEMOS/0-9/8-Bit_Bard.sid")
    assertNotNull(song)
    assertEquals(34, song?.durationSeconds)
  }

  @Test
  fun reapplyingUpdateIsIdempotent() {
    val tempDir = Files.createTempDirectory("hvsc-test2").toFile()
    val baselineArchive = File(tempDir, "hvsc-baseline.7z")
    val updateArchive = File(tempDir, "hvsc-update.7z")

    createArchiveFromDir(
      resolveFixture("hvsc/complete"),
      baselineArchive,
    )
    createArchiveFromDir(
      resolveFixture("hvsc/update/update"),
      updateArchive,
    )

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
    assertEquals("Songs: ${listing.map { it.virtualPath }}", 3, listing.size)
  }

  @Test
  fun updateFailureDoesNotAdvanceVersion() {
    val tempDir = Files.createTempDirectory("hvsc-test3").toFile()
    val baselineArchive = File(tempDir, "hvsc-baseline.7z")
    val updateArchive = File(tempDir, "hvsc-update.7z")

    createArchiveFromDir(
      resolveFixture("hvsc/complete"),
      baselineArchive,
    )
    createArchiveFromDir(
      resolveFixture("hvsc/update/update"),
      updateArchive,
    )

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

    createArchiveFromDir(
      resolveFixture("hvsc/complete"),
      baselineArchive,
    )

    val updateRoot = File(tempDir, "update-fixture").apply { mkdirs() }
    val newDir = File(updateRoot, "new/DEMOS/0-9").apply { mkdirs() }
    File(updateRoot, "delete.txt").writeText("/DEMOS/0-9/10_Orbyte.sid\n")
    File(newDir, "New.sid").writeBytes(byteArrayOf(0x01, 0x02, 0x03))
    createArchiveFromDir(updateRoot, updateArchive)

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
    assertNotNull(db.getSongByVirtualPath("/DEMOS/0-9/New.sid"))
  }

  private fun createArchiveFromDir(sourceDir: File, targetArchive: File) {
    if (targetArchive.exists()) targetArchive.delete()
    SevenZOutputFile(targetArchive).use { output ->
      addDirectory(output, sourceDir, "")
    }
  }

  private fun resolveFixture(relativePath: String): File {
    val cwd = File(System.getProperty("user.dir") ?: ".")
    val candidates = listOf(
      cwd.resolve("tests/fixtures/$relativePath"),
      cwd.resolve("../tests/fixtures/$relativePath"),
      cwd.resolve("../../tests/fixtures/$relativePath"),
    )
    return candidates.firstOrNull { it.exists() }
      ?: throw IllegalStateException("Fixture not found: $relativePath (cwd=${cwd.path})")
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
    override fun download(url: String, target: File, onProgress: ((percent: Int) -> Unit)?) {
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
      onProgress?.invoke(100)
    }
  }

  private class FailingUpdateDownloader(
    private val baselineArchive: File,
  ) : HvscDownloadClient {
    override fun download(url: String, target: File, onProgress: ((percent: Int) -> Unit)?) {
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
      onProgress?.invoke(100)
    }
  }
}
