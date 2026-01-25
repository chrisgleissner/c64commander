package uk.gleissner.c64commander.hvsc

import java.io.File

class DirectoryArchiveReader(private val rootDir: File) : HvscArchiveReader {
  private val iterator: Iterator<File>
  private var currentFile: File? = null

  init {
    if (!rootDir.exists() || !rootDir.isDirectory) {
      throw IllegalArgumentException("${rootDir.absolutePath} is not a directory")
    }
    iterator = rootDir.walkTopDown().filter { it.isFile }.iterator()
  }

  override fun nextEntry(): HvscArchiveReader.Entry? {
    if (!iterator.hasNext()) {
      currentFile = null
      return null
    }
    val file = iterator.next()
    currentFile = file
    val relative = rootDir.toPath().relativize(file.toPath()).toString().replace(File.separatorChar, '/')
    return HvscArchiveReader.Entry(
      name = relative,
      size = file.length(),
      isDirectory = false,
    )
  }

  override fun readEntryBytes(): ByteArray {
    val file = currentFile ?: return ByteArray(0)
    return file.readBytes()
  }

  override fun close() {
    // No-op for directory reader.
  }
}
