package uk.gleissner.c64commander.hvsc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class HvscDownloaderTest {
  @Test
  fun downloadWritesFileAndEmitsProgress() {
    val payload = ByteArray(1024) { 1 }
    val url = "mock://download"
    MockUrlStreamHandler.register(url, payload)

    val tempDir = Files.createTempDirectory("hvsc-download").toFile()
    val target = File(tempDir, "payload.bin")
    val progressEvents = mutableListOf<DownloadProgress>()
    val downloader = HvscDownloader()
    downloader.download(url, target) {
      progressEvents.add(it)
    }

    assertTrue(target.exists())
    assertEquals(payload.size.toLong(), target.length())
    assertTrue(progressEvents.isNotEmpty())
    assertTrue(progressEvents.last().percent == 100)

    MockUrlStreamHandler.clear(url)
  }
}
