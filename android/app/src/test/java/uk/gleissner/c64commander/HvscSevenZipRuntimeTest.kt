package uk.gleissner.c64commander

import org.apache.commons.compress.archivers.sevenz.SevenZFile
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class HvscSevenZipRuntimeTest {

  @Test
  fun `xz lzma2 runtime class is available`() {
    val clazz = Class.forName("org.tukaani.xz.LZMA2Options")
    assertTrue(clazz.name == "org.tukaani.xz.LZMA2Options")
  }

  @Test
  fun `seven zip fixture can be opened and enumerated`() {
    val fixture = File("src/test/fixtures/HVSC_LZMA2_tiny.7z")
    assertTrue("Fixture archive missing: ${fixture.absolutePath}", fixture.exists())

    SevenZFile(fixture).use { sevenZip ->
      var entryCount = 0
      var sawSid = false
      var entry = sevenZip.nextEntry
      while (entry != null) {
        if (!entry.isDirectory) {
          entryCount += 1
          if ((entry.name ?: "").endsWith(".sid", ignoreCase = true)) {
            sawSid = true
          }
        }
        entry = sevenZip.nextEntry
      }
      assertTrue("Expected at least one archive entry", entryCount > 0)
      assertTrue("Expected at least one SID entry", sawSid)
    }
  }
}
