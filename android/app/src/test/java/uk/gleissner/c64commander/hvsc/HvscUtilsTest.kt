package uk.gleissner.c64commander.hvsc

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class HvscUtilsTest {
  @Test
  fun songlengthsParserExtractsPathAndMd5() {
    val content = """
      ; /DEMOS/0-9/10_Orbyte.sid
      0123456789abcdef=1:23.456
    """.trimIndent()

    val result = SonglengthsParser.parse(content)
    assertEquals(83, result.pathToSeconds["/DEMOS/0-9/10_Orbyte.sid"])
    assertEquals(83, result.md5ToSeconds["0123456789abcdef"])
  }

  @Test
  fun cancelRegistryCancelsAndRemovesToken() {
    val registry = HvscCancelRegistry()
    val token = registry.register("demo")
    assertFalse(token.isCancelled())
    registry.cancel("demo")
    assertTrue(token.isCancelled())
    registry.remove("demo")
  }

  @Test
  fun archiveReaderFactorySelectsZipReader() {
    val tempDir = Files.createTempDirectory("hvsc-zip").toFile()
    val zipFile = File(tempDir, "hvsc.zip")
    ZipOutputStream(zipFile.outputStream()).use { output ->
      val entry = ZipEntry("demo.sid")
      output.putNextEntry(entry)
      output.write(byteArrayOf(1, 2, 3))
      output.closeEntry()
    }

    val reader = HvscArchiveReaderFactory.open(zipFile, null)
    assertTrue(reader is ZipArchiveReader)
    reader.close()
  }

  @Test
  fun zipArchiveReaderReadsEntriesAndBytes() {
    val tempDir = Files.createTempDirectory("hvsc-zip2").toFile()
    val zipFile = File(tempDir, "content.zip")
    ZipOutputStream(zipFile.outputStream()).use { output ->
      output.putNextEntry(ZipEntry("folder/"))
      output.closeEntry()
      val entry = ZipEntry("folder/demo.sid")
      output.putNextEntry(entry)
      output.write(byteArrayOf(5, 6, 7, 8))
      output.closeEntry()
    }

    val reader = ZipArchiveReader(zipFile)
    val first = reader.nextEntry()
    assertNotNull(first)
    val second = reader.nextEntry()
    assertNotNull(second)
    val bytes = reader.readEntryBytes()
    assertArrayEquals(byteArrayOf(5, 6, 7, 8), bytes)
    reader.close()
  }
}
