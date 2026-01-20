package uk.gleissner.c64commander.hvsc

import java.io.File
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID

class HvscIngestionService(
  private val database: HvscDatabase,
  private val releaseService: HvscReleaseProvider = HvscReleaseService(),
  private val downloader: HvscDownloadClient = HvscDownloader(),
) {
  data class CacheStatus(
    val baselineVersion: Int?,
    val updateVersions: List<Int>,
  )
  data class Progress(
    val ingestionId: String,
    val stage: String,
    val message: String,
    val archiveName: String? = null,
    val currentFile: String? = null,
    val processedCount: Int? = null,
    val totalCount: Int? = null,
    val percent: Int? = null,
    val downloadedBytes: Long? = null,
    val totalBytes: Long? = null,
    val songsUpserted: Int? = null,
    val songsDeleted: Int? = null,
    val elapsedTimeMs: Long? = null,
    val errorType: String? = null,
    val errorCause: String? = null,
  )

  private enum class ArchiveType {
    BASELINE,
    UPDATE,
  }

  private data class ArchivePlan(
    val type: ArchiveType,
    val version: Int,
    val archiveFile: File,
    val downloadUrl: String?,
    val useCached: Boolean,
  ) {
    val displayName: String
      get() = if (type == ArchiveType.BASELINE) "HVSC $version" else "update $version"
  }

  private object Stages {
    const val Start = "start"
    const val ArchiveDiscovery = "archive_discovery"
    const val ArchiveValidation = "archive_validation"
    const val Download = "download"
    const val ArchiveExtraction = "archive_extraction"
    const val SidEnumeration = "sid_enumeration"
    const val SidMetadataParsing = "sid_metadata_parsing"
    const val DatabaseInsertion = "database_insertion"
    const val Complete = "complete"
    const val Error = "error"
  }

  private companion object {
    const val BATCH_SIZE = 250
  }

  private inner class ProgressEmitter(
    private val ingestionId: String,
    private val onProgress: (Progress) -> Unit,
  ) {
    private val startedAt = System.currentTimeMillis()

    fun emit(
      stage: String,
      message: String,
      archiveName: String? = null,
      currentFile: String? = null,
      processedCount: Int? = null,
      totalCount: Int? = null,
      percent: Int? = null,
      downloadedBytes: Long? = null,
      totalBytes: Long? = null,
      songsUpserted: Int? = null,
      songsDeleted: Int? = null,
      errorType: String? = null,
      errorCause: String? = null,
    ) {
      val resolvedPercent = percent ?: calculatePercent(processedCount, totalCount)
      onProgress(
        Progress(
          ingestionId = ingestionId,
          stage = stage,
          message = message,
          archiveName = archiveName,
          currentFile = currentFile,
          processedCount = processedCount,
          totalCount = totalCount,
          percent = resolvedPercent,
          downloadedBytes = downloadedBytes,
          totalBytes = totalBytes,
          songsUpserted = songsUpserted,
          songsDeleted = songsDeleted,
          elapsedTimeMs = System.currentTimeMillis() - startedAt,
          errorType = errorType,
          errorCause = errorCause,
        ),
      )
    }

    fun emitError(error: Exception, stage: String, archiveName: String? = null) {
      emit(
        stage = stage,
        message = error.message ?: "HVSC ingestion failed",
        archiveName = archiveName,
        errorType = error::class.java.simpleName,
        errorCause = error.message,
      )
    }
  }

  fun getStatus(): HvscMeta = database.getMeta()

  fun getCacheStatus(workDir: File): CacheStatus {
    if (!workDir.exists()) return CacheStatus(null, emptyList())
    val baselineVersions = mutableListOf<Int>()
    val updateVersions = mutableListOf<Int>()
    workDir.listFiles()?.forEach { file ->
      val name = file.name
      if (!name.endsWith(".7z", ignoreCase = true) && !name.endsWith(".zip", ignoreCase = true)) return@forEach
      val baselineMatch = Regex("hvsc-baseline-(\\d+)\\.(7z|zip)", RegexOption.IGNORE_CASE).find(name)
      if (baselineMatch != null) {
        baselineVersions.add(baselineMatch.groupValues[1].toInt())
        return@forEach
      }
      val updateMatch = Regex("hvsc-update-(\\d+)\\.(7z|zip)", RegexOption.IGNORE_CASE).find(name)
      if (updateMatch != null) {
        updateVersions.add(updateMatch.groupValues[1].toInt())
      }
    }
    val baseline = baselineVersions.maxOrNull()
    return CacheStatus(baseline, updateVersions.sorted())
  }

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
    val ingestionId = UUID.randomUUID().toString()
    val emitter = ProgressEmitter(ingestionId, onProgress)
    emitter.emit(Stages.Start, "HVSC ingestion started")
    var currentArchive: String? = null
    try {
      val meta = database.getMeta()
      val (baselineLatest, updateLatest) = releaseService.fetchLatestVersions()
      val plans = buildInstallPlan(meta, baselineLatest, updateLatest, workDir)
      if (plans.isEmpty()) return database.getMeta()
      emitter.emit(
        stage = Stages.ArchiveDiscovery,
        message = "Discovered ${plans.size} archive(s)",
        processedCount = 0,
        totalCount = plans.size,
      )
      plans.forEachIndexed { index, plan ->
        currentArchive = plan.archiveFile.name
        emitter.emit(
          stage = Stages.ArchiveDiscovery,
          message = "Preparing ${plan.displayName}",
          archiveName = plan.archiveFile.name,
          processedCount = index + 1,
          totalCount = plans.size,
        )
        val inspection = prepareArchive(plan, cancelToken, emitter)
        if (plan.type == ArchiveType.BASELINE) {
          installBaselineArchive(plan, inspection, cancelToken, emitter)
        } else {
          applyUpdateArchive(plan, inspection, cancelToken, emitter)
        }
      }
      emitter.emit(Stages.Complete, "HVSC ingestion complete")
      return database.getMeta()
    } catch (error: Exception) {
      database.updateMeta(ingestionState = "error", ingestionError = error.message)
      emitter.emitError(error, Stages.Error, currentArchive)
      throw error
    }
  }

  fun listFolders(path: String): List<String> = database.listFolders(path)

  fun listSongs(path: String): List<HvscSongSummary> = database.listSongs(path)

  fun getSongById(id: Long): HvscSongDetail? = database.getSongById(id)

  fun getSongByVirtualPath(path: String): HvscSongDetail? = database.getSongByVirtualPath(path)

  fun getDurationByMd5(md5: String): Int? = database.getDurationByMd5(md5)

  fun ingestCached(
    workDir: File,
    cancelToken: HvscCancelRegistry.CancellationToken?,
    onProgress: (Progress) -> Unit,
  ): HvscMeta {
    val ingestionId = UUID.randomUUID().toString()
    val emitter = ProgressEmitter(ingestionId, onProgress)
    emitter.emit(Stages.Start, "HVSC cached ingestion started")
    var currentArchive: String? = null
    try {
      val meta = database.getMeta()
      val cache = getCacheStatus(workDir)
      val plans = buildCachedPlan(meta, cache, workDir)
      if (plans.isEmpty()) {
        throw IllegalStateException("No cached HVSC archives available.")
      }
      emitter.emit(
        stage = Stages.ArchiveDiscovery,
        message = "Discovered ${plans.size} cached archive(s)",
        processedCount = 0,
        totalCount = plans.size,
      )
      plans.forEachIndexed { index, plan ->
        currentArchive = plan.archiveFile.name
        emitter.emit(
          stage = Stages.ArchiveDiscovery,
          message = "Preparing cached ${plan.displayName}",
          archiveName = plan.archiveFile.name,
          processedCount = index + 1,
          totalCount = plans.size,
        )
        val inspection = prepareArchive(plan, cancelToken, emitter)
        if (plan.type == ArchiveType.BASELINE) {
          installBaselineArchive(plan, inspection, cancelToken, emitter)
        } else {
          applyUpdateArchive(plan, inspection, cancelToken, emitter)
        }
      }
      emitter.emit(Stages.Complete, "HVSC cached ingestion complete")
      return database.getMeta()
    } catch (error: Exception) {
      database.updateMeta(ingestionState = "error", ingestionError = error.message)
      emitter.emitError(error, Stages.Error, currentArchive)
      throw error
    }
  }

  private fun buildInstallPlan(
    meta: HvscMeta,
    baselineLatest: Int,
    updateLatest: Int,
    workDir: File,
  ): List<ArchivePlan> {
    val plans = mutableListOf<ArchivePlan>()
    if (meta.installedVersion == 0) {
      val baselineArchive = File(workDir, "hvsc-baseline-$baselineLatest.7z")
      val useCached = baselineArchive.exists() && baselineArchive.length() > 0
      plans.add(
        ArchivePlan(
          type = ArchiveType.BASELINE,
          version = baselineLatest,
          archiveFile = baselineArchive,
          downloadUrl = releaseService.buildBaselineUrl(baselineLatest),
          useCached = useCached,
        ),
      )
    }
    val installedVersion = if (meta.installedVersion == 0) baselineLatest else meta.installedVersion
    if (installedVersion < updateLatest) {
      for (version in (installedVersion + 1)..updateLatest) {
        val updateArchive = File(workDir, "hvsc-update-$version.7z")
        val useCached = updateArchive.exists() && updateArchive.length() > 0
        plans.add(
          ArchivePlan(
            type = ArchiveType.UPDATE,
            version = version,
            archiveFile = updateArchive,
            downloadUrl = releaseService.buildUpdateUrl(version),
            useCached = useCached,
          ),
        )
      }
    }
    return plans
  }

  private fun buildCachedPlan(
    meta: HvscMeta,
    cacheStatus: CacheStatus,
    workDir: File,
  ): List<ArchivePlan> {
    val plans = mutableListOf<ArchivePlan>()
    if (meta.installedVersion == 0) {
      val baselineVersion = cacheStatus.baselineVersion ?: return emptyList()
      val baselineArchive = resolveArchiveFile(workDir, "hvsc-baseline", baselineVersion) ?: return emptyList()
      plans.add(
        ArchivePlan(
          type = ArchiveType.BASELINE,
          version = baselineVersion,
          archiveFile = baselineArchive,
          downloadUrl = null,
          useCached = true,
        ),
      )
    }
    val startVersion = if (meta.installedVersion == 0) {
      cacheStatus.baselineVersion ?: 0
    } else {
      meta.installedVersion
    }
    cacheStatus.updateVersions
      .filter { it > startVersion }
      .sorted()
      .forEach { version ->
        val updateArchive = resolveArchiveFile(workDir, "hvsc-update", version) ?: return@forEach
        plans.add(
          ArchivePlan(
            type = ArchiveType.UPDATE,
            version = version,
            archiveFile = updateArchive,
            downloadUrl = null,
            useCached = true,
          ),
        )
      }
    return plans
  }

  private fun resolveArchiveFile(workDir: File, prefix: String, version: Int): File? {
    val candidates = listOf(
      File(workDir, "$prefix-$version.7z"),
      File(workDir, "$prefix-$version.zip"),
    )
    return candidates.firstOrNull { it.exists() && it.length() > 0 }
  }

  private fun prepareArchive(
    plan: ArchivePlan,
    cancelToken: HvscCancelRegistry.CancellationToken?,
    emitter: ProgressEmitter,
  ): HvscArchiveInspector.Inspection {
    val archive = plan.archiveFile
    if (plan.useCached || plan.downloadUrl == null) {
      if (!archive.exists() || archive.length() == 0L) {
        throw IllegalStateException("Missing cached archive ${archive.name}")
      }
      emitter.emit(
        stage = Stages.Download,
        message = "Using cached ${plan.displayName}",
        archiveName = archive.name,
        percent = 100,
        downloadedBytes = archive.length(),
        totalBytes = archive.length(),
      )
    } else {
      emitter.emit(
        stage = Stages.Download,
        message = "Downloading ${plan.displayName}…",
        archiveName = archive.name,
        percent = 0,
      )
      downloader.download(plan.downloadUrl, archive) { progress ->
        emitter.emit(
          stage = Stages.Download,
          message = "Downloading ${plan.displayName}…",
          archiveName = archive.name,
          percent = progress.percent,
          downloadedBytes = progress.downloadedBytes,
          totalBytes = progress.totalBytes,
        )
        cancelIfNeeded(cancelToken)
      }
      val archiveBytes = archive.length()
      emitter.emit(
        stage = Stages.Download,
        message = "Downloaded ${plan.displayName}",
        archiveName = archive.name,
        percent = 100,
        downloadedBytes = archiveBytes,
        totalBytes = archiveBytes,
      )
    }
    cancelIfNeeded(cancelToken)
    emitter.emit(
      stage = Stages.ArchiveValidation,
      message = "Validating ${archive.name}…",
      archiveName = archive.name,
    )
    val inspection = HvscArchiveInspector.inspect(archive)
    validateInspection(plan, inspection)
    val methodSummary = if (inspection.compressionMethods.isNotEmpty()) {
      inspection.compressionMethods.joinToString(", ")
    } else {
      "unknown"
    }
    val solid = inspection.solid?.toString() ?: "unknown"
    val encrypted = inspection.encrypted?.toString() ?: "unknown"
    val dictionary = inspection.maxDictionaryBytes?.toString() ?: "unknown"
    val mixed = inspection.hasMixedMethods.toString()
    emitter.emit(
      stage = Stages.ArchiveValidation,
      message = "Validated ${archive.name} (methods=$methodSummary, solid=$solid, mixed=$mixed, dict=$dictionary, encrypted=$encrypted)",
      archiveName = archive.name,
    )
    emitter.emit(
      stage = Stages.SidEnumeration,
      message = "Discovered ${inspection.sidEntries} SID file(s)",
      archiveName = archive.name,
      processedCount = 0,
      totalCount = inspection.sidEntries,
    )
    return inspection
  }

  private fun validateInspection(plan: ArchivePlan, inspection: HvscArchiveInspector.Inspection) {
    if (inspection.encrypted == true) {
      throw IllegalStateException("Archive ${inspection.archiveName} is encrypted and cannot be ingested.")
    }
    if (inspection.sidEntries == 0 && !inspection.hasDeletionList) {
      throw IllegalStateException("Archive ${inspection.archiveName} contains no SID entries.")
    }
    if (plan.type == ArchiveType.BASELINE && !inspection.hasSonglengths) {
      throw IllegalStateException("Baseline archive ${inspection.archiveName} is missing Songlengths.md5.")
    }
  }

  private fun installBaselineArchive(
    plan: ArchivePlan,
    inspection: HvscArchiveInspector.Inspection,
    cancelToken: HvscCancelRegistry.CancellationToken?,
    emitter: ProgressEmitter,
  ) {
    database.updateMeta(ingestionState = "installing", ingestionError = null, clearIngestionError = true)
    val archive = plan.archiveFile
    val totalSid = inspection.sidEntries.coerceAtLeast(0)
    emitter.emit(
      stage = Stages.ArchiveExtraction,
      message = "Extracting ${plan.displayName}…",
      archiveName = archive.name,
      totalCount = totalSid,
    )
    val songlengths = mutableMapOf<String, Int>()
    val md5Durations = mutableMapOf<String, Int>()
    val batch = mutableListOf<HvscSongRecord>()
    val now = System.currentTimeMillis()
    var processed = 0
    var upserted = 0
    var success = false

    try {
      database.withTransaction {
        HvscArchiveReaderFactory.open(archive, null).use { reader ->
          var entry = reader.nextEntry()
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
                  batch.add(
                    HvscSongRecord(
                      virtualPath = virtualPath,
                      dirPath = if (dirPath.isBlank()) "/" else dirPath,
                      fileName = fileName,
                      sizeBytes = data.size.toLong(),
                      md5 = md5,
                      durationSeconds = durationSeconds,
                      data = data,
                      sourceVersion = plan.version,
                      createdAtUtcMs = now,
                      updatedAtUtcMs = now,
                    ),
                  )
                  processed += 1
                  emitter.emit(
                    stage = Stages.SidMetadataParsing,
                    message = "Parsed $virtualPath",
                    archiveName = archive.name,
                    currentFile = virtualPath,
                    processedCount = processed,
                    totalCount = totalSid,
                  )
                  if (batch.size >= BATCH_SIZE) {
                    database.upsertSongs(batch)
                    upserted += batch.size
                    emitter.emit(
                      stage = Stages.DatabaseInsertion,
                      message = "Inserted ${upserted.toString()} SID file(s)",
                      archiveName = archive.name,
                      processedCount = processed,
                      totalCount = totalSid,
                      songsUpserted = upserted,
                    )
                    batch.clear()
                  }
                }
              }
            }
            entry = reader.nextEntry()
          }
        }
        if (batch.isNotEmpty()) {
          database.upsertSongs(batch)
          upserted += batch.size
          emitter.emit(
            stage = Stages.DatabaseInsertion,
            message = "Inserted ${upserted.toString()} SID file(s)",
            archiveName = archive.name,
            processedCount = processed,
            totalCount = totalSid,
            songsUpserted = upserted,
          )
          batch.clear()
        }
        database.updateDurationsByMd5(md5Durations)
        database.updateMeta(
          installedBaselineVersion = plan.version,
          installedVersion = plan.version,
          ingestionState = "ready",
          ingestionError = null,
          clearIngestionError = true,
        )
      }
      success = true
    } finally {
      if (success) {
        archive.delete()
      }
    }
    emitter.emit(
      stage = Stages.Complete,
      message = "${plan.displayName} indexed",
      archiveName = archive.name,
      processedCount = totalSid,
      totalCount = totalSid,
      percent = 100,
      songsUpserted = upserted,
      songsDeleted = 0,
    )
  }

  private fun applyUpdateArchive(
    plan: ArchivePlan,
    inspection: HvscArchiveInspector.Inspection,
    cancelToken: HvscCancelRegistry.CancellationToken?,
    emitter: ProgressEmitter,
  ) {
    if (database.isUpdateApplied(plan.version)) return
    database.updateMeta(ingestionState = "updating", ingestionError = null, clearIngestionError = true)
    val archive = plan.archiveFile
    val totalSid = inspection.sidEntries.coerceAtLeast(0)
    emitter.emit(
      stage = Stages.ArchiveExtraction,
      message = "Extracting ${plan.displayName}…",
      archiveName = archive.name,
      totalCount = totalSid,
    )
    val md5Durations = mutableMapOf<String, Int>()
    val deletions = mutableListOf<String>()
    val batch = mutableListOf<HvscSongRecord>()
    val now = System.currentTimeMillis()
    var processed = 0
    var upserted = 0
    var success = false

    try {
      database.withTransaction {
        HvscArchiveReaderFactory.open(archive, null).use { reader ->
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
                  batch.add(
                    HvscSongRecord(
                      virtualPath = virtualPath,
                      dirPath = if (dirPath.isBlank()) "/" else dirPath,
                      fileName = fileName,
                      sizeBytes = data.size.toLong(),
                      md5 = md5,
                      durationSeconds = durationSeconds,
                      data = data,
                      sourceVersion = plan.version,
                      createdAtUtcMs = now,
                      updatedAtUtcMs = now,
                    ),
                  )
                  processed += 1
                  emitter.emit(
                    stage = Stages.SidMetadataParsing,
                    message = "Parsed $virtualPath",
                    archiveName = archive.name,
                    currentFile = virtualPath,
                    processedCount = processed,
                    totalCount = totalSid,
                  )
                  if (batch.size >= BATCH_SIZE) {
                    database.upsertSongs(batch)
                    upserted += batch.size
                    emitter.emit(
                      stage = Stages.DatabaseInsertion,
                      message = "Inserted ${upserted.toString()} SID file(s)",
                      archiveName = archive.name,
                      processedCount = processed,
                      totalCount = totalSid,
                      songsUpserted = upserted,
                    )
                    batch.clear()
                  }
                }
              }
            }
            entry = reader.nextEntry()
          }
        }

        if (deletions.isNotEmpty()) {
          database.deleteByVirtualPaths(deletions)
        }
        if (batch.isNotEmpty()) {
          database.upsertSongs(batch)
          upserted += batch.size
          emitter.emit(
            stage = Stages.DatabaseInsertion,
            message = "Inserted ${upserted.toString()} SID file(s)",
            archiveName = archive.name,
            processedCount = processed,
            totalCount = totalSid,
            songsUpserted = upserted,
          )
          batch.clear()
        }
        database.updateDurationsByMd5(md5Durations)
        database.updateMeta(
          installedVersion = plan.version,
          ingestionState = "ready",
          ingestionError = null,
          clearIngestionError = true,
        )
        database.markUpdateApplied(plan.version, "success")
      }
      emitter.emit(
        stage = Stages.Complete,
        message = "${plan.displayName} indexed",
        archiveName = archive.name,
        processedCount = totalSid,
        totalCount = totalSid,
        percent = 100,
        songsUpserted = upserted,
        songsDeleted = deletions.size,
      )
      success = true
    } catch (error: Exception) {
      database.markUpdateApplied(plan.version, "failed", error.message)
      throw error
    } finally {
      if (success) {
        archive.delete()
      }
    }
  }

  private fun calculatePercent(processed: Int?, total: Int?): Int? {
    if (processed == null || total == null || total <= 0) return null
    return ((processed.toLong() * 100) / total.toLong()).toInt().coerceIn(0, 100)
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
