package uk.gleissner.c64commander

import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.gleissner.c64commander.hvsc.DefaultHvscArchiveExtractor
import uk.gleissner.c64commander.hvsc.HvscArchiveMode
import uk.gleissner.c64commander.hvsc.MemoryBudget

class HvscArchiveExtractorTest {
  private val extractor = DefaultHvscArchiveExtractor {
    HostSevenZipBinaryProvider.requireExecutable()
  }

  @Test
  fun `zip extraction rejects path traversal entries`() {
    val archive = createTempFile(prefix = "hvsc-zip-slip-", suffix = ".zip")
    ZipOutputStream(archive.outputStream()).use { zip ->
      zip.putNextEntry(ZipEntry("../escape.sid"))
      zip.write(
              byteArrayOf(
                      'P'.code.toByte(),
                      'S'.code.toByte(),
                      'I'.code.toByte(),
                      'D'.code.toByte()
              )
      )
      zip.closeEntry()
    }

    try {
      val error =
              org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
                extractor.probe(archive, HvscArchiveMode.BASELINE)
              }
      assertTrue(error.message?.contains("escapes the HVSC library root") == true)
    } finally {
      archive.delete()
    }
  }

  @Test
  fun `zip extraction preserves normalized update paths and parses sid metadata`() {
    val archive = createTempFile(prefix = "hvsc-update-", suffix = ".zip")
    ZipOutputStream(archive.outputStream()).use { zip ->
      zip.putNextEntry(ZipEntry("Update/HVSC/MUSICIANS/T/Tester/Tiny.sid"))
      zip.write(
              byteArrayOf(
                      'P'.code.toByte(),
                      'S'.code.toByte(),
                      'I'.code.toByte(),
                      'D'.code.toByte(),
                      0,
                      2,
                      0,
                      0x76,
                      0,
                      0,
                      0,
                      0,
                      0,
                      0x76,
                      0,
                      2,
                      0,
                      1,
              )
      )
      zip.closeEntry()
      zip.putNextEntry(ZipEntry("Update/HVSC/DOCUMENTS/songlengths.md5"))
      zip.write("abc  MUSICIANS/T/Tester/Tiny.sid\n".toByteArray())
      zip.closeEntry()
      zip.putNextEntry(ZipEntry("Update/HVSC/DOCUMENTS/delete-list.txt"))
      zip.write("MUSICIANS/T/Tester/Old.sid\n".toByteArray())
      zip.closeEntry()
    }

    val outputDir = createTempDir(prefix = "hvsc-update-out-")
    try {
      val result =
              extractor.extract(
                      archiveFile = archive,
                      outputDir = outputDir,
                      mode = HvscArchiveMode.UPDATE,
                      cancellationToken = AtomicBoolean(false),
                      memoryBudget =
                              MemoryBudget(
                                      maxExtractionBytes = 256L * 1024L * 1024L,
                                      detail = "zip fixture"
                              ),
              )

      assertEquals(1, result.songsIngested)
      assertEquals(1, result.songlengthFilesWritten)
      assertEquals(listOf("/MUSICIANS/T/Tester/Old.sid"), result.deletionPaths)
      assertEquals("/MUSICIANS/T/Tester/Tiny.sid", result.extractedSongs.single().virtualPath)
      assertEquals(2, result.extractedSongs.single().songs)
      assertEquals(1, result.extractedSongs.single().startSong)
      assertTrue(File(outputDir, "MUSICIANS/T/Tester/Tiny.sid").exists())
    } finally {
      outputDir.deleteRecursively()
      archive.delete()
    }
  }

  @Test
  fun `cancellation stops long running seven zip extraction`() {
    val script = createTempFile(prefix = "fake-7zz-", suffix = ".sh")
    script.writeText(
            "#!/usr/bin/env bash\n" +
                    "set -euo pipefail\n" +
                    "if [[ \"$1\" == \"l\" ]]; then\n" +
                    "  cat <<'EOF'\n" +
                    "Path = fake.7z\n" +
                    "Type = 7z\n" +
                    "Method = LZMA2:12\n" +
                    "Solid = -\n" +
                    "Blocks = 1\n" +
                    "----------\n" +
                    "Path = HVSC/MUSICIANS/T/Tester/Tiny.sid\n" +
                    "Size = 18\n" +
                    "Attributes = A\n" +
                    "Encrypted = -\n\n" +
                    "EOF\n" +
                    "  exit 0\n" +
                    "fi\n" +
                    "if [[ \"$1\" == \"x\" ]]; then\n" +
                    "  for i in $(seq 1 1000); do\n" +
                    "    echo \"- HVSC/MUSICIANS/T/Tester/Tiny\${i}.sid\"\n" +
                    "    sleep 0.01\n" +
                    "  done\n" +
                    "  exit 0\n" +
                    "fi\n" +
                    "exit 1\n"
    )
    script.setExecutable(true)

    val localExtractor = DefaultHvscArchiveExtractor { script }
    val archive = createTempFile(prefix = "fake-archive-", suffix = ".7z")
    archive.writeText("placeholder")
    val outputDir = createTempDir(prefix = "hvsc-cancel-out-")
    val cancellationToken = AtomicBoolean(false)

    try {
      val thread = Thread {
        try {
          localExtractor.extract(
                  archiveFile = archive,
                  outputDir = outputDir,
                  mode = HvscArchiveMode.BASELINE,
                  cancellationToken = cancellationToken,
                  memoryBudget =
                          MemoryBudget(maxExtractionBytes = 256L * 1024L * 1024L, detail = "fake"),
          )
        } catch (_: java.util.concurrent.CancellationException) {}
      }
      thread.start()
      Thread.sleep(50)
      cancellationToken.set(true)
      thread.join(2000)
      assertTrue("Expected extraction thread to stop after cancellation", !thread.isAlive)
    } finally {
      outputDir.deleteRecursively()
      archive.delete()
      script.delete()
    }
  }
}
