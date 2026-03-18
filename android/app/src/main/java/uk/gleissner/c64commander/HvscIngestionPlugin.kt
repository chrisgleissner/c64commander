/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.ContentValues
import android.database.DatabaseUtils
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.RandomAccessFile
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import java.util.regex.Pattern
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry
import org.apache.commons.compress.archivers.sevenz.SevenZFile
import org.tukaani.xz.LZMA2Options

@CapacitorPlugin(name = "HvscIngestion")
open class HvscIngestionPlugin : Plugin() {
  private val logTag = "HvscIngestionPlugin"
  private val scope = CoroutineScope(Dispatchers.IO)
  private var activeJob: Job? = null
  private val cancellationRequested = AtomicBoolean(false)

  private companion object {
    private const val MAX_DELETION_LIST_SIZE_BYTES = 10L * 1024 * 1024
    private const val MAX_ARCHIVE_CHUNK_SIZE_BYTES = 1024 * 1024
    private val REQUIRED_XZ_CLASS: Class<*> = LZMA2Options::class.java
    private val UNSUPPORTED_SEVEN_Z_METHOD_PATTERN =
            Pattern.compile("Unsupported compression method \\[(.*?)\\]", Pattern.CASE_INSENSITIVE)
    /**
     * Matches IOException messages that indicate a corrupt or truncated archive.
     * "offset bytes must be larger equal zero" is Android's RandomAccessFile.seek()
     * message when SevenZFile internally seeks to a negative offset caused by a
     * corrupt or truncated End-of-Archive block in the .7z file.
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

  private fun ensureSevenZipRuntimeClasses() {
    try {
      REQUIRED_XZ_CLASS.name
    } catch (error: Throwable) {
      throw IllegalStateException("Missing required XZ runtime classes for SevenZ ingestion", error)
    }
  }

  private fun buildIngestionFailureMessage(error: Exception): String {
    val message = error.message ?: "HVSC ingestion failed"
    val methodMatcher = UNSUPPORTED_SEVEN_Z_METHOD_PATTERN.matcher(message)
    if (methodMatcher.find()) {
      val methodChain = methodMatcher.group(1) ?: "unknown"
      return "HVSC 7z method chain [$methodChain] is unsupported by Android native extraction; retry will use the non-native fallback extractor"
    }
    if (CORRUPT_ARCHIVE_PATTERN.matcher(message).find()) {
      return "HVSC archive is corrupt or truncated; please re-download"
    }
    return message
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
    }
  }

  private fun applyDeletionRows(db: SQLiteDatabase, paths: List<String>): Int {
    if (paths.isEmpty()) return 0
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
    }
  }

  private fun getSongIndexCount(db: SQLiteDatabase): Long {
    return DatabaseUtils.longForQuery(db, "SELECT COUNT(*) FROM hvsc_song_index", null)
  }

  private fun normalizeEntryPath(raw: String): String {
    val normalized = raw.replace('\\', '/').trimStart('/')
    val stripped =
            when {
              normalized.startsWith("HVSC/", ignoreCase = true) -> normalized.substring(5)
              normalized.startsWith("C64Music/", ignoreCase = true) -> normalized.substring(9)
              else -> normalized
            }
    return stripped
  }

  private fun normalizeUpdateEntryPath(raw: String): String {
    val stripped = normalizeEntryPath(raw)
    val lowered = stripped.lowercase(Locale.US)
    return when {
      lowered.startsWith("new/") -> stripped.substring(4)
      lowered.startsWith("update/") -> stripped.substring(7)
      lowered.startsWith("updated/") -> stripped.substring(8)
      else -> stripped
    }
  }

  private fun isDeletionList(path: String): Boolean {
    val lowered = path.lowercase(Locale.US)
    return lowered.endsWith(".txt") && (lowered.contains("delete") || lowered.contains("remove"))
  }

  private fun parseDeletionList(content: String): List<String> {
    return content.split(Regex("\\r?\\n"))
            .map { it.trim() }
            .filter { it.isNotEmpty() && it.lowercase(Locale.US).endsWith(".sid") }
            .map { if (it.startsWith("/")) it else "/$it" }
  }

  private fun ensureWithinRoot(root: File, candidate: File): File {
    val rootPath = root.canonicalPath
    val candidatePath = candidate.canonicalPath
    if (!candidatePath.startsWith(rootPath)) {
      throw IllegalStateException("Archive entry escapes HVSC library root: $candidatePath")
    }
    return candidate
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
  )

  private suspend fun ingestSevenZip(
          archiveFile: File,
          libraryRoot: File,
          db: SQLiteDatabase,
          mode: String,
          progressEvery: Int,
          dbBatchSize: Int,
          debugHeapLogging: Boolean,
  ): IngestionResult {
    var processedEntries = 0
    var songsIngested = 0
    var songsDeleted = 0
    var failedSongs = 0
    var songlengthFilesWritten = 0
    val failedPaths = mutableListOf<String>()
    val pendingDeletions = mutableListOf<String>()
    val pendingUpserts = mutableListOf<SongUpsertRow>()
    var metadataUpserts = 0

    ensureSevenZipRuntimeClasses()

    SevenZFile(archiveFile).use { sevenZip ->
      var entry: SevenZArchiveEntry? = sevenZip.nextEntry
      while (entry != null) {
        val currentEntry = entry
        currentCoroutineContext().ensureActive()
        if (cancellationRequested.get()) throw CancellationException("HVSC ingestion cancelled")
        if (!currentEntry.isDirectory) {
          val rawPath = currentEntry.name ?: ""
          val normalizedPath =
                  if (mode == "update") normalizeUpdateEntryPath(rawPath)
                  else normalizeEntryPath(rawPath)
          if (normalizedPath.isNotBlank()) {
            val lowered = normalizedPath.lowercase(Locale.US)
            val targetFile = ensureWithinRoot(libraryRoot, File(libraryRoot, normalizedPath))
            targetFile.parentFile?.mkdirs()

            if (isDeletionList(normalizedPath)) {
              val entrySize = currentEntry.size
              if (entrySize in 1..MAX_DELETION_LIST_SIZE_BYTES) {
                val bytes = ByteArray(entrySize.toInt())
                var offset = 0
                while (offset < bytes.size) {
                  val read = sevenZip.read(bytes, offset, bytes.size - offset)
                  if (read <= 0) break
                  offset += read
                }
                val text = String(bytes, Charsets.UTF_8)
                pendingDeletions.addAll(parseDeletionList(text))
              } else {
                AppLogger.warn(
                        pluginContextOrNull(),
                        logTag,
                        "Skipping deletion list due to unexpected size: path=$normalizedPath entrySize=$entrySize",
                        "HvscIngestionPlugin",
                )
              }
            } else if (lowered.endsWith("songlengths.md5") || lowered.endsWith("songlengths.txt")) {
              BufferedOutputStream(FileOutputStream(targetFile)).use { output ->
                val buffer = ByteArray(32 * 1024)
                var remaining = currentEntry.size
                while (remaining > 0) {
                  val request = minOf(buffer.size.toLong(), remaining).toInt()
                  val read = sevenZip.read(buffer, 0, request)
                  if (read <= 0) break
                  output.write(buffer, 0, read)
                  remaining -= read
                }
                output.flush()
              }
              songlengthFilesWritten += 1
            } else if (lowered.endsWith(".sid")) {
              try {
                BufferedOutputStream(FileOutputStream(targetFile)).use { output ->
                  val buffer = ByteArray(32 * 1024)
                  var remaining = currentEntry.size
                  val sidHeaderBuffer = ByteArray(0x80)
                  var sidHeaderLength = 0
                  while (remaining > 0) {
                    val request = minOf(buffer.size.toLong(), remaining).toInt()
                    val read = sevenZip.read(buffer, 0, request)
                    if (read <= 0) break
                    if (sidHeaderLength < sidHeaderBuffer.size) {
                      val toCopy = minOf(read, sidHeaderBuffer.size - sidHeaderLength)
                      buffer.copyInto(sidHeaderBuffer, sidHeaderLength, 0, toCopy)
                      sidHeaderLength += toCopy
                    }
                    output.write(buffer, 0, read)
                    remaining -= read
                  }
                  output.flush()
                  val sidHeader = parseSidHeader(sidHeaderBuffer, sidHeaderLength)
                  pendingUpserts.add(
                          SongUpsertRow(
                                  virtualPath = "/$normalizedPath",
                                  fileName = targetFile.name,
                                  songs = sidHeader?.songs,
                                  startSong = sidHeader?.startSong,
                          ),
                  )
                  if (pendingUpserts.size >= dbBatchSize) {
                    metadataUpserts += flushSongBatch(db, pendingUpserts)
                  }
                }
                songsIngested += 1
              } catch (error: Exception) {
                failedSongs += 1
                failedPaths.add("/$normalizedPath")
                AppLogger.error(
                        pluginContextOrNull(),
                        logTag,
                        "Failed to ingest SID entry $normalizedPath",
                        "HvscIngestionPlugin",
                        error
                )
              }
            }
          }
        }

        processedEntries += 1
        if (processedEntries % progressEvery == 0) {
          emitProgress(
                  stage = "sid_metadata_parsing",
                  message = "Processing HVSC archive…",
                  processedCount = processedEntries,
                  totalCount = null,
                  currentFile = currentEntry.name,
                  songsIngested = songsIngested,
                  songsDeleted = songsDeleted,
          )
          if (debugHeapLogging) {
            val runtime = Runtime.getRuntime()
            val used = runtime.totalMemory() - runtime.freeMemory()
            AppLogger.info(
                    pluginContextOrNull(),
                    logTag,
                    "HVSC heap snapshot: used=$used",
                    "HvscIngestionPlugin"
            )
          }
          kotlinx.coroutines.yield()
        }

        entry = sevenZip.nextEntry
      }
    }

    metadataUpserts += flushSongBatch(db, pendingUpserts)

    val deletedVirtualPaths = mutableListOf<String>()
    pendingDeletions.forEach { deletionPath ->
      val normalized = deletionPath.removePrefix("/")
      val target = ensureWithinRoot(libraryRoot, File(libraryRoot, normalized))
      if (target.exists() && target.isFile) {
        if (target.delete()) {
          songsDeleted += 1
          deletedVirtualPaths.add("/$normalized")
        } else {
          AppLogger.warn(
                  pluginContextOrNull(),
                  logTag,
                  "Failed to delete update target $normalized",
                  "HvscIngestionPlugin"
          )
        }
      }
    }
    val metadataDeletes = applyDeletionRows(db, deletedVirtualPaths)
    val metadataRows = getSongIndexCount(db)

    return IngestionResult(
            totalEntries = processedEntries,
            songsIngested = songsIngested,
            songsDeleted = songsDeleted,
            failedSongs = failedSongs,
            failedPaths = failedPaths,
            songlengthFilesWritten = songlengthFilesWritten,
            metadataRows = metadataRows,
            metadataUpserts = metadataUpserts,
            metadataDeletes = metadataDeletes,
    )
  }

  private suspend fun ingestZip(
          archiveFile: File,
          libraryRoot: File,
          db: SQLiteDatabase,
          mode: String,
          progressEvery: Int,
          dbBatchSize: Int,
          debugHeapLogging: Boolean,
  ): IngestionResult {
    var processedEntries = 0
    var songsIngested = 0
    var songsDeleted = 0
    var failedSongs = 0
    var songlengthFilesWritten = 0
    val failedPaths = mutableListOf<String>()
    val pendingDeletions = mutableListOf<String>()
    val pendingUpserts = mutableListOf<SongUpsertRow>()
    var metadataUpserts = 0

    ZipInputStream(BufferedInputStream(archiveFile.inputStream())).use { zip ->
      var entry: ZipEntry? = zip.nextEntry
      while (entry != null) {
        currentCoroutineContext().ensureActive()
        if (cancellationRequested.get()) throw CancellationException("HVSC ingestion cancelled")
        if (!entry.isDirectory) {
          val rawPath = entry.name ?: ""
          val normalizedPath =
                  if (mode == "update") normalizeUpdateEntryPath(rawPath)
                  else normalizeEntryPath(rawPath)
          if (normalizedPath.isNotBlank()) {
            val lowered = normalizedPath.lowercase(Locale.US)
            val targetFile = ensureWithinRoot(libraryRoot, File(libraryRoot, normalizedPath))
            targetFile.parentFile?.mkdirs()

            if (isDeletionList(normalizedPath)) {
              val bytes = readFully(normalizedPath, zip)
              pendingDeletions.addAll(parseDeletionList(String(bytes, Charsets.UTF_8)))
            } else if (lowered.endsWith("songlengths.md5") || lowered.endsWith("songlengths.txt")) {
              BufferedOutputStream(FileOutputStream(targetFile)).use { output ->
                val buffer = ByteArray(32 * 1024)
                while (true) {
                  val read = zip.read(buffer)
                  if (read <= 0) break
                  output.write(buffer, 0, read)
                }
                output.flush()
              }
              songlengthFilesWritten += 1
            } else if (lowered.endsWith(".sid")) {
              try {
                BufferedOutputStream(FileOutputStream(targetFile)).use { output ->
                  val buffer = ByteArray(32 * 1024)
                  val sidHeaderBuffer = ByteArray(0x80)
                  var sidHeaderLength = 0
                  while (true) {
                    val read = zip.read(buffer)
                    if (read <= 0) break
                    if (sidHeaderLength < sidHeaderBuffer.size) {
                      val toCopy = minOf(read, sidHeaderBuffer.size - sidHeaderLength)
                      buffer.copyInto(sidHeaderBuffer, sidHeaderLength, 0, toCopy)
                      sidHeaderLength += toCopy
                    }
                    output.write(buffer, 0, read)
                  }
                  output.flush()
                  val sidHeader = parseSidHeader(sidHeaderBuffer, sidHeaderLength)
                  pendingUpserts.add(
                          SongUpsertRow(
                                  virtualPath = "/$normalizedPath",
                                  fileName = targetFile.name,
                                  songs = sidHeader?.songs,
                                  startSong = sidHeader?.startSong,
                          ),
                  )
                  if (pendingUpserts.size >= dbBatchSize) {
                    metadataUpserts += flushSongBatch(db, pendingUpserts)
                  }
                }
                songsIngested += 1
              } catch (error: Exception) {
                failedSongs += 1
                failedPaths.add("/$normalizedPath")
                AppLogger.error(
                        pluginContextOrNull(),
                        logTag,
                        "Failed to ingest SID entry $normalizedPath",
                        "HvscIngestionPlugin",
                        error
                )
              }
            }
          }
        }

        processedEntries += 1
        if (processedEntries % progressEvery == 0) {
          emitProgress(
                  stage = "sid_metadata_parsing",
                  message = "Processing HVSC archive…",
                  processedCount = processedEntries,
                  totalCount = null,
                  currentFile = entry.name,
                  songsIngested = songsIngested,
                  songsDeleted = songsDeleted,
          )
          if (debugHeapLogging) {
            val runtime = Runtime.getRuntime()
            val used = runtime.totalMemory() - runtime.freeMemory()
            AppLogger.info(
                    pluginContextOrNull(),
                    logTag,
                    "HVSC heap snapshot: used=$used",
                    "HvscIngestionPlugin"
            )
          }
          kotlinx.coroutines.yield()
        }
        zip.closeEntry()
        entry = zip.nextEntry
      }
    }

    metadataUpserts += flushSongBatch(db, pendingUpserts)

    val deletedVirtualPaths = mutableListOf<String>()
    pendingDeletions.forEach { deletionPath ->
      val normalized = deletionPath.removePrefix("/")
      val target = ensureWithinRoot(libraryRoot, File(libraryRoot, normalized))
      if (target.exists() && target.isFile) {
        if (target.delete()) {
          songsDeleted += 1
          deletedVirtualPaths.add("/$normalized")
        } else {
          AppLogger.warn(
                  pluginContextOrNull(),
                  logTag,
                  "Failed to delete update target $normalized",
                  "HvscIngestionPlugin"
          )
        }
      }
    }
    val metadataDeletes = applyDeletionRows(db, deletedVirtualPaths)
    val metadataRows = getSongIndexCount(db)

    return IngestionResult(
            totalEntries = processedEntries,
            songsIngested = songsIngested,
            songsDeleted = songsDeleted,
            failedSongs = failedSongs,
            failedPaths = failedPaths,
            songlengthFilesWritten = songlengthFilesWritten,
            metadataRows = metadataRows,
            metadataUpserts = metadataUpserts,
            metadataDeletes = metadataDeletes,
    )
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
              var dbHelper: HvscMetadataDbHelper? = null
              var db: SQLiteDatabase? = null
              try {
                val archiveFile = resolveArchiveFile(relativeArchivePath)
                if (archiveFile.length() <= 0L) {
                  throw IllegalStateException("HVSC archive is empty: ${archiveFile.absolutePath}")
                }

                val filesDir = context.filesDir
                val libraryRoot = File(filesDir, "hvsc/library")
                dbHelper = HvscMetadataDbHelper(this@HvscIngestionPlugin)
                db = dbHelper.writableDatabase
                if (resetLibrary && libraryRoot.exists()) {
                  libraryRoot.deleteRecursively()
                }
                if (!libraryRoot.exists() && !libraryRoot.mkdirs()) {
                  throw IllegalStateException(
                          "Failed to create HVSC library directory: ${libraryRoot.absolutePath}"
                  )
                }
                if (resetLibrary) {
                  db.beginTransaction()
                  try {
                    db.delete("hvsc_song_index", null, null)
                    db.setTransactionSuccessful()
                  } finally {
                    db.endTransaction()
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

                val lowered = archiveFile.name.lowercase(Locale.US)
                val result =
                        when {
                          lowered.endsWith(".7z") ->
                                  ingestSevenZip(
                                          archiveFile,
                                          libraryRoot,
                                          db,
                                          mode,
                                          progressEvery.coerceAtLeast(1),
                                          dbBatchSize.coerceAtLeast(1),
                                          debugHeapLogging,
                                  )
                          lowered.endsWith(".zip") ->
                                  ingestZip(
                                          archiveFile,
                                          libraryRoot,
                                          db,
                                          mode,
                                          progressEvery.coerceAtLeast(1),
                                          dbBatchSize.coerceAtLeast(1),
                                          debugHeapLogging,
                                  )
                          else ->
                                  throw IllegalStateException(
                                          "Unsupported archive format: ${archiveFile.name}"
                                  )
                        }

                if (result.metadataRows < minExpectedRows.toLong()) {
                  throw IllegalStateException(
                          "HVSC metadata row count below threshold: ${result.metadataRows} < $minExpectedRows"
                  )
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
              }
            }
  }

  @PluginMethod
  fun readArchiveChunk(call: PluginCall) {
    val relativeArchivePath = call.getString("relativeArchivePath")
    val offsetBytes = call.getLong("offsetBytes") ?: -1L
    val requestedLength = call.getInt("lengthBytes") ?: 0

    if (relativeArchivePath.isNullOrBlank()) {
      call.reject("relativeArchivePath is required")
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

  override fun handleOnDestroy() {
    cancellationRequested.set(true)
    activeJob?.cancel(CancellationException("Plugin destroyed"))
    scope.cancel()
    super.handleOnDestroy()
  }
}
