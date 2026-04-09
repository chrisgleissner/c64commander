/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.app.ActivityManager
import android.content.ComponentCallbacks2
import android.content.ContentValues
import android.database.DatabaseUtils
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.os.Trace
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.InputStream
import java.io.RandomAccessFile
import java.util.concurrent.atomic.AtomicBoolean
import java.util.regex.Pattern
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uk.gleissner.c64commander.hvsc.DefaultHvscArchiveExtractor
import uk.gleissner.c64commander.hvsc.ExtractedSong
import uk.gleissner.c64commander.hvsc.ExtractionProgress
import uk.gleissner.c64commander.hvsc.HvscArchiveExtractor
import uk.gleissner.c64commander.hvsc.HvscArchiveMode
import uk.gleissner.c64commander.hvsc.InsufficientMemoryException
import uk.gleissner.c64commander.hvsc.MemoryBudget

@CapacitorPlugin(name = "HvscIngestion")
open class HvscIngestionPlugin : Plugin() {
  private val logTag = "HvscIngestionPlugin"
  private val scope = CoroutineScope(Dispatchers.IO)
  private var activeJob: Job? = null
  private val cancellationRequested = AtomicBoolean(false)
  private val archiveExtractor: HvscArchiveExtractor by lazy { createArchiveExtractor() }
  private val trimMemoryCallbacks =
          object : ComponentCallbacks2 {
            override fun onConfigurationChanged(newConfig: android.content.res.Configuration) = Unit

            override fun onLowMemory() {
              requestCancellation("System reported low memory")
            }

