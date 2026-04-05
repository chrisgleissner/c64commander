package uk.gleissner.c64commander

import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import org.junit.Assume.assumeTrue

object RealHvscArchiveProvider {
  const val ARCHIVE_NAME = "HVSC_84-all-of-them.7z"
  const val ARCHIVE_SHA256 = "9ed41b3a8759af5e1489841cd62682e471824892eabf648d913b0c9725a4d6d3"
  const val ARCHIVE_URL = "https://hvsc.sannic.nl/HVSC%2084/HVSC_84-all-of-them.7z"

  fun requireArchive(): File {
    val archive = resolveArchiveFile()
    assumeTrue(
            "Real HVSC archive missing at ${archive.absolutePath}. Run ./gradlew downloadHvscTestFixture or set HVSC_ARCHIVE_PATH.",
            archive.exists() && archive.isFile,
    )

    val actualChecksum = sha256(archive)
    check(actualChecksum.equals(ARCHIVE_SHA256, ignoreCase = true)) {
      "Unexpected HVSC archive at ${archive.absolutePath}. Expected sha256=$ARCHIVE_SHA256, got $actualChecksum"
    }

    return archive
  }

  private fun resolveArchiveFile(): File {
    val configuredPath = System.getenv("HVSC_ARCHIVE_PATH")?.trim().orEmpty()
    if (configuredPath.isNotEmpty()) {
      return File(configuredPath)
    }
    return File(File(System.getProperty("user.home"), ".cache/c64commander/hvsc"), ARCHIVE_NAME)
  }

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buffer = ByteArray(8192)
      while (true) {
        val read = input.read(buffer)
        if (read < 0) {
          break
        }
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString(separator = "") { "%02x".format(it) }
  }
}
