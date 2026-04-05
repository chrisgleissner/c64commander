package uk.gleissner.c64commander.hvsc

import android.os.Trace
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.ArrayDeque
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.ZipFile

private fun formatMiB(bytes: Long): String {
  return "%.1f".format(Locale.US, bytes.toDouble() / (1024.0 * 1024.0))
}

enum class HvscArchiveMode {
  BASELINE,
  UPDATE,
}

data class MemoryBudget(
        val maxExtractionBytes: Long,
        val detail: String,
)

data class ArchiveProfile(
        val format: String,
        val methodChain: String?,
        val dictionaryBytes: Long?,
        val solid: Boolean?,
        val blocks: Int?,
        val entryCount: Int,
        val fileCount: Int,
        val directoryCount: Int,
        val sidFileCount: Int,
        val songlengthFiles: Int,
        val encryptedEntries: Int,
        val uncompressedSizeBytes: Long,
        val estimatedRequiredBytes: Long,
)

data class ExtractedSong(
        val virtualPath: String,
        val fileName: String,
        val songs: Int?,
        val startSong: Int?,
)

data class ExtractionProgress(
        val processedEntries: Int,
        val totalEntries: Int?,
        val currentFile: String?,
        val songsExtracted: Int,
)

data class ExtractionResult(
        val profile: ArchiveProfile,
        val totalEntries: Int,
        val songsIngested: Int,
        val failedSongs: Int,
        val failedPaths: List<String>,
        val songlengthFilesWritten: Int,
        val deletionPaths: List<String>,
        val extractedSongs: List<ExtractedSong>,
)

class InsufficientMemoryException(
        val requiredBytes: Long,
        val maxExtractionBytes: Long,
        detail: String,
) :
        IllegalStateException(
                "HVSC extraction requires about ${formatMiB(requiredBytes)} MiB but the safe budget is ${formatMiB(maxExtractionBytes)} MiB ($detail)",
        )

interface HvscArchiveExtractor {
  fun probe(archiveFile: File, mode: HvscArchiveMode): ArchiveProfile

  fun extract(
          archiveFile: File,
          outputDir: File,
          mode: HvscArchiveMode,
          cancellationToken: AtomicBoolean,
          memoryBudget: MemoryBudget,
          onProgress: (ExtractionProgress) -> Unit = {},
  ): ExtractionResult
}

