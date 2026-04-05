package uk.gleissner.c64commander

import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.gleissner.c64commander.hvsc.DefaultHvscArchiveExtractor
import uk.gleissner.c64commander.hvsc.HvscArchiveMode
import uk.gleissner.c64commander.hvsc.MemoryBudget

class HvscSevenZipRuntimeTest {
  private val extractor = DefaultHvscArchiveExtractor {
    HostSevenZipBinaryProvider.requireExecutable()
  }

  @Test
  fun `upstream seven zip runtime command is available`() {
    val executable = HostSevenZipBinaryProvider.requireExecutable()
    assertTrue(executable.exists())
    assertTrue(executable.canExecute())
  }

  @Test
  fun `seven zip fixture can be probed and extracted`() {
    val fixture = java.io.File("src/test/fixtures/HVSC_LZMA2_tiny.7z")
    assertTrue("Fixture archive missing: ${fixture.absolutePath}", fixture.exists())

    val profile = extractor.probe(fixture, HvscArchiveMode.BASELINE)
    assertEquals("7z", profile.format)
    assertEquals("LZMA2:12", profile.methodChain)

    val outputDir = createTempDir(prefix = "hvsc-runtime-")
    try {
      val result =
              extractor.extract(
                      archiveFile = fixture,
                      outputDir = outputDir,
                      mode = HvscArchiveMode.BASELINE,
                      cancellationToken = AtomicBoolean(false),
                      memoryBudget =
                              MemoryBudget(
                                      maxExtractionBytes = 256L * 1024L * 1024L,
                                      detail = "fixture"
                              ),
              )

      assertEquals(1, result.songsIngested)
      assertTrue(result.failedPaths.isEmpty())
      assertTrue(
              result.extractedSongs.single().virtualPath.endsWith("/MUSICIANS/T/Tester/Tiny.sid")
      )
    } finally {
      outputDir.deleteRecursively()
    }
  }
}
