package uk.gleissner.c64commander

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import androidx.activity.result.ActivityResult
import androidx.documentfile.provider.DocumentFile
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

  @PluginMethod
  fun pickDirectory(call: PluginCall) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    intent.addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
    startActivityForResult(call, intent, "pickDirectoryResult")
  }

  @PluginMethod
  fun pickFile(call: PluginCall) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
    intent.addCategory(Intent.CATEGORY_OPENABLE)
    intent.type = "*/*"
    val mimeTypesArray = call.getArray("mimeTypes")
    val mimeTypes: Array<String>? = if (mimeTypesArray != null) {
      val list = mutableListOf<String>()
      for (index in 0 until mimeTypesArray.length()) {
        val value = mimeTypesArray.opt(index)?.toString()
        if (!value.isNullOrBlank()) {
          list.add(value)
        }
      }
      list.toTypedArray()
    } else {
      null
    }
    if (mimeTypes != null && mimeTypes.isNotEmpty()) {
      intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes)
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

    val flags = data.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    try {
      context.contentResolver.takePersistableUriPermission(treeUri, flags)
    } catch (error: SecurityException) {
      call.reject("Persistable permission rejected", error)
      return
    }

    executor.execute {
      try {
        val root = DocumentFile.fromTreeUri(context, treeUri)
          ?: throw IllegalStateException("Unable to access selected directory")
        val permissionPersisted = context.contentResolver.persistedUriPermissions.any {
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

    val flags = data.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    try {
      context.contentResolver.takePersistableUriPermission(fileUri, flags)
    } catch (error: SecurityException) {
      call.reject("Persistable permission rejected", error)
      return
    }

    executor.execute {
      try {
        val doc = DocumentFile.fromSingleUri(context, fileUri)
          ?: throw IllegalStateException("Unable to access selected file")
        val permissionPersisted = context.contentResolver.persistedUriPermissions.any {
          it.uri == fileUri && it.isReadPermission
        }
        if (!permissionPersisted) {
          throw IllegalStateException("Persistable permission not persisted")
        }
        val response = JSObject()
        response.put("uri", fileUri.toString())
        response.put("name", doc.name ?: "")
        response.put("sizeBytes", doc.length())
        val modifiedAt = if (doc.lastModified() > 0) {
          val formatter = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
          formatter.timeZone = java.util.TimeZone.getTimeZone("UTC")
          formatter.format(java.util.Date(doc.lastModified()))
        } else null
        response.put("modifiedAt", modifiedAt)
        response.put("permissionPersisted", true)
        call.resolve(response)
      } catch (error: Exception) {
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
        val projection = arrayOf(
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
        } ?: throw IllegalStateException("Unable to list directory")
        val response = JSObject()
        response.put("entries", entries)
        call.resolve(response)
      } catch (error: Exception) {
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
    response.put("uris", entries)
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
        val input = context.contentResolver.openInputStream(Uri.parse(uri))
          ?: throw IllegalStateException("Unable to open file")
        val bytes = input.use { it.readBytes() }
        val encoded = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        val result = JSObject()
        result.put("data", encoded)
        call.resolve(result)
      } catch (error: Exception) {
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
        val input = context.contentResolver.openInputStream(documentUri)
          ?: throw IllegalStateException("Unable to open file")
        val bytes = input.use { it.readBytes() }
        val encoded = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        val result = JSObject()
        result.put("data", encoded)
        call.resolve(result)
      } catch (error: Exception) {
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
          val existingUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, existing.documentId)
          val deleted = DocumentsContract.deleteDocument(context.contentResolver, existingUri)
          if (!deleted) {
            throw IllegalStateException("Unable to overwrite existing file: $fileName")
          }
        }

        val parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, parentDocumentId)
        val createdUri = DocumentsContract.createDocument(context.contentResolver, parentUri, mimeType, fileName)
          ?: throw IllegalStateException("Unable to create file: $fileName")

        val bytes = android.util.Base64.decode(dataBase64, android.util.Base64.DEFAULT)
        context.contentResolver.openOutputStream(createdUri, "w")?.use { output ->
          output.write(bytes)
          output.flush()
        } ?: throw IllegalStateException("Unable to open output stream")

        val response = JSObject()
        response.put("uri", createdUri.toString())
        response.put("sizeBytes", bytes.size)
        response.put("modifiedAt", isoTimestampNow())
        call.resolve(response)
      } catch (error: Exception) {
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

  private fun resolveDocumentId(treeUri: Uri, relativePath: String?, requireDirectory: Boolean): String {
    var documentId = DocumentsContract.getTreeDocumentId(treeUri)
    val normalized = normalizePath(relativePath)
    if (normalized.isBlank()) return documentId
    val segments = normalized.split('/').filter { it.isNotBlank() }
    for ((index, segment) in segments.withIndex()) {
      val isLeaf = index == segments.size - 1
      val childId = findChildDocumentId(treeUri, documentId, segment, requireDirectory || !isLeaf)
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
        val createdUri = DocumentsContract.createDocument(
          context.contentResolver,
          parentUri,
          DocumentsContract.Document.MIME_TYPE_DIR,
          segment
        ) ?: throw IllegalStateException("Unable to create directory: $segment")
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
    val projection = arrayOf(
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

  private fun findChildDocumentId(treeUri: Uri, parentId: String, name: String, requireDirectory: Boolean): String? {
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId)
    val projection = arrayOf(
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
