package com.c64.commander

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SevenZExtractorTest {
  @Test
  fun extractsHvscUpdateArchive() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val archiveFile = File(context.filesDir, "hvsc-update.7z")
    val targetDir = File(context.filesDir, "hvsc-update-out")
    val url = URL("https://hvsc.brona.dk/HVSC/HVSC_Update_84.7z")

    if (archiveFile.exists()) {
      archiveFile.delete()
    }
    if (targetDir.exists()) {
      targetDir.deleteRecursively()
    }
    targetDir.mkdirs()

    val connection = url.openConnection() as HttpURLConnection
    connection.connectTimeout = 20000
    connection.readTimeout = 20000
    connection.inputStream.use { input ->
      archiveFile.outputStream().use { output ->
        input.copyTo(output)
      }
    }

    val extractor = SevenZExtractor()
    extractor.extract(archiveFile, targetDir, null)

    val extracted = File(targetDir, "update/DOCUMENTS/Songlengths.md5")
    assertTrue(extracted.exists())
  }
}
