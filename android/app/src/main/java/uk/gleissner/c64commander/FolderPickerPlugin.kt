/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import androidx.activity.result.ActivityResult
import androidx.documentfile.provider.DocumentFile
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.Executors

@CapacitorPlugin(name = "FolderPicker")
class FolderPickerPlugin : Plugin() {
  private val executor = Executors.newSingleThreadExecutor()
  private val logTag = "FolderPickerPlugin"
  // Base64 encoding a fully-buffered file costs another ~1.33x on top of the raw
  // bytes; without a cap, tapping a large file (a .dnp disk pack, firmware image)
  // via SAF drives the app into OOM. 32MB keeps peak heap for a single read well
  // within normal app budgets. See HARD9-044.
  // internal var so tests can shrink it instead of generating multi-MB payloads.
  internal var maxReadFileBytes = 32L * 1024L * 1024L
  private val readChunkSize = 64 * 1024

  private fun toJsArray(entries: List<JSObject>): JSArray {
    val array = JSArray()
    entries.forEach { entry -> array.put(entry) }
    return array
  }

  // Reads bounded by maxReadFileBytes regardless of what (if any) size metadata
  // the content provider reports - a declared size can be absent, wrong, or
  // simply not queried, so the guard has to hold during the actual read, not
  // just as an upfront check.
  private fun readBytesWithLimit(input: java.io.InputStream): ByteArray {
    val output = java.io.ByteArrayOutputStream(readChunkSize)
    val buffer = ByteArray(readChunkSize)
    var totalRead = 0L
    while (true) {
      val read = input.read(buffer)
      if (read == -1) break
      totalRead += read
      if (totalRead > maxReadFileBytes) {
        throw IllegalStateException(
                "File exceeds the maximum readable size (${maxReadFileBytes / (1024 * 1024)}MB)"
        )
      }
      output.write(buffer, 0, read)
    }
    return output.toByteArray()
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

  private fun pluginContextOrNull(): Context? {
    return try {
      context
    } catch (_: Throwable) {
      null
    }
  }

  private fun parseStringArray(call: PluginCall, key: String): List<String> {
    val source = call.getArray(key) ?: return emptyList()
    val values = mutableListOf<String>()
    for (index in 0 until source.length()) {
      val value = source.opt(index)?.toString()?.trim()
      if (!value.isNullOrEmpty()) {
        values.add(value)
      }
    }
    return values
  }

  @PluginMethod
  fun pickDirectory(call: PluginCall) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
    val initialUriString = call.getString("initialUri")
    if (!initialUriString.isNullOrBlank() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(initialUriString))
      } catch (error: Exception) {
        AppLogger.warn(
                pluginContextOrNull(),
                logTag,
                "Invalid initial directory URI provided",
                "FolderPickerPlugin",
                error,
                traceFields(call)
        )
      }
    }
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    intent.addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
    startActivityForResult(call, intent, "pickDirectoryResult")
  }

  @PluginMethod
  fun pickFile(call: PluginCall) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
    intent.addCategory(Intent.CATEGORY_OPENABLE)
    val extensions =
            parseStringArray(call, "extensions")
                    .map { ext -> ext.removePrefix(".").lowercase() }
                    .filter { ext -> ext.isNotBlank() }
    intent.type =
            if (extensions.size == 1 && extensions.first() == "bin") {
              "application/octet-stream"
            } else {
              "*/*"
            }
    val mimeTypes = parseStringArray(call, "mimeTypes")
    if (mimeTypes.isNotEmpty()) {
      intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toTypedArray())
    }
    val initialUriString = call.getString("initialUri")
    if (!initialUriString.isNullOrBlank() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(initialUriString))
      } catch (error: Exception) {
        AppLogger.warn(
                pluginContextOrNull(),
                logTag,
                "Invalid initial URI provided",
                "FolderPickerPlugin",
                error,
                traceFields(call)
        )
      }
    }
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    startActivityForResult(call, intent, "pickFileResult")
  }

  @ActivityCallback
  private fun pickDirectoryResult(call: PluginCall, result: ActivityResult) {
    if (result.resultCode != Activity.RESULT_OK) {
      call.reject("Folder selection canceled")
      return
    }

    val data = result.data
    val treeUri = data?.data
    if (treeUri == null) {
      call.reject("No directory selected")
      return
    }

    val flags =
            data.flags and
                    (Intent.FLAG_GRANT_READ_URI_PERMISSION or
                            Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    try {
      context.contentResolver.takePersistableUriPermission(treeUri, flags)
    } catch (error: SecurityException) {
      AppLogger.error(
              pluginContextOrNull(),
              logTag,
              "Persistable permission rejected",
              "FolderPickerPlugin",
              error,
              traceFields(call)
      )
      call.reject("Persistable permission rejected: ${error.message}", error)
      return
    }

    executor.execute {
      try {
        val root =
                DocumentFile.fromTreeUri(context, treeUri)
                        ?: throw IllegalStateException("Unable to access selected directory")
        val permissionPersisted =
                context.contentResolver.persistedUriPermissions.any {
                  it.uri == treeUri && it.isReadPermission
                }
        if (!permissionPersisted) {
          throw IllegalStateException("Persistable permission not persisted")
        }
        val response = JSObject()
        response.put("treeUri", treeUri.toString())
        response.put("rootName", root.name ?: "")
        response.put("permissionPersisted", true)
        call.resolve(response)
      } catch (error: Exception) {
        AppLogger.error(
                pluginContextOrNull(),
                logTag,
                "Folder picker directory resolution failed",
                "FolderPickerPlugin",
                error,
                traceFields(call)
        )
        call.reject(error.message, error)
      }
    }
  }

  @ActivityCallback
  private fun pickFileResult(call: PluginCall, result: ActivityResult) {
    if (result.resultCode != Activity.RESULT_OK) {
      call.reject("File selection canceled")
      return
    }

    val data = result.data
    val fileUri = data?.data
    if (fileUri == null) {
      call.reject("No file selected")
      return
    }

    val flags =
            data.flags and
                    (Intent.FLAG_GRANT_READ_URI_PERMISSION or
                            Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    try {
      context.contentResolver.takePersistableUriPermission(fileUri, flags)
    } catch (error: SecurityException) {
      AppLogger.error(
              pluginContextOrNull(),
              logTag,
              "Persistable permission rejected",
              "FolderPickerPlugin",
              error,
              traceFields(call)
      )
      call.reject("Persistable permission rejected: ${error.message}", error)
      return
    }

    executor.execute {
      try {
        val doc =
                DocumentFile.fromSingleUri(context, fileUri)
                        ?: throw IllegalStateException("Unable to access selected file")
        val extensions =
                parseStringArray(call, "extensions")
                        .map { ext -> ext.removePrefix(".").lowercase() }
                        .filter { ext -> ext.isNotBlank() }
        val fileName = doc.name ?: ""
        if (extensions.isNotEmpty()) {
          val normalizedName = fileName.lowercase()
          val matches = extensions.any { ext -> normalizedName.endsWith(".$ext") }
          if (!matches) {
            throw IllegalStateException("Selected file does not match required extension.")
          }
        }
        val permissionPersisted =
                context.contentResolver.persistedUriPermissions.any {
                  it.uri == fileUri && it.isReadPermission
                }
        if (!permissionPersisted) {
          throw IllegalStateException("Persistable permission not persisted")
        }
        val response = JSObject()
        response.put("uri", fileUri.toString())
        response.put("name", fileName)
        response.put("sizeBytes", doc.length())
        val modifiedAt =
                if (doc.lastModified() > 0) {
                  val formatter =
                          java.text.SimpleDateFormat(
                                  "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                                  java.util.Locale.US
                          )
                  formatter.timeZone = java.util.TimeZone.getTimeZone("UTC")
                  formatter.format(java.util.Date(doc.lastModified()))
                } else null
        response.put("modifiedAt", modifiedAt)
        val documentId = DocumentsContract.getDocumentId(fileUri)
        val parentDocumentId = documentId.substringBeforeLast('/', "")
        val authority = fileUri.authority
        if (parentDocumentId.isNotBlank() && !authority.isNullOrBlank()) {
          val parentTreeUri = DocumentsContract.buildTreeDocumentUri(authority, parentDocumentId)
          try {
            context.contentResolver.takePersistableUriPermission(parentTreeUri, flags)
          } catch (error: SecurityException) {
            AppLogger.warn(
                    pluginContextOrNull(),
                    logTag,
                    "Parent tree permission rejected",
                    "FolderPickerPlugin",
                    error,
                    traceFields(call)
            )
          }
          val parentRoot = DocumentFile.fromTreeUri(context, parentTreeUri)
          response.put("parentTreeUri", parentTreeUri.toString())
          response.put("parentRootName", parentRoot?.name ?: "")
        }
        response.put("permissionPersisted", true)
        call.resolve(response)
      } catch (error: Exception) {
        AppLogger.error(
                pluginContextOrNull(),
                logTag,
                "Folder picker file resolution failed",
                "FolderPickerPlugin",
                error,
                traceFields(call)
        )
        call.reject(error.message, error)
      }
    }
  }

  @PluginMethod
  fun listChildren(call: PluginCall) {
    val treeUriString = call.getString("treeUri")
    if (treeUriString.isNullOrBlank()) {
      call.reject("treeUri is required")
      return
    }
    val treeUri = Uri.parse(treeUriString)
    val relativePath = call.getString("path")

    executor.execute {
      try {
        val documentId = resolveDocumentId(treeUri, relativePath, true)
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, documentId)
        val projection =
                arrayOf(
                        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                        DocumentsContract.Document.COLUMN_MIME_TYPE
                )
        val entries = mutableListOf<JSObject>()
        context.contentResolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
          val nameIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
          val mimeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
          val base = normalizePath(relativePath)
          while (cursor.moveToNext()) {
            val name = cursor.getString(nameIndex) ?: continue
            val mimeType = cursor.getString(mimeIndex) ?: ""
            val type = if (mimeType == DocumentsContract.Document.MIME_TYPE_DIR) "dir" else "file"
            val entry = JSObject()
            entry.put("name", name)
            entry.put("type", type)
            entry.put("path", buildChildPath(base, name))
            entries.add(entry)
          }
        }
                ?: throw IllegalStateException("Unable to list directory")
        val response = JSObject()
        response.put("entries", toJsArray(entries))
        call.resolve(response)
      } catch (error: Exception) {
        AppLogger.error(
                pluginContextOrNull(),
                logTag,
                "SAF listChildren failed",
                "FolderPickerPlugin",
                error,
                traceFields(call)
        )
        call.reject(error.message, error)
      }
    }
  }

  @PluginMethod
  fun getPersistedUris(call: PluginCall) {
    val entries = mutableListOf<JSObject>()
    context.contentResolver.persistedUriPermissions.forEach { permission ->
      val entry = JSObject()
      entry.put("uri", permission.uri.toString())
      entry.put("read", permission.isReadPermission)
      entry.put("write", permission.isWritePermission)
      entry.put("persistedAt", permission.persistedTime)
      entries.add(entry)
    }
    val response = JSObject()
    response.put("uris", toJsArray(entries))
    call.resolve(response)
  }

  @PluginMethod
  fun releasePersistedUris(call: PluginCall) {
    val released = mutableListOf<JSObject>()
    val failures = mutableListOf<String>()
    var firstFailure: Exception? = null

    context.contentResolver.persistedUriPermissions.toList().forEach { permission ->
      val flags =
              (if (permission.isReadPermission) Intent.FLAG_GRANT_READ_URI_PERMISSION else 0) or
                      (if (permission.isWritePermission) Intent.FLAG_GRANT_WRITE_URI_PERMISSION else 0)
      if (flags == 0) return@forEach
      val entry = JSObject()
      entry.put("uri", permission.uri.toString())
      entry.put("read", permission.isReadPermission)
      entry.put("write", permission.isWritePermission)
      entry.put("persistedAt", permission.persistedTime)
      try {
        context.contentResolver.releasePersistableUriPermission(permission.uri, flags)
        released.add(entry)
      } catch (error: Exception) {
        if (firstFailure == null) {
          firstFailure = error
        }
        failures.add(permission.uri.toString())
        AppLogger.warn(
                pluginContextOrNull(),
                logTag,
                "Persisted URI permission release failed",
                "FolderPickerPlugin",
                error,
                traceFields(call)
        )
      }
    }

    if (failures.isNotEmpty()) {
      call.reject(
              "Failed to release ${failures.size} persisted URI permission(s): ${failures.joinToString()}",
              firstFailure
      )
      return
    }

    val response = JSObject()
    response.put("released", toJsArray(released))
    call.resolve(response)
  }

  @PluginMethod
  fun readFile(call: PluginCall) {
    val uri = call.getString("uri")
    if (uri.isNullOrBlank()) {
      call.reject("uri is required")
      return
    }

    executor.execute {
      try {
        val input =
                context.contentResolver.openInputStream(Uri.parse(uri))
                        ?: throw IllegalStateException("Unable to open file")
        val bytes = input.use { readBytesWithLimit(it) }
        val encoded = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        val result = JSObject()
        result.put("data", encoded)
        call.resolve(result)
      } catch (error: Exception) {
        AppLogger.error(
                pluginContextOrNull(),
                logTag,
                "SAF readFile failed",
                "FolderPickerPlugin",
                error,
                traceFields(call)
        )
        call.reject(error.message, error)
      }
    }
  }

  @PluginMethod
  fun readFileFromTree(call: PluginCall) {
    val treeUriString = call.getString("treeUri")
    if (treeUriString.isNullOrBlank()) {
      call.reject("treeUri is required")
      return
    }
    val relativePath = call.getString("path")
    if (relativePath.isNullOrBlank()) {
      call.reject("path is required")
      return
    }
    val treeUri = Uri.parse(treeUriString)

    executor.execute {
      try {
        val documentId = resolveDocumentId(treeUri, relativePath, false)
        val documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
        val input =
                context.contentResolver.openInputStream(documentUri)
                        ?: throw IllegalStateException("Unable to open file")
        val bytes = input.use { readBytesWithLimit(it) }
        val encoded = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        val result = JSObject()
        result.put("data", encoded)
        call.resolve(result)
      } catch (error: Exception) {
        AppLogger.error(
                pluginContextOrNull(),
                logTag,
                "SAF readFileFromTree failed",
                "FolderPickerPlugin",
                error,
                traceFields(call)
        )
        call.reject(error.message, error)
      }
    }
  }

  @PluginMethod
  fun writeFileToTree(call: PluginCall) {
    val treeUriString = call.getString("treeUri")
    if (treeUriString.isNullOrBlank()) {
      call.reject("treeUri is required")
      return
    }
    val relativePath = call.getString("path")
    if (relativePath.isNullOrBlank()) {
      call.reject("path is required")
      return
    }
    val dataBase64 = call.getString("data")
    if (dataBase64.isNullOrBlank()) {
      call.reject("data is required")
      return
    }
    val mimeType = call.getString("mimeType") ?: "application/octet-stream"
    val overwrite = call.getBoolean("overwrite", true) ?: true
    val treeUri = Uri.parse(treeUriString)

    executor.execute {
      try {
        val (parentDocumentId, fileName) = resolveParentDocumentId(treeUri, relativePath)
        val existing = findChildDocument(treeUri, parentDocumentId, fileName)
        if (existing != null) {
          if (existing.mimeType == DocumentsContract.Document.MIME_TYPE_DIR) {
            throw IllegalStateException("Path points to a directory: $fileName")
          }
          if (!overwrite) {
            throw IllegalStateException("File already exists: $fileName")
          }
        }

        val bytes = android.util.Base64.decode(dataBase64, android.util.Base64.NO_WRAP)

        // HARD19-015: overwrite IN PLACE with write-truncate ("wt") rather than
        // delete-then-create. The previous implementation deleted the existing
        // document before the replacement existed, so any failure after the delete
        // (createDocument returning null, openOutputStream failing, the write
        // throwing, or process death) destroyed the user's original file outright —
        // the most severe data-loss shape in the app. Writing "wt" to the existing
        // document's URI keeps the original present on any pre-write failure and,
        // at worst, leaves a truncated-but-present file. Disk images are fixed-size,
        // so the new content is the same length and truncation is a non-issue.
        val targetUri =
                if (existing != null) {
                  DocumentsContract.buildDocumentUriUsingTree(treeUri, existing.documentId)
                } else {
                  val parentUri =
                          DocumentsContract.buildDocumentUriUsingTree(treeUri, parentDocumentId)
                  DocumentsContract.createDocument(
                          context.contentResolver,
                          parentUri,
                          mimeType,
                          fileName
                  )
                          ?: throw IllegalStateException("Unable to create file: $fileName")
                }

        context.contentResolver.openOutputStream(targetUri, "wt")?.use { output ->
          output.write(bytes)
          output.flush()
        }
                ?: throw IllegalStateException("Unable to open output stream")

        val response = JSObject()
        response.put("uri", targetUri.toString())
        response.put("sizeBytes", bytes.size)
        response.put("modifiedAt", isoTimestampNow())
        call.resolve(response)
      } catch (error: Exception) {
        AppLogger.error(
                pluginContextOrNull(),
                logTag,
                "SAF writeFileToTree failed",
                "FolderPickerPlugin",
                error,
                traceFields(call)
        )
        call.reject(error.message, error)
      }
    }
  }

  private fun normalizePath(path: String?): String {
    if (path.isNullOrBlank() || path == "/") return ""
    return path.trim().trim('/').replace(Regex("/+"), "/")
  }

  private fun buildChildPath(base: String, name: String): String {
    return if (base.isBlank()) {
      "/$name"
    } else {
      "/$base/$name"
    }
  }

  private fun resolveDocumentId(
          treeUri: Uri,
          relativePath: String?,
          requireDirectory: Boolean
  ): String {
    var documentId = DocumentsContract.getTreeDocumentId(treeUri)
    val normalized = normalizePath(relativePath)
    if (normalized.isBlank()) return documentId
    val segments = normalized.split('/').filter { it.isNotBlank() }
    for ((index, segment) in segments.withIndex()) {
      val isLeaf = index == segments.size - 1
      val childId =
              findChildDocumentId(treeUri, documentId, segment, requireDirectory || !isLeaf)
                      ?: throw IllegalStateException("Path segment not found: $segment")
      documentId = childId
    }
    return documentId
  }

  private fun resolveParentDocumentId(treeUri: Uri, relativePath: String): Pair<String, String> {
    val normalized = normalizePath(relativePath)
    if (normalized.isBlank()) {
      throw IllegalStateException("path must include a file name")
    }
    val segments = normalized.split('/').filter { it.isNotBlank() }
    if (segments.isEmpty()) {
      throw IllegalStateException("path must include a file name")
    }

    var parentDocumentId = DocumentsContract.getTreeDocumentId(treeUri)
    if (segments.size > 1) {
      segments.dropLast(1).forEach { segment ->
        val existing = findChildDocument(treeUri, parentDocumentId, segment)
        if (existing != null) {
          if (existing.mimeType != DocumentsContract.Document.MIME_TYPE_DIR) {
            throw IllegalStateException("Path segment is not a directory: $segment")
          }
          parentDocumentId = existing.documentId
          return@forEach
        }

        val parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, parentDocumentId)
        val createdUri =
                DocumentsContract.createDocument(
                        context.contentResolver,
                        parentUri,
                        DocumentsContract.Document.MIME_TYPE_DIR,
                        segment
                )
                        ?: throw IllegalStateException("Unable to create directory: $segment")
        parentDocumentId = DocumentsContract.getDocumentId(createdUri)
      }
    }

    return Pair(parentDocumentId, segments.last())
  }

  private data class ChildDocument(
          val documentId: String,
          val mimeType: String,
  )

  private fun findChildDocument(treeUri: Uri, parentId: String, name: String): ChildDocument? {
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId)
    val projection =
            arrayOf(
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE
            )
    context.contentResolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
      val idIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
      val nameIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
      val mimeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
      while (cursor.moveToNext()) {
        val displayName = cursor.getString(nameIndex) ?: continue
        if (displayName != name) continue
        val documentId = cursor.getString(idIndex) ?: continue
        val mimeType = cursor.getString(mimeIndex) ?: ""
        return ChildDocument(documentId, mimeType)
      }
    }
    return null
  }

  private fun findChildDocumentId(
          treeUri: Uri,
          parentId: String,
          name: String,
          requireDirectory: Boolean
  ): String? {
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId)
    val projection =
            arrayOf(
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE
            )
    context.contentResolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
      val idIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
      val nameIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
      val mimeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
      while (cursor.moveToNext()) {
        val displayName = cursor.getString(nameIndex) ?: continue
        if (displayName != name) continue
        val mimeType = cursor.getString(mimeIndex) ?: ""
        if (requireDirectory && mimeType != DocumentsContract.Document.MIME_TYPE_DIR) return null
        return cursor.getString(idIndex)
      }
    }
    return null
  }

  private fun isoTimestampNow(): String {
    val formatter = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
    formatter.timeZone = java.util.TimeZone.getTimeZone("UTC")
    return formatter.format(java.util.Date())
  }
}
