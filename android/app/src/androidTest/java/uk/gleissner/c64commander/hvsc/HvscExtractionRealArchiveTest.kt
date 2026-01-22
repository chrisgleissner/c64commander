package uk.gleissner.c64commander.hvsc

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class HvscExtractionRealArchiveTest {
  @Test
  fun extractsRealHvscArchiveWhenPresent() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val targetContext = instrumentation.targetContext

    val expectedPath = HvscExtractionTestUtils.resolveOptionalRealArchivePath("HVSC_Update_84.7z")
    if (!expectedPath.exists()) {
      println(
        "INFO: Skipping HVSC_Update_84.7z extraction test - file not present: ${expectedPath.absolutePath}",
      )
      return
    }

    val archive = HvscExtractionTestUtils.copyFileToCache(targetContext, expectedPath)
    val targetDir = File(targetContext.cacheDir, "hvsc_real_extract")
    HvscExtractionTestUtils.createCleanDir(targetDir)

    val extractor = Hvsc7ZipJBindingExtractor()
    val result = extractor.extractAll(archive, targetDir)

    assertTrue("Expected extracted files > 0", result.extractedFiles > 0)
    assertTrue("Expected extracted bytes > 0", result.extractedBytes > 0)

    val sentinel = File(targetDir, "update/new/DEMOS/0-9/8-Bit_Bard.sid")
    assertTrue("Expected sentinel SID to exist", sentinel.exists())
    assertTrue("Expected sentinel SID to be non-empty", sentinel.length() > 0)
  }
}
