/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.plugin.util.CapacitorHttpUrlConnection
import com.getcapacitor.plugin.util.HttpRequestHandler
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@CapacitorPlugin(name = "C64Http")
class C64HttpPlugin : Plugin() {
  private val activeRequests = ConcurrentHashMap<Runnable, PluginCall>()
  private val executor: ExecutorService = Executors.newCachedThreadPool()

  @PluginMethod
  fun request(call: PluginCall) {
    val requestId = call.getString("requestId").orEmpty()
    val trace = AppLogger.TraceFields(correlationId = call.getString("correlationId"))
    val method = call.getString("method")?.uppercase() ?: "GET"
    val target = redactedTarget(call.getString("url"))
    val startedAt = System.nanoTime()
    lateinit var task: Runnable
    task = Runnable {
      try {
        AppLogger.debug(context, "C64HttpPlugin", "C64_HTTP_NATIVE start requestId=$requestId method=$method target=$target", "C64HttpPlugin", trace)
        val response = HttpRequestHandler.request(call, null, bridge)
        val durationMs = elapsedMs(startedAt)
        AppLogger.debug(
                context,
                "C64HttpPlugin",
                "C64_HTTP_NATIVE end requestId=$requestId method=$method target=$target status=${response.getInt("status")} durationMs=$durationMs",
                "C64HttpPlugin",
                trace,
        )
        call.resolve(response)
      } catch (error: Exception) {
        AppLogger.warn(
                context,
                "C64HttpPlugin",
                "C64_HTTP_NATIVE error requestId=$requestId method=$method target=$target errorType=${error::class.java.simpleName} durationMs=${elapsedMs(startedAt)}",
                "C64HttpPlugin",
                error,
                trace,
        )
        call.reject(error.localizedMessage, error::class.java.simpleName, error)
      } finally {
        activeRequests.remove(task)
      }
    }
    if (executor.isShutdown) {
      call.reject("C64 HTTP plugin is shut down")
      return
    }
    activeRequests[task] = call
    executor.submit(task)
  }

  override fun handleOnDestroy() {
    for ((_, call) in activeRequests) {
      disconnect(call)
      bridge.releaseCall(call)
    }
    activeRequests.clear()
    executor.shutdownNow()
    super.handleOnDestroy()
  }

  private fun disconnect(call: PluginCall) {
    val activeConnection = call.data.opt("activeCapacitorHttpUrlConnection")
    if (activeConnection !is CapacitorHttpUrlConnection) return
    try {
      activeConnection.disconnect()
    } catch (error: Exception) {
      AppLogger.warn(context, "C64HttpPlugin", "Failed to disconnect active C64 HTTP request", "C64HttpPlugin", error)
    } finally {
      call.data.remove("activeCapacitorHttpUrlConnection")
    }
  }

  private fun elapsedMs(startedAt: Long): Long = (System.nanoTime() - startedAt) / 1_000_000

  private fun redactedTarget(rawUrl: String?): String {
    return try {
      val url = URL(rawUrl)
      val port = if (url.port == -1) "" else ":${url.port}"
      "${url.protocol}://${url.host}$port${url.path.ifBlank { "/" }}"
    } catch (error: Exception) {
      AppLogger.warn(context, "C64HttpPlugin", "Unable to redact C64 HTTP target", "C64HttpPlugin", error)
      "invalid-url"
    }
  }
}
