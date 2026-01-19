package com.c64.commander.hvsc

import java.io.File

object HvscArchiveReaderFactory {
  fun open(archiveFile: File, password: CharArray?): HvscArchiveReader {
    return if (SevenZipJBindingArchiveReader.isAvailable()) {
      SevenZipJBindingArchiveReader(archiveFile, password)
    } else {
      SevenZArchiveReader(archiveFile, password)
    }
  }
}
