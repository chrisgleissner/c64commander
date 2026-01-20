package com.c64.commander.hvsc

import net.sf.sevenzipjbinding.ArchiveFormat
import net.sf.sevenzipjbinding.IInArchive
import net.sf.sevenzipjbinding.PropID
import net.sf.sevenzipjbinding.SevenZip
import net.sf.sevenzipjbinding.impl.RandomAccessFileInStream
import org.apache.commons.compress.archivers.sevenz.SevenZFile
import org.tukaani.xz.LZMA2Options
import java.io.File
import java.io.RandomAccessFile
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipFile

object HvscArchiveInspector {
  data class Inspection(
    val archiveName: String,
    val archiveType: String,
    val totalEntries: Int,
    val sidEntries: Int,
    val hasSonglengths: Boolean,
    val hasDeletionList: Boolean,
    val compressionMethods: Set<String>,
    val dictionaryBytes: List<Int>,
    val solid: Boolean?,
    val encrypted: Boolean?,
  ) {
    val hasMixedMethods: Boolean = compressionMethods.size > 1
    val maxDictionaryBytes: Int? = dictionaryBytes.maxOrNull()
  }

  fun inspect(archiveFile: File): Inspection {
    val name = archiveFile.name
    val lowered = name.lowercase(Locale.getDefault())
    return when {
      lowered.endsWith(".7z") -> inspectSevenZ(archiveFile)
      lowered.endsWith(".zip") -> inspectZip(archiveFile)
      else -> throw IllegalStateException("Unsupported archive format: $name")
    }
  }

  private fun inspectSevenZ(archiveFile: File): Inspection {
    return if (SevenZipJBindingArchiveReader.isAvailable()) {
      inspectSevenZWithJBinding(archiveFile)
    } else {
      inspectSevenZWithCommons(archiveFile)
    }
  }

