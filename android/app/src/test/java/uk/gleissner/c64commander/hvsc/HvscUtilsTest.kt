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
  fun songlengthsParserParsesTextFormat() {
    val content = """
      /DEMOS/0-9/10_Orbyte.sid 0:25
      /DEMOS/0-9/20_Second.sid 1:05
    """.trimIndent()

    val result = SonglengthsParser.parseText(content)
    assertEquals(25, result.pathToSeconds["/DEMOS/0-9/10_Orbyte.sid"])
    assertEquals(65, result.pathToSeconds["/DEMOS/0-9/20_Second.sid"])
    assertTrue(result.md5ToSeconds.isEmpty())
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

  @Test
  fun archiveReaderFactorySelectsDirectoryReader() {
    val tempDir = Files.createTempDirectory("hvsc-dir").toFile()
    val file = File(tempDir, "demo.sid")
    file.writeBytes(byteArrayOf(1, 2, 3))

    val reader = HvscArchiveReaderFactory.open(tempDir, null)
    assertTrue(reader is DirectoryArchiveReader)
    val entry = reader.nextEntry()
    assertNotNull(entry)
    val bytes = reader.readEntryBytes()
    assertArrayEquals(byteArrayOf(1, 2, 3), bytes)
    reader.close()
  }
}
