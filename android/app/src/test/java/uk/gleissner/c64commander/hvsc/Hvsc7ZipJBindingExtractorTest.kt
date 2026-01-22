package uk.gleissner.c64commander.hvsc

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class Hvsc7ZipJBindingExtractorTest {
  @Test
  fun extractsMockFixtureArchiveOnJvm() {
    val fixture = resolveFixture("HVSC_Update_mock.7z")
    val targetDir = Files.createTempDirectory("hvsc_jvm_extract").toFile()
    try {
      val extractor = Hvsc7ZipJBindingExtractor()
      val result = extractor.extractAll(fixture, targetDir)

      assertTrue("Expected extracted files > 0", result.extractedFiles > 0)
      assertTrue("Expected extracted bytes > 0", result.extractedBytes > 0)

      val bugList = File(targetDir, "update/DOCUMENTS/BUGlist.txt")
      assertTrue("Expected BUGlist.txt to exist", bugList.exists())
      assertTrue("Expected BUGlist.txt to be non-empty", bugList.length() > 0)
    } finally {
      targetDir.deleteRecursively()
    }
  }

  private fun resolveFixture(name: String): File {
    val fixturesDir = System.getProperty("HVSC_FIXTURES_DIR")
    if (!fixturesDir.isNullOrBlank()) {
      val candidate = File(fixturesDir, name).absoluteFile
      if (candidate.exists()) return candidate
    }
    val modulePath = File("src/test/fixtures", name).absoluteFile
    if (modulePath.exists()) return modulePath

    val repoPath = File("android/app/src/test/fixtures", name).absoluteFile
    require(repoPath.exists()) { "Missing fixture: ${repoPath.absolutePath}" }
    return repoPath
  }
}
