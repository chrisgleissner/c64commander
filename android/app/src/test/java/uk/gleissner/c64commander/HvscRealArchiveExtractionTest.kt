package uk.gleissner.c64commander

import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.gleissner.c64commander.hvsc.DefaultHvscArchiveExtractor
import uk.gleissner.c64commander.hvsc.HvscArchiveMode
import uk.gleissner.c64commander.hvsc.InsufficientMemoryException
import uk.gleissner.c64commander.hvsc.MemoryBudget

class HvscRealArchiveExtractionTest {
  private val extractor = DefaultHvscArchiveExtractor {
    HostSevenZipBinaryProvider.requireExecutable()
  }

  @Test
  fun `real hvsc archive probe captures expected scale and method chain`() {
    val archive = RealHvscArchiveProvider.requireArchive()
    val startNanos = System.nanoTime()

    val profile = extractor.probe(archive, HvscArchiveMode.BASELINE)
    val elapsedMs = (System.nanoTime() - startNanos) / 1_000_000

    System.err.println(
            "HVSC real archive probe: files=${profile.fileCount}, dirs=${profile.directoryCount}, sidFiles=${profile.sidFileCount}, songlengthFiles=${profile.songlengthFiles}, totalBytes=${profile.uncompressedSizeBytes}, estimatedRequiredBytes=${profile.estimatedRequiredBytes}, elapsedMs=$elapsedMs"
    )

    assertEquals("7z", profile.format)
    assertEquals("LZMA:336m PPMD BCJ2", profile.methodChain)
    assertEquals(60737, profile.fileCount)
    assertEquals(2, profile.directoryCount)
    assertEquals(372025688L, profile.uncompressedSizeBytes)
    assertTrue(
            "Expected at least 50,000 SID files, got ${profile.sidFileCount}",
            profile.sidFileCount > 50000
    )
    assertTrue("Expected at least one Songlengths file", profile.songlengthFiles >= 1)
  }

  @Test
  fun `real hvsc archive extracts 100 sid samples with valid headers`() {
    val archive = RealHvscArchiveProvider.requireArchive()
    val outputDir = createTempDir(prefix = "hvsc-real-samples-")
    val startNanos = System.nanoTime()
    val progressSamples = mutableListOf<Int>()

    try {
      val result =
              extractor.extract(
                      archiveFile = archive,
                      outputDir = outputDir,
                      mode = HvscArchiveMode.BASELINE,
                      cancellationToken = AtomicBoolean(false),
                      memoryBudget =
                              MemoryBudget(
                                      maxExtractionBytes = 1024L * 1024L * 1024L,
                                      detail = "real archive JVM validation",
                              ),
                      onProgress = { progress ->
                        if (progress.processedEntries % 10000 == 0) {
                          progressSamples += progress.processedEntries
                        }
                      },
              )
      val elapsedMs = (System.nanoTime() - startNanos) / 1_000_000

      System.err.println(
              "HVSC real archive extraction: songs=${result.songsIngested}, songlengths=${result.songlengthFilesWritten}, failed=${result.failedSongs}, progressSamples=$progressSamples, elapsedMs=$elapsedMs"
      )

      val sampleSongs = result.extractedSongs.take(100)
      assertEquals(100, sampleSongs.size)
      sampleSongs.forEach { song ->
        val file = File(outputDir, song.virtualPath.removePrefix("/"))
        val header =
                file.inputStream().use { input ->
                  val bytes = ByteArray(4)
                  val read = input.read(bytes)
                  assertEquals(4, read)
                  String(bytes, Charsets.US_ASCII)
                }
        assertTrue(
                "Expected ${song.virtualPath} to start with PSID or RSID, got $header",
                header == "PSID" || header == "RSID"
        )
      }
      assertTrue("Expected a Songlengths file to be written", result.songlengthFilesWritten >= 1)
      assertTrue("Expected no failed songs, got ${result.failedPaths}", result.failedSongs == 0)
    } finally {
      outputDir.deleteRecursively()
    }
  }

  @Test
  fun `real hvsc archive is rejected when memory budget is below measured requirement`() {
    val archive = RealHvscArchiveProvider.requireArchive()
    val outputDir = createTempDir(prefix = "hvsc-real-budget-")

    try {
      val error =
              org.junit.Assert.assertThrows(InsufficientMemoryException::class.java) {
                extractor.extract(
                        archiveFile = archive,
                        outputDir = outputDir,
                        mode = HvscArchiveMode.BASELINE,
                        cancellationToken = AtomicBoolean(false),
                        memoryBudget =
                                MemoryBudget(
                                        maxExtractionBytes = 128L * 1024L * 1024L,
                                        detail = "forced rejection"
                                ),
                )
              }

      assertTrue(error.requiredBytes > error.maxExtractionBytes)
    } finally {
      outputDir.deleteRecursively()
    }
  }
}
