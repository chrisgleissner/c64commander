package com.c64.commander.hvsc

import java.io.File
import java.security.MessageDigest
import java.util.Locale

class HvscIngestionService(
  private val database: HvscDatabase,
  private val releaseService: HvscReleaseProvider = HvscReleaseService(),
  private val downloader: HvscDownloadClient = HvscDownloader(),
) {
  data class Progress(
    val phase: String,
    val message: String,
    val percent: Int? = null,
  )

  fun getStatus(): HvscMeta = database.getMeta()

  fun checkForUpdates(): HvscUpdateStatus {
    val (baselineLatest, updateLatest) = releaseService.fetchLatestVersions()
    val meta = database.getMeta()
    val installed = meta.installedVersion
    val required = if (installed == 0) {
      (baselineLatest + 1..updateLatest).toList()
    } else if (installed < updateLatest) {
      ((installed + 1)..updateLatest).toList()
    } else {
      emptyList()
    }
    database.updateMeta(lastUpdateCheckUtcMs = System.currentTimeMillis())
    return HvscUpdateStatus(
      latestVersion = updateLatest,
      installedVersion = installed,
      requiredUpdates = required,
      baselineVersion = if (installed == 0) baselineLatest else null,
    )
  }

  fun installOrUpdate(
    workDir: File,
    cancelToken: HvscCancelRegistry.CancellationToken?,
    onProgress: (Progress) -> Unit,
  ): HvscMeta {
    try {
      val meta = database.getMeta()
      val (baselineLatest, updateLatest) = releaseService.fetchLatestVersions()
      val needsBaseline = meta.installedVersion == 0
      if (needsBaseline) {
        installBaseline(workDir, baselineLatest, cancelToken, onProgress)
      }
      val installed = database.getMeta().installedVersion
      if (installed < updateLatest) {
        for (version in (installed + 1)..updateLatest) {
          applyUpdate(workDir, version, cancelToken, onProgress)
        }
      }
      return database.getMeta()
    } catch (error: Exception) {
      database.updateMeta(ingestionState = "error", ingestionError = error.message)
      throw error
    }
  }

  fun listFolders(path: String): List<String> = database.listFolders(path)

  fun listSongs(path: String): List<HvscSongSummary> = database.listSongs(path)

  fun getSongById(id: Long): HvscSongDetail? = database.getSongById(id)

  fun getSongByVirtualPath(path: String): HvscSongDetail? = database.getSongByVirtualPath(path)

  fun getDurationByMd5(md5: String): Int? = database.getDurationByMd5(md5)

  private fun installBaseline(
    workDir: File,
    version: Int,
    cancelToken: HvscCancelRegistry.CancellationToken?,
    onProgress: (Progress) -> Unit,
  ) {
    database.updateMeta(ingestionState = "installing", ingestionError = null, clearIngestionError = true)
    val archive = File(workDir, "hvsc-baseline-$version.7z")
    onProgress(Progress("download", "Downloading HVSC $version…", 0))
    downloader.download(releaseService.buildBaselineUrl(version), archive) { percent ->
      onProgress(Progress("download", "Downloading HVSC $version…", percent))
      cancelIfNeeded(cancelToken)
    }

    onProgress(Progress("ingest", "Ingesting HVSC $version…", 0))
    val songlengths = mutableMapOf<String, Int>()
    val md5Durations = mutableMapOf<String, Int>()
    val songs = mutableListOf<HvscSongRecord>()
    val now = System.currentTimeMillis()

    try {
      SevenZArchiveReader(archive, null).use { reader ->
        var entry = reader.nextEntry()
        var processed = 0
        while (entry != null) {
          cancelIfNeeded(cancelToken)
          if (!entry.isDirectory) {
            val normalized = normalizeEntryName(entry.name)
            if (normalized.endsWith("/Songlengths.md5", true)) {
              val bytes = reader.readEntryBytes()
              val parsed = SonglengthsParser.parse(String(bytes, Charsets.UTF_8))
              songlengths.putAll(parsed.pathToSeconds)
              md5Durations.putAll(parsed.md5ToSeconds)
            } else if (normalized.lowercase(Locale.getDefault()).endsWith(".sid")) {
              val data = reader.readEntryBytes()
              val virtualPath = normalizeVirtualPath(normalized)
              if (virtualPath != null) {
                val md5 = computeMd5(data)
                val durationSeconds = songlengths[virtualPath] ?: md5Durations[md5]
                val dirPath = virtualPath.substringBeforeLast('/', "")
                val fileName = virtualPath.substringAfterLast('/')
                songs.add(
                  HvscSongRecord(
                    virtualPath = virtualPath,
                    dirPath = if (dirPath.isBlank()) "/" else dirPath,
                    fileName = fileName,
                    sizeBytes = data.size.toLong(),
                    md5 = md5,
                    durationSeconds = durationSeconds,
                    data = data,
                    sourceVersion = version,
                    createdAtUtcMs = now,
                    updatedAtUtcMs = now,
                  ),
                )
              }
            }
          }
          processed += 1
          if (processed % 50 == 0) {
            onProgress(Progress("ingest", "Ingesting HVSC $version…", null))
          }
          entry = reader.nextEntry()
        }
      }
    } finally {
      archive.delete()
    }

    database.withTransaction {
      database.upsertSongs(songs)
      database.updateDurationsByMd5(md5Durations)
      database.updateMeta(
        installedBaselineVersion = version,
        installedVersion = version,
        ingestionState = "ready",
        ingestionError = null,
        clearIngestionError = true,
      )
    }
  }

  private fun applyUpdate(
    workDir: File,
    version: Int,
    cancelToken: HvscCancelRegistry.CancellationToken?,
    onProgress: (Progress) -> Unit,
  ) {
    if (database.isUpdateApplied(version)) return
    database.updateMeta(ingestionState = "updating", ingestionError = null, clearIngestionError = true)
    val archive = File(workDir, "hvsc-update-$version.7z")
    onProgress(Progress("download", "Downloading update $version…", 0))
    downloader.download(releaseService.buildUpdateUrl(version), archive) { percent ->
      onProgress(Progress("download", "Downloading update $version…", percent))
      cancelIfNeeded(cancelToken)
    }

    val songs = mutableListOf<HvscSongRecord>()
    val md5Durations = mutableMapOf<String, Int>()
    val deletions = mutableListOf<String>()
    val now = System.currentTimeMillis()

    try {
      SevenZArchiveReader(archive, null).use { reader ->
        var entry = reader.nextEntry()
        while (entry != null) {
          cancelIfNeeded(cancelToken)
          if (!entry.isDirectory) {
            val normalized = normalizeEntryName(entry.name)
            if (normalized.endsWith("Songlengths.md5", true)) {
              val parsed = SonglengthsParser.parse(String(reader.readEntryBytes(), Charsets.UTF_8))
              md5Durations.putAll(parsed.md5ToSeconds)
            } else if (isDeletionList(normalized)) {
              val text = String(reader.readEntryBytes(), Charsets.UTF_8)
              deletions.addAll(parseDeletionList(text))
            } else if (normalized.lowercase(Locale.getDefault()).endsWith(".sid")) {
              val data = reader.readEntryBytes()
              val virtualPath = normalizeUpdateVirtualPath(normalized)
              if (virtualPath != null) {
                val md5 = computeMd5(data)
                val durationSeconds = md5Durations[md5]
                val dirPath = virtualPath.substringBeforeLast('/', "")
                val fileName = virtualPath.substringAfterLast('/')
                songs.add(
                  HvscSongRecord(
                    virtualPath = virtualPath,
                    dirPath = if (dirPath.isBlank()) "/" else dirPath,
                    fileName = fileName,
                    sizeBytes = data.size.toLong(),
                    md5 = md5,
                    durationSeconds = durationSeconds,
                    data = data,
                    sourceVersion = version,
                    createdAtUtcMs = now,
                    updatedAtUtcMs = now,
                  ),
                )
              }
            }
          }
          entry = reader.nextEntry()
        }
      }

      database.withTransaction {
        if (deletions.isNotEmpty()) {
          database.deleteByVirtualPaths(deletions)
        }
        database.upsertSongs(songs)
        database.updateDurationsByMd5(md5Durations)
        database.updateMeta(
          installedVersion = version,
          ingestionState = "ready",
          ingestionError = null,
          clearIngestionError = true,
        )
        database.markUpdateApplied(version, "success")
      }
    } catch (error: Exception) {
      database.markUpdateApplied(version, "failed", error.message)
      throw error
    } finally {
      archive.delete()
    }
  }

  private fun cancelIfNeeded(cancelToken: HvscCancelRegistry.CancellationToken?) {
    if (cancelToken?.isCancelled() == true) {
      database.updateMeta(ingestionState = "idle", ingestionError = "Cancelled")
      throw IllegalStateException("HVSC update cancelled")
    }
  }

  private fun normalizeEntryName(raw: String): String {
    return raw.replace("\\", "/").trimStart('/')
  }

  private fun normalizeVirtualPath(entryName: String): String? {
    val name = normalizeEntryName(entryName)
    val withoutRoot = name
      .removePrefix("HVSC/")
      .removePrefix("C64Music/")
      .removePrefix("C64MUSIC/")
    return if (withoutRoot.lowercase(Locale.getDefault()).endsWith(".sid")) {
      "/${withoutRoot.trimStart('/')}"
    } else {
      null
    }
  }

  private fun normalizeUpdateVirtualPath(entryName: String): String? {
    val name = normalizeEntryName(entryName)
    val lowered = name.lowercase(Locale.getDefault())
    val base = when {
      lowered.startsWith("new/") -> name.substringAfter("new/")
      lowered.contains("/new/") -> name.substringAfter("/new/")
      lowered.startsWith("update/") -> name.substringAfter("update/")
      lowered.contains("/update/") -> name.substringAfter("/update/")
      lowered.startsWith("updated/") -> name.substringAfter("updated/")
      lowered.contains("/updated/") -> name.substringAfter("/updated/")
      else -> name
    }
    return normalizeVirtualPath(base)
  }

  private fun isDeletionList(path: String): Boolean {
    val lowered = path.lowercase(Locale.getDefault())
    return lowered.endsWith(".txt") && (lowered.contains("delete") || lowered.contains("remove"))
  }

  private fun parseDeletionList(content: String): List<String> {
    return content.lines()
      .map { it.trim() }
      .filter { it.isNotBlank() && it.endsWith(".sid", true) }
      .map { if (it.startsWith("/")) it else "/$it" }
  }

  private fun computeMd5(data: ByteArray): String {
    val digest = MessageDigest.getInstance("MD5")
    val hash = digest.digest(data)
    return hash.joinToString("") { byte -> "%02x".format(byte) }
  }
}
