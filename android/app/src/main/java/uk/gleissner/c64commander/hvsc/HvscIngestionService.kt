package uk.gleissner.c64commander.hvsc

import java.io.File
import java.util.Locale
import java.util.UUID

internal class HvscIngestionService(
  private val stateStore: HvscStateStore,
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
    const val Songlengths = "songlengths"
    const val SidMetadataParsing = "sid_metadata_parsing"
    const val Complete = "complete"
    const val Error = "error"
  }

  private inner class ProgressEmitter(
    private val ingestionId: String,
    private val onProgress: (Progress) -> Unit
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
      errorCause: String? = null
    ) {
      val elapsed = System.currentTimeMillis() - startedAt
      onProgress(
        Progress(
          ingestionId = ingestionId,
          stage = stage,
          message = message,
          archiveName = archiveName,
          currentFile = currentFile,
          processedCount = processedCount,
          totalCount = totalCount,
          percent = percent ?: calculatePercent(processedCount, totalCount),
          downloadedBytes = downloadedBytes,
          totalBytes = totalBytes,
          songsUpserted = songsUpserted,
          songsDeleted = songsDeleted,
          elapsedTimeMs = elapsed,
          errorType = errorType,
          errorCause = errorCause
        )
      )
    }

    fun emitError(error: Exception, stage: String, archiveName: String?) {
      emit(
        stage = stage,
        message = error.message ?: "Unknown error",
        archiveName = archiveName,
        errorType = error::class.java.simpleName,
        errorCause = error.cause?.message
      )
    }
  }

  fun getStatus(): HvscMeta {
    return stateStore.load().toMeta()
  }

  fun getCacheStatus(workDir: File): CacheStatus {
    if (!workDir.exists()) return CacheStatus(null, emptyList())
    val entries = workDir.listFiles()?.toList() ?: emptyList()
    val baselineVersions = entries.mapNotNull { parseCachedVersion("hvsc-baseline", it.name) }
    val updateVersions = entries.mapNotNull { parseCachedVersion("hvsc-update", it.name) }
    return CacheStatus(
      baselineVersion = baselineVersions.maxOrNull(),
      updateVersions = updateVersions.distinct().sorted(),
    )
  }

  private fun parseCachedVersion(prefix: String, name: String): Int? {
    val regex = Regex("^${Regex.escape(prefix)}-(\\d+)(\\..+)?$")
    val match = regex.find(name) ?: return null
    return match.groupValues[1].toIntOrNull()
  }

  fun checkForUpdates(): HvscUpdateStatus {
    val (baselineLatest, updateLatest) = releaseService.fetchLatestVersions()
    stateStore.updateMeta(lastUpdateCheckUtcMs = System.currentTimeMillis())
    val meta = stateStore.load().toMeta()
    val installedVersion = meta.installedVersion
    val requiredUpdates = when {
      installedVersion == 0 && updateLatest > baselineLatest -> (baselineLatest + 1..updateLatest).toList()
      installedVersion in 1 until updateLatest -> (installedVersion + 1..updateLatest).toList()
      else -> emptyList()
    }
    return HvscUpdateStatus(
      latestVersion = updateLatest,
      installedVersion = installedVersion,
      requiredUpdates = requiredUpdates,
      baselineVersion = baselineLatest,
    )
  }

  fun installOrUpdate(
    workDir: File,
    cancelToken: HvscCancelRegistry.CancellationToken?,
    onProgress: (Progress) -> Unit,
  ): HvscMeta {
    val ingestionId = UUID.randomUUID().toString()
    val emitter = ProgressEmitter(ingestionId, onProgress)
    emitter.emit(Stages.Start, "HVSC install/update started")
    var currentArchive: String? = null
    try {
      if (!workDir.exists()) {
        workDir.mkdirs()
      }
      val (baselineLatest, updateLatest) = releaseService.fetchLatestVersions()
      stateStore.updateMeta(lastUpdateCheckUtcMs = System.currentTimeMillis())
      val meta = stateStore.load().toMeta()
      val plans = buildInstallPlan(meta, baselineLatest, updateLatest, workDir)
      if (plans.isEmpty()) {
        emitter.emit(Stages.Complete, "HVSC already up to date")
        return stateStore.load().toMeta()
      }
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
      emitter.emit(Stages.Complete, "HVSC install/update complete")
      return stateStore.load().toMeta()
    } catch (error: Exception) {
      stateStore.updateMeta(ingestionState = "error", ingestionError = error.message)
      emitter.emitError(error, Stages.Error, currentArchive)
      throw error
    }
  }

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
      val meta = stateStore.load().toMeta()
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
      return stateStore.load().toMeta()
    } catch (error: Exception) {
      stateStore.updateMeta(ingestionState = "error", ingestionError = error.message)
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
      val cachedBaseline = resolveArchiveFile(workDir, "hvsc-baseline", baselineLatest)
      val baselineArchive = cachedBaseline ?: File(workDir, "hvsc-baseline-$baselineLatest.7z")
      val useCached = cachedBaseline != null
      plans.add(
        ArchivePlan(
          type = ArchiveType.BASELINE,
          version = baselineLatest,
          archiveFile = baselineArchive,
          downloadUrl = if (useCached) null else releaseService.buildBaselineUrl(baselineLatest),
          useCached = useCached,
        ),
      )
    }
    val installedVersion = if (meta.installedVersion == 0) baselineLatest else meta.installedVersion
    if (installedVersion < updateLatest) {
      for (version in (installedVersion + 1)..updateLatest) {
        val cachedUpdate = resolveArchiveFile(workDir, "hvsc-update", version)
        val updateArchive = cachedUpdate ?: File(workDir, "hvsc-update-$version.7z")
        val useCached = cachedUpdate != null
        plans.add(
          ArchivePlan(
            type = ArchiveType.UPDATE,
            version = version,
            archiveFile = updateArchive,
            downloadUrl = if (useCached) null else releaseService.buildUpdateUrl(version),
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
      File(workDir, "$prefix-$version"),
      File(workDir, "$prefix-$version.7z"),
      File(workDir, "$prefix-$version.zip"),
    )
    return candidates.firstOrNull { candidate ->
      candidate.exists() && (candidate.isDirectory || candidate.length() > 0)
    }
  }

  private fun resolveArchiveSize(file: File): Long {
    if (!file.exists()) return 0
    if (file.isFile) return file.length()
    return file.walkTopDown().filter { it.isFile }.sumOf { it.length() }
  }

  private fun prepareArchive(
    plan: ArchivePlan,
    cancelToken: HvscCancelRegistry.CancellationToken?,
    emitter: ProgressEmitter,
  ): HvscArchiveInspector.Inspection {
    val archive = plan.archiveFile
    if (plan.useCached || plan.downloadUrl == null) {
      if (!archive.exists() || (!archive.isDirectory && archive.length() == 0L)) {
        throw IllegalStateException("Missing cached archive ${archive.name}")
      }
      val archiveBytes = resolveArchiveSize(archive)
      emitter.emit(
        stage = Stages.Download,
        message = "Using cached ${plan.displayName}",
        archiveName = archive.name,
        percent = 100,
        downloadedBytes = archiveBytes,
        totalBytes = archiveBytes,
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
    stateStore.updateMeta(ingestionState = "installing", ingestionError = null, clearIngestionError = true)
    val archive = plan.archiveFile
    val totalSid = inspection.sidEntries.coerceAtLeast(0)
    emitter.emit(
      stage = Stages.ArchiveExtraction,
      message = "Extracting ${plan.displayName}…",
      archiveName = archive.name,
      totalCount = totalSid,
    )
    val libraryRoot = resolveLibraryRoot(archive)
    if (libraryRoot.exists()) {
      libraryRoot.deleteRecursively()
    }
    if (!libraryRoot.exists()) {
      libraryRoot.mkdirs()
    }
    var processed = 0
    var success = false

    try {
      HvscArchiveReaderFactory.open(archive, null).use { reader ->
        var entry = reader.nextEntry()
        while (entry != null) {
          cancelIfNeeded(cancelToken)
          if (!entry.isDirectory) {
            val normalized = normalizeEntryName(entry.name)
            val lowered = normalized.lowercase(Locale.getDefault())
            val targetPath = when {
              lowered.endsWith("songlengths.md5") || lowered.endsWith("songlengths.txt") -> normalizeLibraryPath(normalized)
              lowered.endsWith(".sid") -> normalizeVirtualPath(normalized)
              else -> null
            }
            if (targetPath != null) {
              val data = reader.readEntryBytes()
              writeLibraryFile(libraryRoot, targetPath, data)
              if (lowered.endsWith("songlengths.md5")) {
                val parsed = SonglengthsParser.parse(String(data, Charsets.UTF_8))
                emitter.emit(
                  stage = Stages.Songlengths,
                  message = "Loaded songlengths.md5 (${parsed.pathToSeconds.size} paths, ${parsed.md5ToSeconds.size} md5 entries)",
                  archiveName = archive.name,
                )
              } else if (lowered.endsWith("songlengths.txt")) {
                val parsed = SonglengthsParser.parseText(String(data, Charsets.UTF_8))
                emitter.emit(
                  stage = Stages.Songlengths,
                  message = "Loaded songlengths.txt (${parsed.pathToSeconds.size} paths)",
                  archiveName = archive.name,
                )
              } else {
                processed += 1
                emitter.emit(
                  stage = Stages.SidMetadataParsing,
                  message = "Parsed $targetPath",
                  archiveName = archive.name,
                  currentFile = targetPath,
                  processedCount = processed,
                  totalCount = totalSid,
                )
              }
            }
          }
          entry = reader.nextEntry()
        }
      }
      stateStore.updateMeta(
        installedBaselineVersion = plan.version,
        installedVersion = plan.version,
        ingestionState = "ready",
        ingestionError = null,
        clearIngestionError = true,
      )
      success = true
    } finally {
      if (!success) {
        stateStore.updateMeta(ingestionState = "error", ingestionError = "Baseline ingest failed")
      }
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
      songsUpserted = processed,
      songsDeleted = 0,
    )
  }

  private fun applyUpdateArchive(
    plan: ArchivePlan,
    inspection: HvscArchiveInspector.Inspection,
    cancelToken: HvscCancelRegistry.CancellationToken?,
    emitter: ProgressEmitter,
  ) {
    if (stateStore.isUpdateApplied(plan.version)) return
    stateStore.updateMeta(ingestionState = "updating", ingestionError = null, clearIngestionError = true)
    val archive = plan.archiveFile
    val totalSid = inspection.sidEntries.coerceAtLeast(0)
    emitter.emit(
      stage = Stages.ArchiveExtraction,
      message = "Extracting ${plan.displayName}…",
      archiveName = archive.name,
      totalCount = totalSid,
    )
    val deletions = mutableListOf<String>()
    var processed = 0
    var success = false
    val libraryRoot = resolveLibraryRoot(archive)
    if (!libraryRoot.exists()) {
      libraryRoot.mkdirs()
    }

    try {
      HvscArchiveReaderFactory.open(archive, null).use { reader ->
        var entry = reader.nextEntry()
        while (entry != null) {
          cancelIfNeeded(cancelToken)
          if (!entry.isDirectory) {
            val normalized = normalizeEntryName(entry.name)
            val lowered = normalized.lowercase(Locale.getDefault())
            when {
              isDeletionList(normalized) -> {
                val text = String(reader.readEntryBytes(), Charsets.UTF_8)
                deletions.addAll(parseDeletionList(text))
              }
              lowered.endsWith("songlengths.md5") || lowered.endsWith("songlengths.txt") -> {
                val targetPath = normalizeUpdateLibraryPath(normalized)
                if (targetPath != null) {
                  val data = reader.readEntryBytes()
                  writeLibraryFile(libraryRoot, targetPath, data)
                  if (lowered.endsWith("songlengths.md5")) {
                    val parsed = SonglengthsParser.parse(String(data, Charsets.UTF_8))
                    emitter.emit(
                      stage = Stages.Songlengths,
                      message = "Loaded songlengths.md5 (${parsed.pathToSeconds.size} paths, ${parsed.md5ToSeconds.size} md5 entries)",
                      archiveName = archive.name,
                    )
                  } else {
                    val parsed = SonglengthsParser.parseText(String(data, Charsets.UTF_8))
                    emitter.emit(
                      stage = Stages.Songlengths,
                      message = "Loaded songlengths.txt (${parsed.pathToSeconds.size} paths)",
                      archiveName = archive.name,
                    )
                  }
                }
              }
              lowered.endsWith(".sid") -> {
                val data = reader.readEntryBytes()
                val virtualPath = normalizeUpdateVirtualPath(normalized)
                if (virtualPath != null) {
                  writeLibraryFile(libraryRoot, virtualPath, data)
                  processed += 1
                  emitter.emit(
                    stage = Stages.SidMetadataParsing,
                    message = "Parsed $virtualPath",
                    archiveName = archive.name,
                    currentFile = virtualPath,
                    processedCount = processed,
                    totalCount = totalSid,
                  )
                }
              }
            }
          }
          entry = reader.nextEntry()
        }
      }

      deletions.forEach { path ->
        resolveLibraryFile(libraryRoot, path)?.let { file ->
          if (file.exists()) {
            file.delete()
          }
        }
      }

      stateStore.updateMeta(
        installedVersion = plan.version,
        ingestionState = "ready",
        ingestionError = null,
        clearIngestionError = true,
      )
      stateStore.markUpdateApplied(plan.version, "success", null)
      emitter.emit(
        stage = Stages.Complete,
        message = "${plan.displayName} indexed",
        archiveName = archive.name,
        processedCount = totalSid,
        totalCount = totalSid,
        percent = 100,
        songsUpserted = processed,
        songsDeleted = deletions.size,
      )
      success = true
    } catch (error: Exception) {
      stateStore.markUpdateApplied(plan.version, "failed", error.message)
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
      stateStore.updateMeta(ingestionState = "idle", ingestionError = "Cancelled")
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

  private fun normalizeLibraryPath(entryName: String): String? {
    val name = normalizeEntryName(entryName)
    val withoutRoot = name
      .removePrefix("HVSC/")
      .removePrefix("C64Music/")
      .removePrefix("C64MUSIC/")
      .trimStart('/')
    return if (withoutRoot.isBlank()) null else "/$withoutRoot"
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

  private fun normalizeUpdateLibraryPath(entryName: String): String? {
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
    return normalizeLibraryPath(base)
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

  private fun resolveLibraryRoot(archiveFile: File): File = File(archiveFile.parentFile, "library")

  private fun resolveLibraryFile(rootDir: File, virtualPath: String): File? {
    val relative = virtualPath.trimStart('/')
    if (relative.isBlank()) return null
    val file = File(rootDir, relative)
    ensureSafeTarget(rootDir, file)
    return file
  }

  private fun writeLibraryFile(rootDir: File, virtualPath: String, data: ByteArray) {
    val target = resolveLibraryFile(rootDir, virtualPath) ?: return
    val parent = target.parentFile
    if (parent != null && !parent.exists()) {
      parent.mkdirs()
    }
    target.writeBytes(data)
  }

  private fun ensureSafeTarget(rootDir: File, target: File) {
    val rootCanonical = rootDir.canonicalFile
    val targetCanonical = target.canonicalFile
    if (!targetCanonical.path.startsWith(rootCanonical.path)) {
      throw IllegalArgumentException("Archive entry resolves outside HVSC root: ${target.path}")
    }
  }
}