class DefaultHvscArchiveExtractor(
        private val sevenZipExecutableProvider: () -> File? = { null },
) : HvscArchiveExtractor {
  override fun probe(archiveFile: File, mode: HvscArchiveMode): ArchiveProfile {
    Trace.beginSection("hvsc:probe")
    try {
      require(archiveFile.exists() && archiveFile.isFile) {
        "Archive file not found: ${archiveFile.absolutePath}"
      }
      return when {
        archiveFile.name.endsWith(".7z", ignoreCase = true) ->
                probeSevenZipArchive(archiveFile, mode)
        archiveFile.name.endsWith(".zip", ignoreCase = true) -> probeZipArchive(archiveFile, mode)
        else -> throw IllegalStateException("Unsupported archive format: ${archiveFile.name}")
      }
    } finally {
      Trace.endSection()
    }
  }

  override fun extract(
          archiveFile: File,
          outputDir: File,
          mode: HvscArchiveMode,
          cancellationToken: AtomicBoolean,
          memoryBudget: MemoryBudget,
          onProgress: (ExtractionProgress) -> Unit,
  ): ExtractionResult {
    Trace.beginSection("hvsc:extract")
    try {
      val profile = probe(archiveFile, mode)
      enforceMemoryBudget(profile, memoryBudget)
      if (cancellationToken.get()) {
        throw java.util.concurrent.CancellationException("HVSC extraction cancelled")
      }

      if (outputDir.exists() && !outputDir.isDirectory) {
        throw IllegalStateException(
                "HVSC output path is not a directory: ${outputDir.absolutePath}"
        )
      }
      if (!outputDir.exists() && !outputDir.mkdirs()) {
        throw IllegalStateException(
                "Failed to create HVSC output directory: ${outputDir.absolutePath}"
        )
      }

      val rawRoot =
              File(
                      outputDir.parentFile ?: outputDir,
                      "${outputDir.name}-raw-${System.currentTimeMillis()}"
              )
      if (!rawRoot.mkdirs()) {
        throw IllegalStateException(
                "Failed to create temporary extraction directory: ${rawRoot.absolutePath}"
        )
      }

      try {
        when {
          archiveFile.name.endsWith(".7z", ignoreCase = true) ->
                  extractSevenZipToRawTree(
                          archiveFile,
                          rawRoot,
                          profile,
                          cancellationToken,
                          onProgress
                  )
          archiveFile.name.endsWith(".zip", ignoreCase = true) ->
                  extractZipToRawTree(archiveFile, rawRoot, profile, cancellationToken, onProgress)
          else -> throw IllegalStateException("Unsupported archive format: ${archiveFile.name}")
        }

        if (cancellationToken.get()) {
          throw java.util.concurrent.CancellationException("HVSC extraction cancelled")
        }

        return materializeRelevantFiles(rawRoot, outputDir, profile, mode)
      } finally {
        rawRoot.deleteRecursively()
      }
    } finally {
      Trace.endSection()
    }
  }

  private fun enforceMemoryBudget(profile: ArchiveProfile, memoryBudget: MemoryBudget) {
    if (memoryBudget.maxExtractionBytes <= 0L) {
      throw IllegalStateException(
              "Invalid HVSC extraction memory budget: ${memoryBudget.maxExtractionBytes}"
      )
    }
    if (profile.estimatedRequiredBytes > memoryBudget.maxExtractionBytes) {
      throw InsufficientMemoryException(
              requiredBytes = profile.estimatedRequiredBytes,
              maxExtractionBytes = memoryBudget.maxExtractionBytes,
              detail = memoryBudget.detail,
      )
    }
  }

  private fun probeSevenZipArchive(archiveFile: File, mode: HvscArchiveMode): ArchiveProfile {
    val executable = requireSevenZipExecutable()
    val process =
            ProcessBuilder(listOf(executable.absolutePath, "l", "-slt", archiveFile.absolutePath))
                    .redirectErrorStream(true)
                    .start()

    var beforeSeparator = true
    var methodChain: String? = null
    var solid: Boolean? = null
    var blocks: Int? = null
    var entryCount = 0
    var fileCount = 0
    var directoryCount = 0
    var sidFileCount = 0
    var songlengthFiles = 0
    var encryptedEntries = 0
    var uncompressedSizeBytes = 0L
    var currentPath: String? = null
    var currentSize: Long = 0L
    var currentDirectory = false
    var currentEncrypted = false

    fun finalizeEntry() {
      val rawPath = currentPath ?: return
      if (rawPath.isBlank()) {
        currentPath = null
        currentSize = 0L
        currentDirectory = false
        currentEncrypted = false
        return
      }
      entryCount += 1
      val normalizedPath = normalizeArchiveEntryPath(rawPath, mode)
      if (currentDirectory) {
        directoryCount += 1
      } else {
        fileCount += 1
        uncompressedSizeBytes += currentSize.coerceAtLeast(0L)
        val lowered = normalizedPath.lowercase(Locale.US)
        if (lowered.endsWith(".sid")) sidFileCount += 1
        if (lowered.endsWith("songlengths.md5") || lowered.endsWith("songlengths.txt")) {
          songlengthFiles += 1
        }
      }
      if (currentEncrypted) encryptedEntries += 1
      currentPath = null
      currentSize = 0L
      currentDirectory = false
      currentEncrypted = false
    }

    process.inputStream.bufferedReader().useLines { lines ->
      lines.forEach { line ->
        when {
          line == "----------" -> {
            beforeSeparator = false
            finalizeEntry()
          }
          beforeSeparator -> {
            when {
              line.startsWith("Method = ") -> methodChain = line.substringAfter("Method = ").trim()
              line.startsWith("Solid = ") -> solid = line.substringAfter("Solid = ").trim() == "+"
              line.startsWith("Blocks = ") ->
                      blocks = line.substringAfter("Blocks = ").trim().toIntOrNull()
            }
          }
          line.isBlank() -> finalizeEntry()
          line.startsWith("Path = ") -> {
            finalizeEntry()
            currentPath = line.substringAfter("Path = ")
          }
          line.startsWith("Size = ") ->
                  currentSize = line.substringAfter("Size = ").trim().toLongOrNull() ?: 0L
          line.startsWith("Attributes = ") ->
                  currentDirectory = line.substringAfter("Attributes = ").contains('D')
          line.startsWith("Encrypted = ") ->
                  currentEncrypted = line.substringAfter("Encrypted = ").trim() == "+"
        }
      }
    }
    finalizeEntry()

    val exitCode = process.waitFor()
    if (exitCode != 0) {
      throw IOException(
              "Upstream 7-Zip probe failed for ${archiveFile.absolutePath} (exit=$exitCode)"
      )
    }

    val dictionaryBytes = parseDictionaryBytes(methodChain)
    return ArchiveProfile(
            format = "7z",
            methodChain = methodChain,
            dictionaryBytes = dictionaryBytes,
            solid = solid,
            blocks = blocks,
            entryCount = entryCount,
            fileCount = fileCount,
            directoryCount = directoryCount,
            sidFileCount = sidFileCount,
            songlengthFiles = songlengthFiles,
            encryptedEntries = encryptedEntries,
            uncompressedSizeBytes = uncompressedSizeBytes,
            estimatedRequiredBytes = estimateRequiredBytes(dictionaryBytes),
    )
  }

  private fun probeZipArchive(archiveFile: File, mode: HvscArchiveMode): ArchiveProfile {
    var entryCount = 0
    var fileCount = 0
    var directoryCount = 0
    var sidFileCount = 0
    var songlengthFiles = 0
    var uncompressedSizeBytes = 0L

    ZipFile(archiveFile).use { zip ->
      val entries = zip.entries()
      while (entries.hasMoreElements()) {
        val entry = entries.nextElement()
        entryCount += 1
        val rawPath = entry.name ?: ""
        val normalizedPath = normalizeArchiveEntryPath(rawPath, mode)
        if (entry.isDirectory) {
          directoryCount += 1
        } else {
          fileCount += 1
          uncompressedSizeBytes += entry.size.coerceAtLeast(0L)
          val lowered = normalizedPath.lowercase(Locale.US)
          if (lowered.endsWith(".sid")) sidFileCount += 1
          if (lowered.endsWith("songlengths.md5") || lowered.endsWith("songlengths.txt")) {
            songlengthFiles += 1
          }
        }
      }
    }

    return ArchiveProfile(
            format = "zip",
            methodChain = null,
            dictionaryBytes = null,
            solid = false,
            blocks = null,
            entryCount = entryCount,
            fileCount = fileCount,
            directoryCount = directoryCount,
            sidFileCount = sidFileCount,
            songlengthFiles = songlengthFiles,
            encryptedEntries = 0,
            uncompressedSizeBytes = uncompressedSizeBytes,
            estimatedRequiredBytes = 64L * 1024L * 1024L,
    )
  }

  private fun extractSevenZipToRawTree(
          archiveFile: File,
          rawRoot: File,
          profile: ArchiveProfile,
          cancellationToken: AtomicBoolean,
          onProgress: (ExtractionProgress) -> Unit,
  ) {
    Trace.beginSection("hvsc:extract7z")
    try {
      val executable = requireSevenZipExecutable()
      val process =
              ProcessBuilder(
                              listOf(
                                      executable.absolutePath,
                                      "x",
                                      "-y",
                                      "-bb1",
                                      "-bso1",
                                      "-bse1",
                                      "-o${rawRoot.absolutePath}",
                                      archiveFile.absolutePath,
                              )
                      )
                      .redirectErrorStream(true)
                      .start()

      val tail = ArrayDeque<String>()
      var processedEntries = 0
      var songsExtracted = 0

      val cancellationMonitor = Thread {
        while (process.isAlive) {
          if (cancellationToken.get()) {
            process.destroy()
            if (process.isAlive) {
              process.destroyForcibly()
            }
            break
          }
          try {
            Thread.sleep(50)
          } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            return@Thread
          }
        }
      }
      cancellationMonitor.isDaemon = true
      cancellationMonitor.start()

      try {
        process.inputStream.bufferedReader().useLines { lines ->
          lines.forEach { line ->
            if (tail.size >= 40) {
              tail.removeFirst()
            }
            tail.addLast(line)

            if (line.startsWith("- ")) {
              val currentFile = line.removePrefix("- ").trim()
              processedEntries += 1
              if (currentFile.lowercase(Locale.US).endsWith(".sid")) {
                songsExtracted += 1
              }
              onProgress(
                      ExtractionProgress(
                              processedEntries = processedEntries,
                              totalEntries = profile.entryCount,
                              currentFile = currentFile,
                              songsExtracted = songsExtracted,
                      )
              )
            }

            if (cancellationToken.get() && process.isAlive) {
              process.destroy()
            }
          }
        }
      } catch (error: IOException) {
        if (!cancellationToken.get()) {
          throw error
        }
      }

      val exitCode = process.waitFor()
      cancellationMonitor.join(100)
      if (cancellationToken.get()) {
        throw java.util.concurrent.CancellationException("HVSC extraction cancelled")
      }
      if (exitCode != 0) {
        throw IOException(
                buildString {
                  append(
                          "Upstream 7-Zip extraction failed for ${archiveFile.absolutePath} (exit=$exitCode)"
                  )
                  if (tail.isNotEmpty()) {
                    append(": ")
                    append(tail.joinToString(" | "))
                  }
                }
        )
      }
    } finally {
      Trace.endSection()
    }
  }

  private fun extractZipToRawTree(
          archiveFile: File,
          rawRoot: File,
          profile: ArchiveProfile,
          cancellationToken: AtomicBoolean,
          onProgress: (ExtractionProgress) -> Unit,
  ) {
    Trace.beginSection("hvsc:extractZip")
    try {
      var processedEntries = 0
      var songsExtracted = 0
      ZipFile(archiveFile).use { zip ->
        val entries = zip.entries()
        while (entries.hasMoreElements()) {
          if (cancellationToken.get()) {
            throw java.util.concurrent.CancellationException("HVSC extraction cancelled")
          }
          val entry = entries.nextElement()
          val rawPath = sanitizeRawRelativePath(entry.name ?: "")
          if (entry.isDirectory) {
            File(rawRoot, rawPath).mkdirs()
          } else {
            val targetFile = File(rawRoot, rawPath)
            ensureWithinRoot(rawRoot, targetFile)
            targetFile.parentFile?.mkdirs()
            zip.getInputStream(entry).use { input ->
              BufferedInputStream(input).use { buffered ->
                BufferedOutputStream(FileOutputStream(targetFile)).use { output ->
                  val buffer = ByteArray(32 * 1024)
                  while (true) {
                    val read = buffered.read(buffer)
                    if (read <= 0) {
                      break
                    }
                    output.write(buffer, 0, read)
                  }
                  output.flush()
                }
              }
            }
          }

          processedEntries += 1
          val lowered = rawPath.lowercase(Locale.US)
          if (!entry.isDirectory && lowered.endsWith(".sid")) {
            songsExtracted += 1
          }
          onProgress(
                  ExtractionProgress(
                          processedEntries = processedEntries,
                          totalEntries = profile.entryCount,
                          currentFile = rawPath,
                          songsExtracted = songsExtracted,
                  )
          )
        }
      }
    } finally {
      Trace.endSection()
    }
  }

  private fun materializeRelevantFiles(
          rawRoot: File,
          outputDir: File,
          profile: ArchiveProfile,
          mode: HvscArchiveMode,
  ): ExtractionResult {
    Trace.beginSection("hvsc:materialize")
    try {
      val extractedSongs = mutableListOf<ExtractedSong>()
      val failedPaths = mutableListOf<String>()
      val deletionPaths = mutableListOf<String>()
      var songlengthFilesWritten = 0

      rawRoot.walkTopDown().forEach { candidate ->
        if (!candidate.isFile) {
          return@forEach
        }
        val rawRelativePath = candidate.relativeTo(rawRoot).invariantSeparatorsPath
        val normalizedPath = normalizeArchiveEntryPath(rawRelativePath, mode)
        if (normalizedPath.isBlank()) {
          return@forEach
        }
        val lowered = normalizedPath.lowercase(Locale.US)

        try {
          when {
            isDeletionList(normalizedPath) -> {
              if (candidate.length() <= MAX_DELETION_LIST_SIZE_BYTES) {
                deletionPaths.addAll(parseDeletionList(candidate.readText()))
              }
            }
            lowered.endsWith("songlengths.md5") || lowered.endsWith("songlengths.txt") -> {
              val targetFile = ensureWithinRoot(outputDir, File(outputDir, normalizedPath))
              targetFile.parentFile?.mkdirs()
              moveIntoPlace(candidate, targetFile)
              songlengthFilesWritten += 1
            }
            lowered.endsWith(".sid") -> {
              val targetFile = ensureWithinRoot(outputDir, File(outputDir, normalizedPath))
              targetFile.parentFile?.mkdirs()
              moveIntoPlace(candidate, targetFile)
              val header = readSidHeader(targetFile)
              extractedSongs.add(
                      ExtractedSong(
                              virtualPath = "/$normalizedPath",
                              fileName = targetFile.name,
                              songs = header?.songs,
                              startSong = header?.startSong,
                      )
              )
            }
          }
        } catch (error: Exception) {
          failedPaths.add("/$normalizedPath")
          throw IOException("Failed to materialize HVSC entry /$normalizedPath", error)
        }
      }

      return ExtractionResult(
              profile = profile,
              totalEntries = profile.entryCount,
              songsIngested = extractedSongs.size,
              failedSongs = failedPaths.size,
              failedPaths = failedPaths,
              songlengthFilesWritten = songlengthFilesWritten,
              deletionPaths = deletionPaths.distinct(),
              extractedSongs = extractedSongs,
      )
    } finally {
      Trace.endSection()
    }
  }

  private fun moveIntoPlace(source: File, target: File) {
    if (target.exists() && !target.delete()) {
      throw IOException("Failed to replace existing HVSC target: ${target.absolutePath}")
    }
    if (!source.renameTo(target)) {
      source.copyTo(target, overwrite = true)
      if (!source.delete()) {
        source.deleteOnExit()
      }
    }
  }

  private fun requireSevenZipExecutable(): File {
    val provided = sevenZipExecutableProvider()
    if (provided != null && provided.exists()) {
      return provided
    }
    val path = System.getenv("PATH").orEmpty().split(File.pathSeparatorChar)
    listOf("7zz", "7z").forEach { name ->
      path.filter { it.isNotBlank() }.forEach { dir ->
        val candidate = File(dir, name)
        if (candidate.exists() && candidate.canExecute()) {
          return candidate
        }
      }
    }
    throw IllegalStateException(
            "Upstream 7-Zip executable unavailable. Expected a bundled Android binary or a host 7zz/7z command on PATH."
    )
  }

  private fun readSidHeader(file: File): SidHeader? {
    BufferedInputStream(file.inputStream()).use { input ->
      val headerBytes = ByteArray(0x80)
      val headerLength = input.read(headerBytes)
      if (headerLength < 0x12) {
        return null
      }
      val magic = String(headerBytes, 0, 4, Charsets.US_ASCII)
      if (magic != "PSID" && magic != "RSID") {
        return null
      }
      val songs =
              ((headerBytes[0x0E].toInt() and 0xFF) shl 8) or (headerBytes[0x0F].toInt() and 0xFF)
      val startSong =
              ((headerBytes[0x10].toInt() and 0xFF) shl 8) or (headerBytes[0x11].toInt() and 0xFF)
      return SidHeader(songs = songs, startSong = startSong)
    }
  }

  private fun normalizeArchiveEntryPath(raw: String, mode: HvscArchiveMode): String {
    val sanitized = sanitizeRawRelativePath(raw)
    val updateStripped =
            when {
              mode != HvscArchiveMode.UPDATE -> sanitized
              sanitized.startsWith("new/", ignoreCase = true) -> sanitized.substring(4)
              sanitized.startsWith("update/", ignoreCase = true) -> sanitized.substring(7)
              sanitized.startsWith("updated/", ignoreCase = true) -> sanitized.substring(8)
              else -> sanitized
            }
    return when {
      updateStripped.startsWith("HVSC/", ignoreCase = true) -> updateStripped.substring(5)
      updateStripped.startsWith("C64Music/", ignoreCase = true) -> updateStripped.substring(9)
      else -> updateStripped
    }
  }

  private fun sanitizeRawRelativePath(raw: String): String {
    val normalized = raw.replace('\\', '/').trim()
    val stripped = normalized.trimStart('/')
    require(!normalized.startsWith("/")) { "Archive entry uses an absolute path: $raw" }
    require(!Regex("^[A-Za-z]:/").containsMatchIn(normalized)) {
      "Archive entry uses a drive-qualified path: $raw"
    }
    val parts = stripped.split('/').filter { it.isNotBlank() }
    require(parts.none { it == "." || it == ".." }) {
      "Archive entry escapes the HVSC library root: $raw"
    }
    return parts.joinToString("/")
  }

  private fun isDeletionList(path: String): Boolean {
    val lowered = path.lowercase(Locale.US)
    return lowered.endsWith(".txt") && (lowered.contains("delete") || lowered.contains("remove"))
  }

  private fun parseDeletionList(content: String): List<String> {
    return content.split(Regex("\\r?\\n"))
            .map { it.trim() }
            .filter { it.isNotEmpty() && it.lowercase(Locale.US).endsWith(".sid") }
            .map { if (it.startsWith('/')) it else "/$it" }
  }

  private fun ensureWithinRoot(root: File, candidate: File): File {
    val rootPath = root.canonicalPath
    val candidatePath = candidate.canonicalPath
    require(candidatePath == rootPath || candidatePath.startsWith("$rootPath${File.separator}")) {
      "Archive entry escapes HVSC library root: $candidatePath"
    }
    return candidate
  }

  private fun estimateRequiredBytes(dictionaryBytes: Long?): Long {
    val dictionary = dictionaryBytes ?: 64L * 1024L * 1024L
    return dictionary + (128L * 1024L * 1024L)
  }

  private fun parseDictionaryBytes(methodChain: String?): Long? {
    if (methodChain.isNullOrBlank()) {
      return null
    }
    val match = Regex("(?i):(\\d+)([kmg])").find(methodChain) ?: return null
    val value = match.groupValues[1].toLongOrNull() ?: return null
    return when (match.groupValues[2].lowercase(Locale.US)) {
      "k" -> value * 1024L
      "m" -> value * 1024L * 1024L
      "g" -> value * 1024L * 1024L * 1024L
      else -> null
    }
  }

  private data class SidHeader(
          val songs: Int,
          val startSong: Int,
  )

  companion object {
    private const val MAX_DELETION_LIST_SIZE_BYTES = 10L * 1024L * 1024L
  }
}
