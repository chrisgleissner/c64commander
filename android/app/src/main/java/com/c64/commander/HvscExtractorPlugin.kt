package com.c64.commander

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.util.concurrent.Executors

@CapacitorPlugin(name = "HvscExtractor")
class HvscExtractorPlugin : Plugin() {
  private val executor = Executors.newSingleThreadExecutor()
  private val extractor = SevenZExtractor()

  @PluginMethod
  fun extract(call: PluginCall) {
    val archivePath = call.getString("archivePath")
    val targetPath = call.getString("targetPath")
    val password = call.getString("password")

    if (archivePath.isNullOrBlank() || targetPath.isNullOrBlank()) {
      call.reject("archivePath and targetPath are required")
      return
    }

    call.setKeepAlive(true)

    executor.execute {
      try {
        val archiveFile = resolveAppPath(archivePath)
        val targetDir = resolveAppPath(targetPath)
        if (!targetDir.exists()) {
          targetDir.mkdirs()
        }
        extractor.extract(archiveFile, targetDir, password) { processed, total ->
          if (total > 0) {
            val percent = ((processed * 100) / total).toInt()
            val payload = JSObject()
            payload.put("percent", percent)
            payload.put("processed", processed)
            payload.put("total", total)
            notifyListeners("extractProgress", payload)
          }
        }

        call.resolve()
      } catch (error: Exception) {
        call.reject(error.message, error)
      }
    }
  }

  private fun resolveAppPath(path: String): File {
    val baseDir = context.filesDir.canonicalFile
    val candidate = if (path.startsWith("/")) File(path) else File(baseDir, path)
    val resolved = candidate.canonicalFile
    if (!resolved.path.startsWith(baseDir.path)) {
      throw SecurityException("Path outside app storage")
    }
    return resolved
  }

}
