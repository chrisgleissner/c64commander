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

class HvscIngestionServiceTest {
  @get:Rule
  val tempFolder = TemporaryFolder()

  private fun createStateStore(workDir: File): HvscStateStore {
    return HvscStateStore(File(workDir, "state.json"))
  }

  private fun createLibrary(workDir: File): HvscLibrary {
    return HvscLibrary(File(workDir, "library"))
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

    val stateStore = createStateStore(workDir)
    val service = HvscIngestionService(stateStore)
    val status = service.getCacheStatus(workDir)

    assertEquals(80, status.baselineVersion)
    assertEquals(listOf(81, 82, 83), status.updateVersions)
  }

  @Test
  fun checkForUpdatesWhenNoInstallUsesBaselineLatest() {
    val workDir = tempFolder.newFolder("hvsc-status")
    val stateStore = createStateStore(workDir)
    val releaseProvider = object : HvscReleaseProvider {
      override fun fetchLatestVersions(): Pair<Int, Int> = 80 to 82
      override fun buildBaselineUrl(version: Int): String = "baseline-$version"
      override fun buildUpdateUrl(version: Int): String = "update-$version"
    }
    val service = HvscIngestionService(stateStore, releaseProvider)

    val status = service.checkForUpdates()

    assertEquals(82, status.latestVersion)
    assertEquals(0, status.installedVersion)
    assertEquals(listOf(81, 82), status.requiredUpdates)
    assertEquals(80, status.baselineVersion)
    assertNotNull(stateStore.load().lastUpdateCheckUtcMs)
  }

  @Test(expected = IllegalStateException::class)
  fun ingestCachedThrowsWhenNoArchivesFound() {
    val workDir = tempFolder.newFolder("hvsc-empty")
    val service = HvscIngestionService(createStateStore(workDir))

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
      ; /Demos/Updated.sid
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

    val stateStore = createStateStore(workDir)
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

    val service = HvscIngestionService(stateStore, releaseProvider, downloader)
    val progress = mutableListOf<HvscIngestionService.Progress>()

    val meta = service.installOrUpdate(workDir, null) { progress.add(it) }

    assertEquals(80, meta.installedBaselineVersion)
    assertEquals(81, meta.installedVersion)
    assertEquals("ready", meta.ingestionState)
    assertNull(meta.ingestionError)
    assertTrue(stateStore.isUpdateApplied(81))

    val library = createLibrary(workDir)
    val songs = library.listSongs("/Demos")
    assertEquals(1, songs.size)
    assertEquals("Updated.sid", songs[0].fileName)
    assertEquals(60, songs[0].durationSeconds)
    assertFalse(library.listSongs("/Demos").any { it.fileName == "Test.sid" })

    assertTrue(progress.any { it.stage == "archive_validation" })
    assertTrue(progress.any { it.stage == "sid_metadata_parsing" })
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

    val releaseProvider = object : HvscReleaseProvider {
      override fun fetchLatestVersions(): Pair<Int, Int> = 80 to 80
      override fun buildBaselineUrl(version: Int): String = "baseline-$version"
      override fun buildUpdateUrl(version: Int): String = "update-$version"
    }
    val stateStore = createStateStore(workDir)
    val service = HvscIngestionService(stateStore, releaseProvider)

    val meta = service.installOrUpdate(workDir, null) { }

    assertEquals(80, meta.installedBaselineVersion)
    assertEquals(80, meta.installedVersion)
    val library = createLibrary(workDir)
    val songs = library.listSongs("/Demos")
    assertEquals(1, songs.size)
    assertEquals("Test.sid", songs[0].fileName)
    assertEquals(45, songs[0].durationSeconds)
  }
}
