package uk.gleissner.c64commander.hvsc

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class HvscExtractionFixtureTest {
  @Test
  fun extractsMockFixtureArchive() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val testContext = instrumentation.context
    val targetContext = instrumentation.targetContext

    val archive = HvscExtractionTestUtils.copyFixtureToCache(
      testContext = testContext,
      targetContext = targetContext,
      fixtureName = "HVSC_Update_mock.7z",
    )

    val targetDir = File(targetContext.cacheDir, "hvsc_mock_extract")
    HvscExtractionTestUtils.createCleanDir(targetDir)

    val extractor = Hvsc7ZipJBindingExtractor()
    val result = extractor.extractAll(archive, targetDir)

    assertTrue("Expected extracted files > 0", result.extractedFiles > 0)
    assertTrue("Expected extracted bytes > 0", result.extractedBytes > 0)

    val bugList = File(targetDir, "update/DOCUMENTS/BUGlist.txt")
    assertTrue("Expected BUGlist.txt to exist", bugList.exists())
    assertTrue("Expected BUGlist.txt to be non-empty", bugList.length() > 0)

    val updateAnnouncement = File(targetDir, "update/DOCUMENTS/Update_Announcements/20251225.txt")
    assertTrue("Expected update announcement to exist", updateAnnouncement.exists())
    assertTrue("Expected update announcement to be non-empty", updateAnnouncement.length() > 0)

    val sentinelSid = File(targetDir, "update/fix/MUSICIANS/A/Adrock_and_Deadeye/James_Bond.sid")
    if (sentinelSid.exists()) {
      assertTrue("Expected sentinel SID to be non-empty", sentinelSid.length() > 0)
    } else {
      println("INFO: Fixture SID sentinel not present in HVSC_Update_mock.7z")
    }
  }
}
