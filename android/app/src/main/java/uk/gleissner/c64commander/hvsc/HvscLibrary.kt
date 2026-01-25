package uk.gleissner.c64commander.hvsc

import java.io.File
import java.util.Locale

internal class HvscLibrary(private val rootDir: File) {
  private var songlengths: SonglengthsParser.Result? = null

  fun listFolders(path: String): List<String> {
    val folder = resolveFolder(path)
    val entries = folder.listFiles()?.filter { it.isDirectory } ?: emptyList()
    val normalized = normalizeFolder(path)
    return entries
      .map { entry ->
        if (normalized == "/") "${normalized}${entry.name}" else "$normalized/${entry.name}"
      }
      .sorted()
  }

  fun listSongs(path: String): List<HvscSongSummary> {
    val folder = resolveFolder(path)
    val entries = folder.listFiles()?.filter { it.isFile && it.name.lowercase(Locale.getDefault()).endsWith(".sid") } ?: emptyList()
    val normalized = normalizeFolder(path)
    val durations = loadSonglengths()
    return entries
      .map { file ->
        val virtualPath = if (normalized == "/") "/${file.name}" else "$normalized/${file.name}"
        HvscSongSummary(
          id = virtualPath.hashCode().toLong(),
          virtualPath = virtualPath,
          fileName = file.name,
          durationSeconds = durations?.pathToSeconds?.get(virtualPath),
        )
      }
      .sortedBy { it.fileName }
  }

  fun getSongByVirtualPath(path: String): HvscSongDetail? {
    val file = resolveFile(path) ?: return null
    if (!file.exists()) return null
    val data = file.readBytes()
    return HvscSongDetail(
      id = path.hashCode().toLong(),
      virtualPath = normalizeFilePath(path),
      fileName = file.name,
      durationSeconds = loadSonglengths()?.pathToSeconds?.get(normalizeFilePath(path)),
      md5 = null,
      data = data,
    )
  }

  fun getDurationByMd5(md5: String): Int? = loadSonglengths()?.md5ToSeconds?.get(md5)

  private fun resolveFolder(path: String): File {
    val normalized = normalizeFolder(path)
    val relative = normalized.trimStart('/')
    return if (relative.isBlank()) rootDir else File(rootDir, relative)
  }

  private fun resolveFile(path: String): File? {
    val normalized = normalizeFilePath(path)
    val relative = normalized.trimStart('/')
    if (relative.isBlank()) return null
    val file = File(rootDir, relative)
    ensureSafeTarget(rootDir, file)
    return file
  }

  private fun normalizeFolder(path: String): String {
    if (path.isBlank() || path == "/") return "/"
    return "/" + path.trim('/').trim()
  }

  private fun normalizeFilePath(path: String): String {
    val normalized = normalizeFolder(path)
    return normalized
  }

  private fun loadSonglengths(): SonglengthsParser.Result? {
    if (songlengths != null) return songlengths
    val md5File = File(rootDir, "Songlengths.md5")
    val txtFile = File(rootDir, "Songlengths.txt")
    if (!md5File.exists() && !txtFile.exists()) return null
    val combinedPathToSeconds = mutableMapOf<String, Int>()
    val combinedMd5ToSeconds = mutableMapOf<String, Int>()
    if (md5File.exists()) {
      val parsed = SonglengthsParser.parse(md5File.readText())
      combinedPathToSeconds.putAll(parsed.pathToSeconds)
      combinedMd5ToSeconds.putAll(parsed.md5ToSeconds)
    }
    if (txtFile.exists()) {
      val parsed = SonglengthsParser.parseText(txtFile.readText())
      parsed.pathToSeconds.forEach { (path, seconds) ->
        if (!combinedPathToSeconds.containsKey(path)) {
          combinedPathToSeconds[path] = seconds
        }
      }
    }
    songlengths = SonglengthsParser.Result(combinedPathToSeconds, combinedMd5ToSeconds)
    return songlengths
  }

  private fun ensureSafeTarget(root: File, target: File) {
    val rootCanonical = root.canonicalFile
    val targetCanonical = target.canonicalFile
    if (!targetCanonical.path.startsWith(rootCanonical.path)) {
      throw IllegalArgumentException("Resolved path outside HVSC root: ${target.path}")
    }
  }
}
