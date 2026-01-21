package uk.gleissner.c64commander.hvsc

import org.apache.commons.compress.archivers.sevenz.SevenZFile
import java.io.File

class SevenZArchiveReader(
  archiveFile: File,
  password: CharArray?,
) : HvscArchiveReader {
  private val sevenZ = if (password != null) SevenZFile(archiveFile, password) else SevenZFile(archiveFile)
  private var currentEntry: org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry? = null

  override fun nextEntry(): HvscArchiveReader.Entry? {
    val entry = sevenZ.nextEntry ?: return null
    currentEntry = entry
    return HvscArchiveReader.Entry(
      name = entry.name,
      size = entry.size,
      isDirectory = entry.isDirectory,
    )
  }

  override fun readEntryBytes(): ByteArray {
    val entry = currentEntry ?: return ByteArray(0)
    if (entry.size <= 0) return ByteArray(0)
    val buffer = ByteArray(entry.size.toInt())
    var offset = 0
    while (offset < buffer.size) {
      val read = sevenZ.read(buffer, offset, buffer.size - offset)
      if (read <= 0) break
      offset += read
    }
    return if (offset == buffer.size) buffer else buffer.copyOf(offset)
  }

  override fun close() {
    sevenZ.close()
  }
}
