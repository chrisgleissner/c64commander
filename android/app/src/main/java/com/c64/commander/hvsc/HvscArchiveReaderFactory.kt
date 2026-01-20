package com.c64.commander.hvsc

import java.io.File

object HvscArchiveReaderFactory {
  fun open(archiveFile: File, password: CharArray?): HvscArchiveReader {
    val lowered = archiveFile.name.lowercase()
    return when {
      lowered.endsWith(".zip") -> ZipArchiveReader(archiveFile)
      SevenZipJBindingArchiveReader.isAvailable() -> SevenZipJBindingArchiveReader(archiveFile, password)
      else -> SevenZArchiveReader(archiveFile, password)
    }
  }
}