  private fun inspectSevenZWithJBinding(archiveFile: File): Inspection {
    val randomAccessFile = RandomAccessFile(archiveFile, "r")
    val inStream = RandomAccessFileInStream(randomAccessFile)
    val archive = SevenZip.openInArchive(ArchiveFormat.SEVEN_ZIP, inStream)
    try {
      val simple = archive.simpleInterface
      var total = 0
      var sidCount = 0
      var hasSonglengths = false
      var hasDeletionList = false
      val methods = mutableSetOf<String>()
      val dictionaryBytes = mutableListOf<Int>()
      var encrypted = archiveProperty(archive, "ENCRYPTED") as? Boolean
      val solid = archiveProperty(archive, "SOLID") as? Boolean
      val archiveMethod = archiveProperty(archive, "METHOD")?.toString()
      if (!archiveMethod.isNullOrBlank()) {
        methods.add(archiveMethod)
        dictionaryBytes.addAll(parseDictionarySizes(archiveMethod))
      }

      for (index in 0 until simple.numberOfItems) {
        val item = simple.getArchiveItem(index)
        if (item.isFolder) continue
        total += 1
        val entryName = normalizeEntryName(item.path ?: "")
        val lowered = entryName.lowercase(Locale.getDefault())
        if (lowered.endsWith(".sid")) sidCount += 1
        if (lowered.endsWith("/songlengths.md5")) hasSonglengths = true
        if (isDeletionList(entryName)) hasDeletionList = true
        if (encrypted != true) {
          encrypted = safeBooleanProperty(item, "isEncrypted") ?: encrypted
        }
      }

      return Inspection(
        archiveName = archiveFile.name,
        archiveType = "7z",
        totalEntries = total,
        sidEntries = sidCount,
        hasSonglengths = hasSonglengths,
        hasDeletionList = hasDeletionList,
        compressionMethods = methods,
        dictionaryBytes = dictionaryBytes,
        solid = solid,
        encrypted = encrypted,
      )
    } finally {
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
  }

  private fun inspectSevenZWithCommons(archiveFile: File): Inspection {
    var total = 0
    var sidCount = 0
    var hasSonglengths = false
    var hasDeletionList = false
    val methods = mutableSetOf<String>()
    val dictionaryBytes = mutableListOf<Int>()
    var encrypted: Boolean? = null

    SevenZFile(archiveFile).use { sevenZ ->
      var entry = sevenZ.nextEntry
      while (entry != null) {
        if (!entry.isDirectory) {
          total += 1
          val entryName = normalizeEntryName(entry.name)
          val lowered = entryName.lowercase(Locale.getDefault())
          if (lowered.endsWith(".sid")) sidCount += 1
          if (lowered.endsWith("/songlengths.md5")) hasSonglengths = true
          if (isDeletionList(entryName)) hasDeletionList = true
          encrypted = encrypted ?: safeBooleanProperty(entry, "isEncrypted")
          val contentMethods = entry.contentMethods
          contentMethods?.forEach { methodConfig ->
            methods.add(methodConfig.method.toString())
            val options = methodConfig.options
            if (options is LZMA2Options) {
              dictionaryBytes.add(options.dictSize)
            }
          }
        }
        drainEntry(sevenZ, entry)
        entry = sevenZ.nextEntry
      }
    }

    return Inspection(
      archiveName = archiveFile.name,
      archiveType = "7z",
      totalEntries = total,
      sidEntries = sidCount,
      hasSonglengths = hasSonglengths,
      hasDeletionList = hasDeletionList,
      compressionMethods = methods,
      dictionaryBytes = dictionaryBytes,
      solid = null,
      encrypted = encrypted,
    )
  }

  private fun inspectZip(archiveFile: File): Inspection {
    var total = 0
    var sidCount = 0
    var hasSonglengths = false
    var hasDeletionList = false
    val methods = mutableSetOf<String>()
    var encrypted: Boolean? = null

    ZipFile(archiveFile).use { zip ->
      val entries = zip.entries()
      while (entries.hasMoreElements()) {
        val entry = entries.nextElement()
        if (entry.isDirectory) continue
        total += 1
        val entryName = normalizeEntryName(entry.name)
        val lowered = entryName.lowercase(Locale.getDefault())
        if (lowered.endsWith(".sid")) sidCount += 1
        if (lowered.endsWith("/songlengths.md5")) hasSonglengths = true
        if (isDeletionList(entryName)) hasDeletionList = true
        encrypted = encrypted ?: safeBooleanProperty(entry, "isEncrypted")
        methods.add(
          when (entry.method) {
            ZipEntry.DEFLATED -> "DEFLATED"
            ZipEntry.STORED -> "STORED"
            else -> entry.method.toString()
          },
        )
      }
    }

    return Inspection(
      archiveName = archiveFile.name,
      archiveType = "zip",
      totalEntries = total,
      sidEntries = sidCount,
      hasSonglengths = hasSonglengths,
      hasDeletionList = hasDeletionList,
      compressionMethods = methods,
      dictionaryBytes = emptyList(),
      solid = null,
      encrypted = encrypted,
    )
  }

  private fun normalizeEntryName(raw: String): String {
    return raw.replace("\\", "/").trimStart('/')
  }

  private fun isDeletionList(path: String): Boolean {
    val lowered = path.lowercase(Locale.getDefault())
    return lowered.endsWith(".txt") && (lowered.contains("delete") || lowered.contains("remove"))
  }

  private fun drainEntry(sevenZ: SevenZFile, entry: org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry) {
    if (entry.size <= 0) return
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var remaining = entry.size
    while (remaining > 0) {
      val read = sevenZ.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
      if (read <= 0) break
      remaining -= read.toLong()
    }
  }

  private fun archiveProperty(archive: IInArchive, name: String): Any? {
    val prop = runCatching { enumValueOf<PropID>(name) }.getOrNull() ?: return null
    return runCatching { archive.getArchiveProperty(prop) }.getOrNull()
  }

  private fun safeBooleanProperty(target: Any, name: String): Boolean? {
    return runCatching { target.javaClass.getMethod(name).invoke(target) as? Boolean }.getOrNull()
  }

  private fun parseDictionarySizes(method: String): List<Int> {
    val matches = Regex("LZMA2:(\\d+)", RegexOption.IGNORE_CASE).findAll(method)
    val sizes = mutableListOf<Int>()
    matches.forEach { match ->
      val exponent = match.groupValues[1].toIntOrNull() ?: return@forEach
      sizes.add(1 shl exponent)
    }
    return sizes
  }
}
