package uk.gleissner.c64commander.hvsc

import java.io.Closeable

interface HvscArchiveReader : Closeable {
  data class Entry(
    val name: String,
    val size: Long,
    val isDirectory: Boolean,
  )

  fun nextEntry(): Entry?
  fun readEntryBytes(): ByteArray
}
