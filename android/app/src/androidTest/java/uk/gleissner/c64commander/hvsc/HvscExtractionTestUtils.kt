package uk.gleissner.c64commander.hvsc

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileOutputStream

object HvscExtractionTestUtils {
  private const val ARG_FIXTURES_DIR = "HVSC_FIXTURES_DIR"
  private const val ARG_REAL_ARCHIVE_PATH = "HVSC_84_PATH"

  fun createCleanDir(dir: File) {
    if (dir.exists()) {
      dir.deleteRecursively()
    }
    if (!dir.mkdirs()) {
      throw IllegalStateException("Failed to create directory: ${dir.absolutePath}")
    }
  }

  fun copyFixtureToCache(testContext: Context, targetContext: Context, fixtureName: String): File {
    val destination = File(targetContext.cacheDir, fixtureName)
    if (destination.exists()) return destination

    val diskFixture = resolveFixtureOnDisk(fixtureName)
    if (diskFixture != null && diskFixture.exists()) {
      diskFixture.copyTo(destination, overwrite = true)
      return destination
    }

    testContext.assets.open(fixtureName).use { input ->
      FileOutputStream(destination).use { output ->
        input.copyTo(output)
      }
    }
    return destination
  }

  fun resolveOptionalRealArchivePath(fixtureName: String): File {
    val args = InstrumentationRegistry.getArguments()
    val argPath = args.getString(ARG_REAL_ARCHIVE_PATH)
    if (!argPath.isNullOrBlank()) {
      return File(argPath).absoluteFile
    }

    val sysPath = System.getProperty(ARG_REAL_ARCHIVE_PATH)
    if (!sysPath.isNullOrBlank()) {
      return File(sysPath).absoluteFile
    }

    val fixturesDirArg = args.getString(ARG_FIXTURES_DIR)
    if (!fixturesDirArg.isNullOrBlank()) {
      return File(fixturesDirArg, fixtureName).absoluteFile
    }

    val sysFixturesDir = System.getProperty(ARG_FIXTURES_DIR)
    if (!sysFixturesDir.isNullOrBlank()) {
      return File(sysFixturesDir, fixtureName).absoluteFile
    }

    return File("android/app/src/test/fixtures/$fixtureName").absoluteFile
  }

  fun copyFileToCache(targetContext: Context, source: File): File {
    val destination = File(targetContext.cacheDir, source.name)
    if (destination.exists()) return destination
    source.copyTo(destination, overwrite = true)
    return destination
  }

  private fun resolveFixtureOnDisk(fixtureName: String): File? {
    val args = InstrumentationRegistry.getArguments()
    val fixturesDirArg = args.getString(ARG_FIXTURES_DIR)
    if (!fixturesDirArg.isNullOrBlank()) {
      return File(fixturesDirArg, fixtureName).absoluteFile
    }

    val sysFixturesDir = System.getProperty(ARG_FIXTURES_DIR)
    if (!sysFixturesDir.isNullOrBlank()) {
      return File(sysFixturesDir, fixtureName).absoluteFile
    }

    val defaultPath = File("android/app/src/test/fixtures/$fixtureName").absoluteFile
    return defaultPath
  }
}
