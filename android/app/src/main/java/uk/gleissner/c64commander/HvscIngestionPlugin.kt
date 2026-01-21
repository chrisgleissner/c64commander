package uk.gleissner.c64commander

import android.util.Base64
import uk.gleissner.c64commander.hvsc.AndroidHvscDatabase
import uk.gleissner.c64commander.hvsc.HvscCancelRegistry
import uk.gleissner.c64commander.hvsc.HvscIngestionService
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.util.concurrent.Executors

@CapacitorPlugin(name = "HvscIngestion")
class HvscIngestionPlugin : Plugin() {
  private val executor = Executors.newSingleThreadExecutor()
  private val cancelRegistry = HvscCancelRegistry()

  @PluginMethod
  fun getHvscStatus(call: PluginCall) {
    val db = AndroidHvscDatabase(context)
    val service = HvscIngestionService(db)
    val meta = service.getStatus()
    db.close()
    call.resolve(metaToJs(meta))
  }

  @PluginMethod
  fun getHvscCacheStatus(call: PluginCall) {
    val db = AndroidHvscDatabase(context)
    val service = HvscIngestionService(db)
    val cache = service.getCacheStatus(File(context.filesDir, "hvsc"))
    db.close()
    val payload = JSObject()
    payload.put("baselineVersion", cache.baselineVersion)
    payload.put("updateVersions", JSArray(cache.updateVersions))
    call.resolve(payload)
  }

  @PluginMethod
  fun checkForHvscUpdates(call: PluginCall) {
    val db = AndroidHvscDatabase(context)
    val service = HvscIngestionService(db)
    try {
      val status = service.checkForUpdates()
      db.close()
      call.resolve(updateToJs(status))
    } catch (error: Exception) {
      db.close()
      call.reject(error.message, error)
    }
  }

  @PluginMethod
  fun installOrUpdateHvsc(call: PluginCall) {
    val token = call.getString("cancelToken") ?: "default"
    val cancelToken = cancelRegistry.register(token)

    call.setKeepAlive(true)

    executor.execute {
      val db = AndroidHvscDatabase(context)
      val service = HvscIngestionService(db)
      try {
        val workDir = File(context.filesDir, "hvsc")
        val meta = service.installOrUpdate(workDir, cancelToken) { progress ->
          notifyListeners("progress", progressToJs(progress))
        }
        db.close()
        cancelRegistry.remove(token)
        call.resolve(metaToJs(meta))
      } catch (error: Exception) {
        db.close()
        cancelRegistry.remove(token)
        call.reject(error.message, error)
      }
    }
  }

  @PluginMethod
  fun ingestCachedHvsc(call: PluginCall) {
    val token = call.getString("cancelToken") ?: "default"
    val cancelToken = cancelRegistry.register(token)

    call.setKeepAlive(true)

    executor.execute {
      val db = AndroidHvscDatabase(context)
      val service = HvscIngestionService(db)
      try {
        val workDir = File(context.filesDir, "hvsc")
        val meta = service.ingestCached(workDir, cancelToken) { progress ->
          notifyListeners("progress", progressToJs(progress))
        }
        db.close()
        cancelRegistry.remove(token)
        call.resolve(metaToJs(meta))
      } catch (error: Exception) {
        db.close()
        cancelRegistry.remove(token)
        call.reject(error.message, error)
      }
    }
  }

  @PluginMethod
  fun cancelHvscInstall(call: PluginCall) {
    val token = call.getString("cancelToken") ?: "default"
    cancelRegistry.cancel(token)
    call.resolve()
  }

