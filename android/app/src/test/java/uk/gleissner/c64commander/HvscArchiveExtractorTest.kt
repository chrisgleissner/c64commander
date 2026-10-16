package uk.gleissner.c64commander

import java.io.File
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertArrayEquals
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
    val archive = File.createTempFile("hvsc-zip-slip-", ".zip")
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
    val archive = File.createTempFile("hvsc-update-", ".zip")
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

    val outputDir = Files.createTempDirectory("hvsc-update-out-").toFile()
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
  fun `extraction hands over each song's first 124 header bytes, and all of a shorter file`() {
    val psidV3 =
            ByteArray(124 + 64) { index -> if (index < 124) 0 else 0xEA.toByte() }.also { bytes ->
              "PSID".toByteArray(Charsets.US_ASCII).copyInto(bytes, 0)
              bytes[0x05] = 3
              bytes[0x07] = 0x7C
              bytes[0x0F] = 5
              bytes[0x11] = 3
              "Stereo Tune".toByteArray(Charsets.US_ASCII).copyInto(bytes, 0x16)
              bytes[0x16 + 11] = 0x99.toByte()
              "1987 Firebird".toByteArray(Charsets.US_ASCII).copyInto(bytes, 0x56)
              bytes[0x77] = 0x6C
              bytes[0x7A] = 0x42
            }
    val truncated = "PSID".toByteArray(Charsets.US_ASCII)
    val archive = File.createTempFile("hvsc-headers-", ".zip")
    ZipOutputStream(archive.outputStream()).use { zip ->
      zip.putNextEntry(ZipEntry("C64Music/MUSICIANS/H/Hubbard_Rob/Stereo.sid"))
      zip.write(psidV3)
      zip.closeEntry()
      zip.putNextEntry(ZipEntry("C64Music/MUSICIANS/T/Tester/Truncated.sid"))
      zip.write(truncated)
      zip.closeEntry()
    }

    val outputDir = Files.createTempDirectory("hvsc-headers-out-").toFile()
    try {
      val songs =
              extractor
                      .extract(
                              archiveFile = archive,
                              outputDir = outputDir,
                              mode = HvscArchiveMode.BASELINE,
                              cancellationToken = AtomicBoolean(false),
                              memoryBudget =
                                      MemoryBudget(
                                              maxExtractionBytes = 256L * 1024L * 1024L,
                                              detail = "zip fixture"
                                      ),
                      )
                      .extractedSongs
                      .associateBy { it.virtualPath }

      val stereo = songs.getValue("/MUSICIANS/H/Hubbard_Rob/Stereo.sid")
      assertArrayEquals(psidV3.copyOf(124), stereo.sidHeader)
      assertEquals(5, stereo.songs)
      assertEquals(3, stereo.startSong)
      val short = songs.getValue("/MUSICIANS/T/Tester/Truncated.sid")
      assertArrayEquals(truncated, short.sidHeader)
      assertEquals(null, short.songs)
    } finally {
      outputDir.deleteRecursively()
      archive.delete()
    }
  }

  @Test
  fun `cancellation stops long running seven zip extraction`() {
    val script = File.createTempFile("fake-7zz-", ".sh")
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
    val archive = File.createTempFile("fake-archive-", ".7z")
    archive.writeText("placeholder")
    val outputDir = Files.createTempDirectory("hvsc-cancel-out-").toFile()
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

  @Test
  fun `cancellation stops a wedged seven zip probe (HARD9-074)`() {
    // Regression: probeSevenZipArchive ("7zz l -slt") previously had no
    // cancellation monitor at all, unlike extractSevenZipToRawTree ("7zz x").
    // A pathological/wedged archive would block probe()'s useLines/waitFor
    // indefinitely, and cancelIngestion() had nothing to kill - every retry
    // rejected with "HVSC ingestion already running" until the app was
    // force-stopped. This fake 7zz script's "l" branch hangs the way a
    // wedged real probe would.
    val script = File.createTempFile("fake-7zz-probe-", ".sh")
    script.writeText(
            "#!/usr/bin/env bash\n" +
                    "set -euo pipefail\n" +
                    "if [[ \"$1\" == \"l\" ]]; then\n" +
                    "  for i in $(seq 1 1000); do\n" +
                    "    sleep 0.01\n" +
                    "  done\n" +
                    "  exit 0\n" +
                    "fi\n" +
                    "exit 1\n"
    )
    script.setExecutable(true)

    val localExtractor = DefaultHvscArchiveExtractor { script }
    val archive = File.createTempFile("fake-archive-probe-", ".7z")
    archive.writeText("placeholder")
    val cancellationToken = AtomicBoolean(false)

    try {
      val thread = Thread {
        try {
          localExtractor.probe(archive, HvscArchiveMode.BASELINE, cancellationToken)
        } catch (_: java.util.concurrent.CancellationException) {}
      }
      thread.start()
      Thread.sleep(50)
      cancellationToken.set(true)
      thread.join(2000)
      assertTrue("Expected probe thread to stop after cancellation", !thread.isAlive)
    } finally {
      archive.delete()
      script.delete()
    }
  }
}
