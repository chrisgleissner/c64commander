package uk.gleissner.c64commander

import java.io.File

object HostSevenZipBinaryProvider {
  fun requireExecutable(): File {
    val configured = System.getenv("HVSC_7ZIP_BIN")?.trim().orEmpty()
    if (configured.isNotEmpty()) {
      val file = File(configured)
      check(file.exists() && file.canExecute()) {
        "Configured HVSC_7ZIP_BIN is not executable: ${file.absolutePath}"
      }
      return file
    }

    val pathEntries = System.getenv("PATH").orEmpty().split(File.pathSeparatorChar)
    listOf("7zz", "7z").forEach { name ->
      pathEntries.filter { it.isNotBlank() }.forEach { entry ->
        val file = File(entry, name)
        if (file.exists() && file.canExecute()) {
          return file
        }
      }
    }

    error("No host 7-Zip executable found on PATH. Install 7zz/7z or set HVSC_7ZIP_BIN.")
  }
}
