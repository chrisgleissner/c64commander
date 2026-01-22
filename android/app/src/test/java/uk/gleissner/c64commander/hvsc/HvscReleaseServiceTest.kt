package uk.gleissner.c64commander.hvsc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HvscReleaseServiceTest {
  @Test
  fun fetchLatestVersionsParsesHtml() {
    val body = """
      <html>
        <a href=\"HVSC_83-all-of-them.7z\">HVSC_83-all-of-them.7z</a>
        <a href=\"HVSC_84-all-of-them.7z\">HVSC_84-all-of-them.7z</a>
        <a href=\"HVSC_Update_84.7z\">HVSC_Update_84.7z</a>
        <a href=\"HVSC_Update_85.7z\">HVSC_Update_85.7z</a>
      </html>
    """.trimIndent()
    val url = "mock://hvsc/"
    MockUrlStreamHandler.register(url, body.toByteArray())

    val service = HvscReleaseService(url)
    val (baseline, update) = service.fetchLatestVersions()
    assertEquals(84, baseline)
    assertEquals(85, update)
    assertTrue(service.buildBaselineUrl(84).contains("HVSC_84-all-of-them.7z"))
    assertTrue(service.buildUpdateUrl(85).contains("HVSC_Update_85.7z"))

    MockUrlStreamHandler.clear(url)
  }
}
