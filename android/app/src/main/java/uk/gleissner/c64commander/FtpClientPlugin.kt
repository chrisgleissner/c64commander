/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.apache.commons.net.ftp.FTP
import org.apache.commons.net.ftp.FTPClient
import org.apache.commons.net.ftp.FTPFile
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors

@CapacitorPlugin(name = "FtpClient")
class FtpClientPlugin : Plugin() {
  private val executor = Executors.newSingleThreadExecutor()
  private val logTag = "FtpClientPlugin"
  internal var ftpClientFactory: () -> FTPClient = { FTPClient() }
  internal var runTask: (Runnable) -> Unit = { runnable -> executor.execute(runnable) }

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

  @PluginMethod
  fun listDirectory(call: PluginCall) {
    val host = call.getString("host")
    if (host.isNullOrBlank()) {
      call.reject("host is required")
      return
    }
    val port = call.getInt("port") ?: 21
    val username = call.getString("username") ?: "user"
    val password = call.getString("password") ?: ""
    val path = call.getString("path") ?: "/"

    runTask(Runnable {
      val client = ftpClientFactory()
      try {
        client.connect(host, port)
        val loggedIn = client.login(username, password)
        if (!loggedIn) {
          call.reject("FTP login failed")
            return@Runnable
        }
        client.enterLocalPassiveMode()
        client.setFileType(FTP.BINARY_FILE_TYPE)

        val entries = JSArray()
        val files = resolveListing(client, path)
        files.forEach { file ->
          val name = file.name ?: return@forEach
          if (name == "." || name == "..") return@forEach
          val entry = JSObject()
          entry.put("name", name)
          entry.put("path", buildPath(path, name))
          entry.put("type", if (file.isDirectory) "dir" else "file")
          if (file.size >= 0) entry.put("size", file.size)
          val modified = file.timestamp?.time?.let { date ->
            val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
            formatter.timeZone = TimeZone.getTimeZone("UTC")
            formatter.format(date)
          }
          if (!modified.isNullOrBlank()) entry.put("modifiedAt", modified)
          entries.put(entry)
        }

        val result = JSObject()
        result.put("entries", entries)
        call.resolve(result)
      } catch (error: Exception) {
        AppLogger.error(
          pluginContextOrNull(),
          logTag,
          "FTP listDirectory failed",
          "FtpClientPlugin",
          error,
          traceFields(call),
        )
        call.reject(error.message, error)
      } finally {
        try {
          if (client.isConnected) client.disconnect()
        } catch (error: Exception) {
          AppLogger.warn(pluginContextOrNull(), logTag, "Failed to disconnect FTP client", "FtpClientPlugin", error)
        }
      }
    })
  }

  @PluginMethod
  fun readFile(call: PluginCall) {
    val host = call.getString("host")
    if (host.isNullOrBlank()) {
      call.reject("host is required")
      return
    }
    val path = call.getString("path")
    if (path.isNullOrBlank()) {
      call.reject("path is required")
      return
    }
    val port = call.getInt("port") ?: 21
    val username = call.getString("username") ?: "user"
    val password = call.getString("password") ?: ""

    runTask(Runnable {
      val client = ftpClientFactory()
      try {
        client.connect(host, port)
        val loggedIn = client.login(username, password)
        if (!loggedIn) {
          call.reject("FTP login failed")
            return@Runnable
        }
        client.enterLocalPassiveMode()
        client.setFileType(FTP.BINARY_FILE_TYPE)

        val output = java.io.ByteArrayOutputStream()
        val success = client.retrieveFile(path, output)
        if (!success) {
          call.reject("FTP file read failed")
            return@Runnable
        }
        val bytes = output.toByteArray()
        val encoded = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        val result = JSObject()
        result.put("data", encoded)
        result.put("sizeBytes", bytes.size)
        call.resolve(result)
      } catch (error: Exception) {
        AppLogger.error(
          pluginContextOrNull(),
          logTag,
          "FTP readFile failed",
          "FtpClientPlugin",
          error,
          traceFields(call),
        )
        call.reject(error.message, error)
      } finally {
        try {
          if (client.isConnected) client.disconnect()
        } catch (error: Exception) {
          AppLogger.warn(pluginContextOrNull(), logTag, "Failed to disconnect FTP client", "FtpClientPlugin", error)
        }
      }
    })
  }

  private fun resolveListing(client: FTPClient, path: String): Array<FTPFile> {
    return try {
      val mlist = client.mlistDir(path)
      if (mlist != null && mlist.isNotEmpty()) mlist else client.listFiles(path)
    } catch (error: Exception) {
      AppLogger.warn(pluginContextOrNull(), logTag, "FTP MLSD failed; falling back to LIST", "FtpClientPlugin", error)
      client.listFiles(path)
    }
  }

  private fun buildPath(base: String, name: String): String {
    val normalized = if (base.isBlank()) "/" else base
    return if (normalized.endsWith("/")) "$normalized$name" else "$normalized/$name"
  }
}
