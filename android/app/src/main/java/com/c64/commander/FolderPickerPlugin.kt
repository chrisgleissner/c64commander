package uk.gleissner.c64commander

import android.app.Activity
import android.content.Intent
import androidx.documentfile.provider.DocumentFile
import androidx.activity.result.ActivityResult
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
    context.contentResolver.takePersistableUriPermission(treeUri, flags)

    executor.execute {
      try {
        val root = DocumentFile.fromTreeUri(context, treeUri)
          ?: throw IllegalStateException("Unable to access selected directory")
        val files = mutableListOf<JSObject>()
        val extensions = call.getArray("extensions")?.let { array ->
          val values = mutableSetOf<String>()
          for (idx in 0 until array.length()) {
            val value = array.optString(idx, "").lowercase()
            if (value.isNotBlank()) values.add(value)
          }
          values
        }
        collectFiles(root, "", files, extensions)
        val response = JSObject()
        response.put("uri", treeUri.toString())
        response.put("rootName", root.name ?: "")
        response.put("files", files)
        call.resolve(response)
      } catch (error: Exception) {
        call.reject(error.message, error)
      }
    }
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
        val input = context.contentResolver.openInputStream(android.net.Uri.parse(uri))
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

  private fun collectFiles(
    dir: DocumentFile,
    prefix: String,
    out: MutableList<JSObject>,
    allowedExtensions: Set<String>?
  ) {
    dir.listFiles().forEach { entry ->
      val name = entry.name ?: return@forEach
      if (entry.isDirectory) {
        collectFiles(entry, "$prefix$name/", out, allowedExtensions)
      } else if (entry.isFile && isSupportedLocalFile(name, allowedExtensions)) {
        val payload = JSObject()
        payload.put("uri", entry.uri.toString())
        payload.put("name", name)
        payload.put("path", "/$prefix$name")
        out.add(payload)
      }
    }
  }

  private fun isSupportedLocalFile(name: String, allowedExtensions: Set<String>?): Boolean {
    val lowered = name.lowercase()
    val ext = lowered.substringAfterLast('.', "")
    if (allowedExtensions != null && allowedExtensions.isNotEmpty()) {
      return allowedExtensions.contains(ext)
    }
    return lowered.endsWith(".sid") || lowered.endsWith(".zip") || lowered.endsWith(".7z")
  }
}