  @PluginMethod
  fun getHvscFolderListing(call: PluginCall) {
    val path = call.getString("path") ?: "/"
    val db = AndroidHvscDatabase(context)
    val service = HvscIngestionService(db)
    val folders = service.listFolders(path)
    val songs = service.listSongs(path)
    val payload = JSObject()
    payload.put("path", path)
    payload.put("folders", JSArray(folders))
    val songsArray = JSArray()
    for (song in songs) {
      val songJson = JSObject()
      songJson.put("id", song.id)
      songJson.put("virtualPath", song.virtualPath)
      songJson.put("fileName", song.fileName)
      songJson.put("durationSeconds", song.durationSeconds)
      songsArray.put(songJson)
    }
    payload.put("songs", songsArray)
    db.close()
    call.resolve(payload)
  }

  @PluginMethod
  fun getHvscSong(call: PluginCall) {
    val id = call.getLong("id")
    val virtualPath = call.getString("virtualPath")
    val db = AndroidHvscDatabase(context)
    val service = HvscIngestionService(db)
    val song = when {
      id != null -> service.getSongById(id)
      !virtualPath.isNullOrBlank() -> service.getSongByVirtualPath(virtualPath)
      else -> null
    }
    if (song == null) {
      db.close()
      call.reject("Song not found")
      return
    }
    val payload = JSObject()
    payload.put("id", song.id)
    payload.put("virtualPath", song.virtualPath)
    payload.put("fileName", song.fileName)
    payload.put("durationSeconds", song.durationSeconds)
    payload.put("md5", song.md5)
    payload.put("dataBase64", Base64.encodeToString(song.data, Base64.NO_WRAP))
    db.close()
    call.resolve(payload)
  }

  @PluginMethod
  fun getHvscDurationByMd5(call: PluginCall) {
    val md5 = call.getString("md5")
    if (md5.isNullOrBlank()) {
      call.reject("md5 is required")
      return
    }
    val db = AndroidHvscDatabase(context)
    val service = HvscIngestionService(db)
    val duration = service.getDurationByMd5(md5)
    db.close()
    val payload = JSObject()
    payload.put("durationSeconds", duration)
    call.resolve(payload)
  }

  private fun metaToJs(meta: uk.gleissner.c64commander.hvsc.HvscMeta): JSObject {
    val payload = JSObject()
    payload.put("installedBaselineVersion", meta.installedBaselineVersion)
    payload.put("installedVersion", meta.installedVersion)
    payload.put("ingestionState", meta.ingestionState)
    payload.put("lastUpdateCheckUtcMs", meta.lastUpdateCheckUtcMs)
    payload.put("ingestionError", meta.ingestionError)
    return payload
  }

  private fun updateToJs(status: uk.gleissner.c64commander.hvsc.HvscUpdateStatus): JSObject {
    val payload = JSObject()
    payload.put("latestVersion", status.latestVersion)
    payload.put("installedVersion", status.installedVersion)
    payload.put("baselineVersion", status.baselineVersion)
    payload.put("requiredUpdates", JSArray(status.requiredUpdates))
    return payload
  }

  private fun progressToJs(progress: uk.gleissner.c64commander.hvsc.HvscIngestionService.Progress): JSObject {
    val payload = JSObject()
    payload.put("ingestionId", progress.ingestionId)
    payload.put("stage", progress.stage)
    payload.put("message", progress.message)
    progress.archiveName?.let { payload.put("archiveName", it) }
    progress.currentFile?.let { payload.put("currentFile", it) }
    progress.processedCount?.let { payload.put("processedCount", it) }
    progress.totalCount?.let { payload.put("totalCount", it) }
    progress.percent?.let { payload.put("percent", it) }
    progress.downloadedBytes?.let { payload.put("downloadedBytes", it) }
    progress.totalBytes?.let { payload.put("totalBytes", it) }
    progress.songsUpserted?.let { payload.put("songsUpserted", it) }
    progress.songsDeleted?.let { payload.put("songsDeleted", it) }
    progress.elapsedTimeMs?.let { payload.put("elapsedTimeMs", it) }
    progress.errorType?.let { payload.put("errorType", it) }
    progress.errorCause?.let { payload.put("errorCause", it) }
    return payload
  }
}