            override fun onTrimMemory(level: Int) {
              if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL) {
                requestCancellation("System trim memory level $level")
              }
            }
          }

  private companion object {
    private const val MAX_DELETION_LIST_SIZE_BYTES = 10L * 1024 * 1024
    private const val MAX_ARCHIVE_CHUNK_SIZE_BYTES = 1024 * 1024
    private val UNSUPPORTED_SEVEN_Z_METHOD_PATTERN =
            Pattern.compile("Unsupported compression method \\[(.*?)\\]", Pattern.CASE_INSENSITIVE)
    /**
     * Matches IOException messages that indicate a corrupt or truncated archive. "offset bytes must
     * be larger equal zero" is Android's RandomAccessFile.seek() message when SevenZFile internally
     * seeks to a negative offset caused by a corrupt or truncated End-of-Archive block in the .7z
     * file.
     */
    private val CORRUPT_ARCHIVE_PATTERN =
            Pattern.compile(
                    "offset bytes.*larger.*equal zero" +
                            "|corrupt.*archive|archive.*corrupt" +
                            "|unexpected end.*archive|end of central directory not found" +
                            "|truncated.*archive|archive.*truncated",
                    Pattern.CASE_INSENSITIVE,
            )
  }

  override fun load() {
    super.load()
    context.registerComponentCallbacks(trimMemoryCallbacks)
  }

  private fun buildIngestionFailureMessage(error: Exception): String {
    if (error is InsufficientMemoryException) {
      return error.message
              ?: "HVSC extraction was refused because the device memory budget is too small"
    }
    val message = error.message ?: "HVSC ingestion failed"
    val methodMatcher = UNSUPPORTED_SEVEN_Z_METHOD_PATTERN.matcher(message)
    if (methodMatcher.find()) {
      val methodChain = methodMatcher.group(1) ?: "unknown"
      return "HVSC 7z method chain [$methodChain] is unsupported by the bundled upstream extractor"
    }
    if (CORRUPT_ARCHIVE_PATTERN.matcher(message).find()) {
      return "HVSC archive is corrupt or truncated; please re-download"
    }
    return message
  }

  internal open fun createArchiveExtractor(): HvscArchiveExtractor {
    return DefaultHvscArchiveExtractor { resolveBundledSevenZipExecutable() }
  }

  internal open fun resolveBundledSevenZipExecutable(): File {
    val nativeLibraryDir =
            context.applicationInfo.nativeLibraryDir?.let(::File)
                    ?: throw IllegalStateException(
                            "Android native library directory unavailable for HVSC extraction"
                    )
    val bundledExecutable = File(nativeLibraryDir, "lib7zz.so")
    if (!bundledExecutable.exists()) {
      throw IllegalStateException(
              "Bundled upstream 7-Zip executable is missing: ${bundledExecutable.absolutePath}"
      )
    }
    return bundledExecutable
  }

  private fun buildMemoryBudget(): MemoryBudget {
    val runtime = Runtime.getRuntime()
    val activityManager = context.getSystemService(ActivityManager::class.java)
    val memoryInfo = ActivityManager.MemoryInfo()
    activityManager?.getMemoryInfo(memoryInfo)
    val memoryClassBytes = ((activityManager?.memoryClass ?: 256).toLong() * 1024L * 1024L)
    val runtimeBytes = runtime.maxMemory().coerceAtLeast(0L)
    val availableBytes = memoryInfo.availMem.coerceAtLeast(0L)
    val computedBudget =
            minOf(
                    if (availableBytes > 0L) availableBytes / 2L else Long.MAX_VALUE,
                    maxOf(memoryClassBytes * 2L, runtimeBytes * 2L),
            )
    return MemoryBudget(
            maxExtractionBytes = computedBudget,
            detail =
                    "availMem=${availableBytes} memoryClass=${memoryClassBytes} runtimeMax=${runtimeBytes}",
    )
  }

  private fun requestCancellation(reason: String) {
    if (activeJob?.isActive != true) {
      return
    }
    cancellationRequested.set(true)
    AppLogger.warn(
            pluginContextOrNull(),
            logTag,
            "Cancelling HVSC ingestion due to memory pressure: $reason",
            "HvscIngestionPlugin",
    )
  }

  private fun pluginContextOrNull() =
          try {
            context
          } catch (_: Throwable) {
            null
          }

  private fun resolveArchiveFile(relativeArchivePath: String): File {
    val archiveFile = File(context.filesDir, relativeArchivePath)
    if (!archiveFile.exists() || !archiveFile.isFile) {
      throw IllegalStateException("HVSC archive not found: ${archiveFile.absolutePath}")
    }
    return archiveFile
  }

  private fun traceFields(call: PluginCall): AppLogger.TraceFields {
    val trace = call.getObject("traceContext") ?: return AppLogger.TraceFields()
    return AppLogger.TraceFields(
            correlationId = trace.getString("correlationId"),
            trackInstanceId = trace.getInteger("trackInstanceId")?.toString(),
            playlistItemId = trace.getString("playlistItemId"),
            sourceKind = trace.getString("sourceKind"),
            localAccessMode = trace.getString("localAccessMode"),
            lifecycleState = trace.getString("lifecycleState"),
    )
  }

  private class HvscMetadataDbHelper(plugin: HvscIngestionPlugin) :
          SQLiteOpenHelper(
                  plugin.context,
                  "hvsc_metadata.db",
                  null,
                  1,
          ) {
    override fun onCreate(db: SQLiteDatabase) {
      db.execSQL(
              """
          CREATE TABLE IF NOT EXISTS hvsc_song_index (
            virtual_path TEXT PRIMARY KEY,
            file_name TEXT NOT NULL,
            songs INTEGER,
            start_song INTEGER,
            updated_at_ms INTEGER NOT NULL
          )
        """.trimIndent(),
      )
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_hvsc_song_file_name ON hvsc_song_index(file_name)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
      db.execSQL("DROP TABLE IF EXISTS hvsc_song_index")
      onCreate(db)
    }
  }

  private data class SongUpsertRow(
          val virtualPath: String,
          val fileName: String,
          val songs: Int?,
          val startSong: Int?,
  )

  private data class SidHeader(
          val songs: Int,
          val startSong: Int,
  )

  private fun parseSidHeader(headerBytes: ByteArray, headerLength: Int): SidHeader? {
    if (headerLength < 0x12) return null
    val magic = String(headerBytes, 0, 4, Charsets.US_ASCII)
    if (magic != "PSID" && magic != "RSID") return null
    val songs = ((headerBytes[0x0E].toInt() and 0xFF) shl 8) or (headerBytes[0x0F].toInt() and 0xFF)
    val startSong =
            ((headerBytes[0x10].toInt() and 0xFF) shl 8) or (headerBytes[0x11].toInt() and 0xFF)
    return SidHeader(songs = songs, startSong = startSong)
  }

  private fun flushSongBatch(db: SQLiteDatabase, batch: MutableList<SongUpsertRow>): Int {
    if (batch.isEmpty()) return 0
    Trace.beginSection("hvsc:flushSongBatch")
    var applied = 0
    db.beginTransaction()
    try {
      val updatedAt = System.currentTimeMillis()
      batch.forEach { row ->
        val values =
                ContentValues().apply {
                  put("virtual_path", row.virtualPath)
                  put("file_name", row.fileName)
                  if (row.songs != null) put("songs", row.songs) else putNull("songs")
                  if (row.startSong != null) put("start_song", row.startSong)
                  else putNull("start_song")
                  put("updated_at_ms", updatedAt)
                }
        db.insertWithOnConflict("hvsc_song_index", null, values, SQLiteDatabase.CONFLICT_REPLACE)
        applied += 1
      }
      db.setTransactionSuccessful()
      batch.clear()
      return applied
    } finally {
      db.endTransaction()
      Trace.endSection()
    }
  }

  private fun applyDeletionRows(db: SQLiteDatabase, paths: List<String>): Int {
    if (paths.isEmpty()) return 0
    Trace.beginSection("hvsc:applyDeletionRows")
    var deleted = 0
    db.beginTransaction()
    try {
      paths.forEach { rawPath ->
        val normalized = if (rawPath.startsWith("/")) rawPath else "/$rawPath"
        deleted += db.delete("hvsc_song_index", "virtual_path = ?", arrayOf(normalized))
      }
      db.setTransactionSuccessful()
      return deleted
    } finally {
      db.endTransaction()
      Trace.endSection()
    }
  }

  private fun getSongIndexCount(db: SQLiteDatabase): Long {
    return DatabaseUtils.longForQuery(db, "SELECT COUNT(*) FROM hvsc_song_index", null)
  }

  private fun emitProgress(
          stage: String,
          message: String,
          processedCount: Int,
          totalCount: Int?,
          currentFile: String?,
          songsIngested: Int,
          songsDeleted: Int,
  ) {
    val payload = JSObject()
    payload.put("stage", stage)
    payload.put("message", message)
    payload.put("processedCount", processedCount)
    payload.put("songsUpserted", songsIngested)
    payload.put("songsDeleted", songsDeleted)
    if (totalCount != null && totalCount > 0) {
      payload.put("totalCount", totalCount)
      payload.put("percent", ((processedCount.toDouble() / totalCount.toDouble()) * 100.0).toInt())
    }
    if (!currentFile.isNullOrBlank()) payload.put("currentFile", currentFile)
    notifyListeners("hvscProgress", payload)
  }

  private fun readFully(
          entryName: String,
          stream: InputStream,
          maxBytes: Int = 2 * 1024 * 1024
  ): ByteArray {
    val chunks = ArrayList<ByteArray>()
    var total = 0
    val buffer = ByteArray(8 * 1024)
    while (true) {
      val read = stream.read(buffer)
      if (read <= 0) break
      total += read
      if (total > maxBytes) {
        throw IllegalStateException(
                "Entry $entryName exceeds allowed metadata read size ($maxBytes bytes)"
        )
      }
      chunks.add(buffer.copyOf(read))
    }
    val combined = ByteArray(total)
    var offset = 0
    chunks.forEach {
      it.copyInto(combined, offset)
      offset += it.size
    }
    return combined
  }

  private data class IngestionResult(
          val totalEntries: Int,
          val songsIngested: Int,
          val songsDeleted: Int,
          val failedSongs: Int,
          val failedPaths: List<String>,
          val songlengthFilesWritten: Int,
          val metadataRows: Long,
          val metadataUpserts: Int,
          val metadataDeletes: Int,
          val deferredUpserts: List<SongUpsertRow> = emptyList(),
  )

  private fun toSongUpsertRows(rows: List<ExtractedSong>): MutableList<SongUpsertRow> {
    return rows
            .map {
              SongUpsertRow(
                      virtualPath = it.virtualPath,
                      fileName = it.fileName,
                      songs = it.songs,
                      startSong = it.startSong,
              )
            }
            .toMutableList()
  }

  private fun applyDeletionFiles(libraryRoot: File, deletionPaths: List<String>): List<String> {
    val deletedVirtualPaths = mutableListOf<String>()
    deletionPaths.forEach { deletionPath ->
      val normalized = deletionPath.removePrefix("/")
      val target = File(libraryRoot, normalized)
      if (target.exists() && target.isFile && target.delete()) {
        deletedVirtualPaths.add("/$normalized")
      }
    }
    return deletedVirtualPaths
  }

  @PluginMethod
  fun ingestHvsc(call: PluginCall) {
    val relativeArchivePath = call.getString("relativeArchivePath")
    val mode = call.getString("mode") ?: "baseline"
    val resetLibrary = call.getBoolean("resetLibrary", false) ?: false
    val progressEvery = call.getInt("progressEvery", 250) ?: 250
    val dbBatchSize = call.getInt("dbBatchSize", 500) ?: 500
    val minExpectedRows = call.getInt("minExpectedRows", 0) ?: 0
    val debugHeapLogging = call.getBoolean("debugHeapLogging", false) ?: false

    if (relativeArchivePath.isNullOrBlank()) {
      call.reject("relativeArchivePath is required")
      return
    }
    if (mode != "baseline" && mode != "update") {
      call.reject("mode must be baseline or update")
      return
    }
    if (activeJob?.isActive == true) {
      call.reject("HVSC ingestion already running")
      return
    }

    cancellationRequested.set(false)
    activeJob =
            scope.launch {
              Trace.beginSection("hvsc:ingestHvsc")
              var dbHelper: HvscMetadataDbHelper? = null
              var db: SQLiteDatabase? = null
              val filesDir = context.filesDir
              val stagingRoot = File(filesDir, "hvsc/library-staging")
              val oldRoot = File(filesDir, "hvsc/library-old")
              try {
                val archiveFile = resolveArchiveFile(relativeArchivePath)
                if (archiveFile.length() <= 0L) {
                  throw IllegalStateException("HVSC archive is empty: ${archiveFile.absolutePath}")
                }

                val libraryRoot = File(filesDir, "hvsc/library")
                dbHelper = HvscMetadataDbHelper(this@HvscIngestionPlugin)
                db = dbHelper.writableDatabase
                val writableDb =
                        db ?: throw IllegalStateException("Failed to open HVSC metadata database")

                // Clean up stale staging artifacts from a previous interrupted ingest
                if (stagingRoot.exists()) stagingRoot.deleteRecursively()
                if (oldRoot.exists()) oldRoot.deleteRecursively()

                val extractionRoot = if (resetLibrary) stagingRoot else libraryRoot
                if (resetLibrary) {
                  if (!stagingRoot.mkdirs()) {
                    throw IllegalStateException(
                            "Failed to create HVSC staging directory: ${stagingRoot.absolutePath}"
                    )
                  }
                } else {
                  if (!libraryRoot.exists() && !libraryRoot.mkdirs()) {
                    throw IllegalStateException(
                            "Failed to create HVSC library directory: ${libraryRoot.absolutePath}"
                    )
                  }
                }

                emitProgress(
                        stage = "archive_extraction",
                        message = "Streaming archive ingestion started",
                        processedCount = 0,
                        totalCount = null,
                        currentFile = null,
                        songsIngested = 0,
                        songsDeleted = 0,
                )

                val ingestionMode =
                        if (mode == "update") HvscArchiveMode.UPDATE else HvscArchiveMode.BASELINE
                val progressModulo = progressEvery.coerceAtLeast(1)
                var lastReportedProgress = 0
                val extractionResult =
                        archiveExtractor.extract(
                                archiveFile = archiveFile,
                                outputDir = extractionRoot,
                                mode = ingestionMode,
                                cancellationToken = cancellationRequested,
                                memoryBudget = buildMemoryBudget(),
                                onProgress = { progress: ExtractionProgress ->
                                  if (progress.processedEntries == progress.totalEntries ||
                                                  progress.processedEntries -
                                                          lastReportedProgress >= progressModulo
                                  ) {
                                    lastReportedProgress = progress.processedEntries
                                    emitProgress(
                                            stage = "sid_metadata_parsing",
                                            message = "Processing HVSC archive…",
                                            processedCount = progress.processedEntries,
                                            totalCount = progress.totalEntries,
                                            currentFile = progress.currentFile,
                                            songsIngested = progress.songsExtracted,
                                            songsDeleted = 0,
                                    )
                                    if (debugHeapLogging) {
                                      val runtime = Runtime.getRuntime()
                                      val used = runtime.totalMemory() - runtime.freeMemory()
                                      AppLogger.info(
                                              pluginContextOrNull(),
                                              logTag,
                                              "HVSC heap snapshot: used=$used",
                                              "HvscIngestionPlugin",
                                      )
                                    }
                                  }
                                },
                        )

                val pendingUpserts = toSongUpsertRows(extractionResult.extractedSongs)
                var metadataUpserts = 0
                if (!resetLibrary) {
                  while (pendingUpserts.isNotEmpty()) {
                    val batchCount = minOf(pendingUpserts.size, dbBatchSize.coerceAtLeast(1))
                    val nextBatch = pendingUpserts.subList(0, batchCount).toMutableList()
                    metadataUpserts += flushSongBatch(writableDb, nextBatch)
                    pendingUpserts.subList(0, batchCount).clear()
                  }
                }

                val deletedVirtualPaths =
                        applyDeletionFiles(extractionRoot, extractionResult.deletionPaths)
                val songsDeleted = deletedVirtualPaths.size
                val metadataDeletes =
                        if (!resetLibrary) applyDeletionRows(writableDb, deletedVirtualPaths) else 0
                val metadataRows =
                        if (!resetLibrary) getSongIndexCount(writableDb)
                        else extractionResult.extractedSongs.size.toLong()
                val result =
                        IngestionResult(
                                totalEntries = extractionResult.totalEntries,
                                songsIngested = extractionResult.songsIngested,
                                songsDeleted = songsDeleted,
                                failedSongs = extractionResult.failedSongs,
                                failedPaths = extractionResult.failedPaths,
                                songlengthFilesWritten = extractionResult.songlengthFilesWritten,
                                metadataRows = metadataRows,
                                metadataUpserts = metadataUpserts,
                                metadataDeletes = metadataDeletes,
                                deferredUpserts =
                                        if (resetLibrary)
                                                extractionResult.extractedSongs.map {
                                                  SongUpsertRow(
                                                          virtualPath = it.virtualPath,
                                                          fileName = it.fileName,
                                                          songs = it.songs,
                                                          startSong = it.startSong,
                                                  )
                                                }
                                        else emptyList(),
                        )

                if (result.metadataRows < minExpectedRows.toLong()) {
                  // Clean up staging if validation fails
                  if (resetLibrary && stagingRoot.exists()) stagingRoot.deleteRecursively()
                  throw IllegalStateException(
                          "HVSC metadata row count below threshold: ${result.metadataRows} < $minExpectedRows"
                  )
                }

                // Atomic promotion: DB swap + directory swap for baseline ingests
                if (resetLibrary) {
                  val updatedAt = System.currentTimeMillis()
                  writableDb.beginTransaction()
                  try {
                    writableDb.delete("hvsc_song_index", null, null)
                    for (row in result.deferredUpserts) {
                      val cv =
                              ContentValues().apply {
                                put("virtual_path", row.virtualPath)
                                put("file_name", row.fileName)
                                if (row.songs != null) put("songs", row.songs) else putNull("songs")
                                if (row.startSong != null) put("start_song", row.startSong)
                                else putNull("start_song")
                                put("updated_at_ms", updatedAt)
                              }
                      writableDb.insertWithOnConflict(
                              "hvsc_song_index",
                              null,
                              cv,
                              SQLiteDatabase.CONFLICT_REPLACE
                      )
                    }
                    writableDb.setTransactionSuccessful()
                  } finally {
                    writableDb.endTransaction()
                  }

                  // Directory swap: staging → library (atomically visible)
                  if (libraryRoot.exists()) {
                    if (!libraryRoot.renameTo(oldRoot)) {
                      throw IllegalStateException(
                              "Failed to rename library to old: ${libraryRoot.absolutePath}"
                      )
                    }
                  }
                  if (!stagingRoot.renameTo(libraryRoot)) {
                    // Attempt to recover: rename old back to library
                    if (oldRoot.exists()) oldRoot.renameTo(libraryRoot)
                    throw IllegalStateException(
                            "Failed to promote staging directory: ${stagingRoot.absolutePath}"
                    )
                  }
                  if (oldRoot.exists()) oldRoot.deleteRecursively()
                }

                val payload = JSObject()
                payload.put("totalEntries", result.totalEntries)
                payload.put("songsIngested", result.songsIngested)
                payload.put("songsDeleted", result.songsDeleted)
                payload.put("failedSongs", result.failedSongs)
                payload.put("songlengthFilesWritten", result.songlengthFilesWritten)
                payload.put("metadataRows", result.metadataRows)
                payload.put("metadataUpserts", result.metadataUpserts)
                payload.put("metadataDeletes", result.metadataDeletes)
                payload.put("archiveBytes", archiveFile.length())
                val failedPaths = JSArray()
                result.failedPaths.forEach { failedPaths.put(it) }
                payload.put("failedPaths", failedPaths)

                emitProgress(
                        stage = "complete",
                        message = "Streaming archive ingestion completed",
                        processedCount = result.totalEntries,
                        totalCount = result.totalEntries,
                        currentFile = null,
                        songsIngested = result.songsIngested,
                        songsDeleted = result.songsDeleted,
                )

                withContext(Dispatchers.Main) { call.resolve(payload) }
              } catch (cancelled: CancellationException) {
                // Clean up staging artifacts on cancellation
                if (resetLibrary) {
                  try {
                    stagingRoot.deleteRecursively()
                  } catch (_: Exception) {}
                  try {
                    oldRoot.deleteRecursively()
                  } catch (_: Exception) {}
                }
                AppLogger.warn(
                        pluginContextOrNull(),
                        logTag,
                        "HVSC ingestion cancelled",
                        "HvscIngestionPlugin",
                        cancelled,
                        traceFields(call)
                )
                withContext(Dispatchers.Main) { call.reject("HVSC ingestion cancelled", cancelled) }
              } catch (error: Exception) {
                // Clean up staging artifacts on failure
                if (resetLibrary) {
                  try {
                    stagingRoot.deleteRecursively()
                  } catch (_: Exception) {}
                  try {
                    oldRoot.deleteRecursively()
                  } catch (_: Exception) {}
                }
                AppLogger.error(
                        pluginContextOrNull(),
                        logTag,
                        "HVSC ingestion failed",
                        "HvscIngestionPlugin",
                        error,
                        traceFields(call)
                )
                withContext(Dispatchers.Main) {
                  call.reject(buildIngestionFailureMessage(error), error)
                }
              } finally {
                try {
                  db?.close()
                } catch (error: Exception) {
                  AppLogger.warn(
                          pluginContextOrNull(),
                          logTag,
                          "Failed to close HVSC metadata database",
                          "HvscIngestionPlugin",
                          error
                  )
                }
                try {
                  dbHelper?.close()
                } catch (error: Exception) {
                  AppLogger.warn(
                          pluginContextOrNull(),
                          logTag,
                          "Failed to close HVSC metadata db helper",
                          "HvscIngestionPlugin",
                          error
                  )
                }
                Trace.endSection()
              }
            }
  }

  @PluginMethod
  fun readArchiveChunk(call: PluginCall) {
    val relativeArchivePath = call.getString("relativeArchivePath")
    // Use call.data directly to distinguish absent field (null) from zero value (0L).
    // call.getLong() returns null for both absent and zero on some Capacitor versions.
    val offsetBytes: Long? =
            if (call.data.has("offsetBytes")) call.data.getLong("offsetBytes") else null
    val requestedLength = call.getInt("lengthBytes") ?: 0

    AppLogger.debug(
            pluginContextOrNull(),
            logTag,
            "readArchiveChunk: offsetBytes=${offsetBytes} lengthBytes=${requestedLength} path=${relativeArchivePath}",
            "HvscIngestionPlugin",
    )

    if (relativeArchivePath.isNullOrBlank()) {
      call.reject("relativeArchivePath is required")
      return
    }
    if (offsetBytes == null) {
      call.reject("offsetBytes is required")
      return
    }
    if (offsetBytes < 0L) {
      call.reject("offsetBytes must be >= 0")
      return
    }
    if (requestedLength <= 0) {
      call.reject("lengthBytes must be > 0")
      return
    }

    try {
      val archiveFile = resolveArchiveFile(relativeArchivePath)
      val boundedLength = requestedLength.coerceAtMost(MAX_ARCHIVE_CHUNK_SIZE_BYTES)
      RandomAccessFile(archiveFile, "r").use { input ->
        input.seek(offsetBytes)
        val buffer = ByteArray(boundedLength)
        val bytesRead = input.read(buffer)
        val payload = JSObject()
        if (bytesRead <= 0) {
          payload.put("data", "")
          payload.put("sizeBytes", 0)
          payload.put("eof", true)
          call.resolve(payload)
          return
        }
        val actual = if (bytesRead == buffer.size) buffer else buffer.copyOf(bytesRead)
        payload.put("data", android.util.Base64.encodeToString(actual, android.util.Base64.NO_WRAP))
        payload.put("sizeBytes", bytesRead)
        payload.put("eof", offsetBytes + bytesRead >= archiveFile.length())
        call.resolve(payload)
      }
    } catch (error: Exception) {
      AppLogger.error(
              pluginContextOrNull(),
              logTag,
              "HVSC archive chunk read failed",
              "HvscIngestionPlugin",
              error,
              traceFields(call),
      )
      call.reject(error.message ?: "HVSC archive chunk read failed", error)
    }
  }

  @PluginMethod
  fun getIngestionStats(call: PluginCall) {
    var dbHelper: HvscMetadataDbHelper? = null
    var db: SQLiteDatabase? = null
    try {
      dbHelper = HvscMetadataDbHelper(this)
      db = dbHelper.readableDatabase
      val payload = JSObject()
      payload.put("metadataRows", getSongIndexCount(db))
      call.resolve(payload)
    } catch (error: Exception) {
      AppLogger.error(
              pluginContextOrNull(),
              logTag,
              "Failed to read HVSC ingestion stats",
              "HvscIngestionPlugin",
              error,
              traceFields(call)
      )
      call.reject(error.message, error)
    } finally {
      try {
        db?.close()
      } catch (error: Exception) {
        AppLogger.warn(
                pluginContextOrNull(),
                logTag,
                "Failed to close HVSC metadata database after stats",
                "HvscIngestionPlugin",
                error
        )
      }
      try {
        dbHelper?.close()
      } catch (error: Exception) {
        AppLogger.warn(
                pluginContextOrNull(),
                logTag,
                "Failed to close HVSC metadata db helper after stats",
                "HvscIngestionPlugin",
                error
        )
      }
    }
  }

  @PluginMethod
  fun cancelIngestion(call: PluginCall) {
    cancellationRequested.set(true)
    activeJob?.cancel(CancellationException("Cancelled by request"))
    call.resolve()
  }

  @PluginMethod
  fun queryAllSongs(call: PluginCall) {
    var dbHelper: HvscMetadataDbHelper? = null
    var db: SQLiteDatabase? = null
    try {
      dbHelper = HvscMetadataDbHelper(this)
      db = dbHelper.readableDatabase
      val songs = JSArray()
      db.rawQuery("SELECT virtual_path, file_name FROM hvsc_song_index ORDER BY virtual_path", null)
              .use { cursor ->
                val pathIdx = cursor.getColumnIndexOrThrow("virtual_path")
                val nameIdx = cursor.getColumnIndexOrThrow("file_name")
                while (cursor.moveToNext()) {
                  val row = JSObject()
                  row.put("virtualPath", cursor.getString(pathIdx))
                  row.put("fileName", cursor.getString(nameIdx))
                  songs.put(row)
                }
              }
      val payload = JSObject()
      payload.put("songs", songs)
      payload.put("totalSongs", songs.length())
      call.resolve(payload)
    } catch (error: Exception) {
      AppLogger.error(
              pluginContextOrNull(),
              logTag,
              "Failed to query all HVSC songs",
              "HvscIngestionPlugin",
              error,
              traceFields(call)
      )
      call.reject(error.message ?: "HVSC queryAllSongs failed", error)
    } finally {
      try {
        db?.close()
      } catch (error: Exception) {
        AppLogger.warn(
                pluginContextOrNull(),
                logTag,
                "Failed to close HVSC metadata database after queryAllSongs",
                "HvscIngestionPlugin",
                error
        )
      }
      try {
        dbHelper?.close()
      } catch (error: Exception) {
        AppLogger.warn(
                pluginContextOrNull(),
                logTag,
                "Failed to close HVSC metadata db helper after queryAllSongs",
                "HvscIngestionPlugin",
                error
        )
      }
    }
  }

  override fun handleOnDestroy() {
    cancellationRequested.set(true)
    activeJob?.cancel(CancellationException("Plugin destroyed"))
    try {
      context.unregisterComponentCallbacks(trimMemoryCallbacks)
    } catch (_: Exception) {}
    scope.cancel()
    super.handleOnDestroy()
  }
}
