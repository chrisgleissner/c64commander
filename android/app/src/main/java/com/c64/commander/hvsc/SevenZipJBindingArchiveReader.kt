package com.c64.commander.hvsc

import net.sf.sevenzipjbinding.ArchiveFormat
import net.sf.sevenzipjbinding.ExtractOperationResult
import net.sf.sevenzipjbinding.ISequentialOutStream
import net.sf.sevenzipjbinding.SevenZip
import net.sf.sevenzipjbinding.impl.RandomAccessFileInStream
import net.sf.sevenzipjbinding.simple.ISimpleInArchive
import net.sf.sevenzipjbinding.simple.ISimpleInArchiveItem
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile

class SevenZipJBindingArchiveReader(
  archiveFile: File,
  password: CharArray?,
) : HvscArchiveReader {
  private val passwordString = password?.let { String(it) }
  private val randomAccessFile = RandomAccessFile(archiveFile, "r")
  private val inStream = RandomAccessFileInStream(randomAccessFile)
  private val archive = run {
    check(isAvailable()) { "7-Zip JBinding is not available on this runtime." }
    if (passwordString != null) {
      SevenZip.openInArchive(ArchiveFormat.SEVEN_ZIP, inStream, passwordString)
    } else {
      SevenZip.openInArchive(ArchiveFormat.SEVEN_ZIP, inStream)
    }
  }
  private val simpleArchive: ISimpleInArchive = archive.simpleInterface
  private var index = 0
  private var currentItem: ISimpleInArchiveItem? = null

  override fun nextEntry(): HvscArchiveReader.Entry? {
    if (index >= simpleArchive.numberOfItems) {
      currentItem = null
      return null
    }
    val item = simpleArchive.getArchiveItem(index)
    index += 1
    currentItem = item
    return HvscArchiveReader.Entry(
      name = item.path ?: "",
      size = item.size ?: 0L,
      isDirectory = item.isFolder,
    )
  }

  override fun readEntryBytes(): ByteArray {
    val item = currentItem ?: return ByteArray(0)
    if (item.isFolder) return ByteArray(0)
    val output = ByteArrayOutputStream()
    val result = if (passwordString != null) {
      item.extractSlow(ISequentialOutStream { data ->
        output.write(data)
        data.size
      }, passwordString)
    } else {
      item.extractSlow(ISequentialOutStream { data ->
        output.write(data)
        data.size
      })
    }
    if (result != ExtractOperationResult.OK) {
      throw IllegalStateException("7-Zip extraction failed: $result")
    }
    return output.toByteArray()
  }

  override fun close() {
    try {
      archive.close()
    } finally {
      try {
        inStream.close()
      } finally {
        randomAccessFile.close()
      }
    }
  }

  companion object {
    @Volatile
    private var available: Boolean? = null

    fun isAvailable(): Boolean {
      val cached = available
      if (cached != null) return cached
      val resolved = if (!isAndroidRuntime()) {
        false
      } else {
        try {
          SevenZip.initSevenZipFromPlatformJAR()
          true
        } catch (_: Throwable) {
          false
        }
      }
      available = resolved
      return resolved
    }

    private fun isAndroidRuntime(): Boolean {
      val runtimeName = System.getProperty("java.runtime.name") ?: ""
      val vmName = System.getProperty("java.vm.name") ?: ""
      return runtimeName.contains("Android", ignoreCase = true) ||
        vmName.contains("Dalvik", ignoreCase = true) ||
        vmName.contains("ART", ignoreCase = true)
    }
  }
}
