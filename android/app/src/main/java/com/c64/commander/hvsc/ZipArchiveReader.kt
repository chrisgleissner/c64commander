package uk.gleissner.c64commander.hvsc

import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipFile

class ZipArchiveReader(
  archiveFile: File,
) : HvscArchiveReader {
  private val zipFile = ZipFile(archiveFile)
  private val entries: List<ZipEntry> = buildList {
    val enumeration = zipFile.entries()
    while (enumeration.hasMoreElements()) {
      add(enumeration.nextElement())
    }
  }
  private var index = 0
  private var currentEntry: ZipEntry? = null

  override fun nextEntry(): HvscArchiveReader.Entry? {
    if (index >= entries.size) {
      currentEntry = null
      return null
    }
    val entry = entries[index]
    index += 1
    currentEntry = entry
    return HvscArchiveReader.Entry(
      name = entry.name,
      size = entry.size,
      isDirectory = entry.isDirectory,
    )
  }

  override fun readEntryBytes(): ByteArray {
    val entry = currentEntry ?: return ByteArray(0)
    if (entry.isDirectory) return ByteArray(0)
    zipFile.getInputStream(entry).use { input ->
      return input.readBytes()
    }
  }

  override fun close() {
    zipFile.close()
  }
}
