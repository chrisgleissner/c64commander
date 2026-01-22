package uk.gleissner.c64commander.hvsc

import net.sf.sevenzipjbinding.ArchiveFormat
import net.sf.sevenzipjbinding.ExtractOperationResult
import net.sf.sevenzipjbinding.ISequentialOutStream
import net.sf.sevenzipjbinding.SevenZip
import net.sf.sevenzipjbinding.impl.RandomAccessFileInStream
import net.sf.sevenzipjbinding.simple.ISimpleInArchiveItem
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile

class Hvsc7ZipJBindingExtractor : HvscArchiveExtractor {
  override fun extractAll(archiveFile: File, targetDir: File): ExtractionResult {
    ensureSevenZipAvailable()
    if (!archiveFile.exists()) {
      throw IllegalArgumentException("Archive not found: ${archiveFile.absolutePath}")
    }
    if (!targetDir.exists() && !targetDir.mkdirs()) {
      throw IllegalStateException("Failed to create extraction directory: ${targetDir.absolutePath}")
    }

    println("HVSC extraction starting: ${archiveFile.name} -> ${targetDir.absolutePath}")

    val randomAccessFile = RandomAccessFile(archiveFile, "r")
    val inStream = RandomAccessFileInStream(randomAccessFile)
    val archive = try {
      SevenZip.openInArchive(ArchiveFormat.SEVEN_ZIP, inStream)
    } catch (error: Throwable) {
      inStream.close()
      randomAccessFile.close()
      throw IllegalStateException(
        "Failed to open ${archiveFile.name} with 7-Zip JBinding. Ensure native codecs for PPMD/BCJ2/LZMA are available.",
        error,
      )
    }

    var extractedFiles = 0
    var extractedBytes = 0L

    try {
      val simple = archive.simpleInterface
      for (index in 0 until simple.numberOfItems) {
        val item = simple.getArchiveItem(index)
        if (item.isFolder) continue
        val safePath = sanitizeEntryPath(item)
        val outFile = File(targetDir, safePath)
        ensureSafeTarget(targetDir, outFile)
        val parent = outFile.parentFile
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
          throw IllegalStateException("Failed to create directory: ${parent.absolutePath}")
        }

        var bytesWritten = 0L
        FileOutputStream(outFile).use { output ->
          val result = item.extractSlow(ISequentialOutStream { data ->
            output.write(data)
            bytesWritten += data.size.toLong()
            data.size
          })
          if (result != ExtractOperationResult.OK) {
            throw IllegalStateException("7-Zip extraction failed for ${item.path ?: safePath}: $result")
          }
        }
        extractedFiles += 1
        extractedBytes += bytesWritten
      }
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

    println("HVSC extraction complete: files=$extractedFiles bytes=$extractedBytes")
    return ExtractionResult(extractedFiles, extractedBytes)
  }

  private fun ensureSevenZipAvailable() {
    try {
      SevenZip.initSevenZipFromPlatformJAR()
    } catch (error: Throwable) {
      throw IllegalStateException(
        "7-Zip JBinding is unavailable. Ensure native libraries/codecs (PPMD/BCJ2/LZMA) are packaged for this ABI.",
        error,
      )
    }
  }

  private fun sanitizeEntryPath(item: ISimpleInArchiveItem): String {
    val rawPath = item.path ?: ""
    val normalized = rawPath.replace('\\', '/').trim()
    if (normalized.isEmpty()) {
      throw IllegalArgumentException("Archive entry has empty path.")
    }
    if (normalized.startsWith('/')) {
      throw IllegalArgumentException("Archive entry path is absolute: $rawPath")
    }
    val colonIndex = normalized.indexOf(':')
    val slashIndex = normalized.indexOf('/')
    if (colonIndex >= 0 && (slashIndex == -1 || colonIndex < slashIndex)) {
      throw IllegalArgumentException("Archive entry path contains drive reference: $rawPath")
    }

    val segments = normalized.split('/').filter { it.isNotBlank() && it != "." }
    if (segments.any { it == ".." }) {
      throw IllegalArgumentException("Archive entry path attempts traversal: $rawPath")
    }
    val safePath = segments.joinToString("/")
    if (safePath.isBlank()) {
      throw IllegalArgumentException("Archive entry path resolves to empty: $rawPath")
    }
    return safePath
  }

  private fun ensureSafeTarget(targetDir: File, outFile: File) {
    val targetCanonical = targetDir.canonicalFile
    val outputCanonical = outFile.canonicalFile
    val targetPath = targetCanonical.path.trimEnd('/') + File.separator
    if (!outputCanonical.path.startsWith(targetPath)) {
      throw IllegalArgumentException("Archive entry resolves outside target directory: ${outFile.path}")
    }
  }
}
