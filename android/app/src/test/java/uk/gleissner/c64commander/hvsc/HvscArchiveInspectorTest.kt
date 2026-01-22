package uk.gleissner.c64commander.hvsc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class HvscArchiveInspectorTest {
  @get:Rule
  val tempFolder = TemporaryFolder()

  @Test
  fun inspectZipReportsSidCountsAndFlags() {
    val archive = tempFolder.newFile("hvsc-baseline-99.zip")
    ZipOutputStream(archive.outputStream().buffered()).use { output ->
      output.putNextEntry(ZipEntry("C64Music/Demos/Test.sid"))
      output.write(byteArrayOf(1, 2, 3))
      output.closeEntry()
      output.putNextEntry(ZipEntry("C64Music/Songlengths.md5"))
      output.write("; /Demos/Test.sid\nabc=0:10".toByteArray())
      output.closeEntry()
      output.putNextEntry(ZipEntry("C64Music/delete-list.txt"))
      output.write("Demos/Old.sid".toByteArray())
      output.closeEntry()
    }

    val inspection = HvscArchiveInspector.inspect(archive)

    assertEquals("zip", inspection.archiveType)
    assertEquals(3, inspection.totalEntries)
    assertEquals(1, inspection.sidEntries)
    assertTrue(inspection.hasSonglengths)
    assertTrue(inspection.hasDeletionList)
    assertTrue(inspection.compressionMethods.isNotEmpty())
  }
}