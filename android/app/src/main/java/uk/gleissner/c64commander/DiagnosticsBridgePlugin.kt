/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "DiagnosticsBridge")
class DiagnosticsBridgePlugin : Plugin() {
  private val logTag = "DiagnosticsBridgePlugin"

  private val diagnosticsReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action != AppLogger.ACTION_DIAGNOSTICS_LOG) return
      val payload = JSObject()
      payload.put("level", intent.getStringExtra(AppLogger.EXTRA_LEVEL) ?: "info")
      payload.put("message", intent.getStringExtra(AppLogger.EXTRA_MESSAGE) ?: "")

      val details = JSObject()
      details.put("component", intent.getStringExtra(AppLogger.EXTRA_COMPONENT))
      details.put("origin", "native")
      details.put("correlationId", intent.getStringExtra(AppLogger.EXTRA_CORRELATION_ID))
      details.put("trackInstanceId", intent.getStringExtra(AppLogger.EXTRA_TRACK_INSTANCE_ID))
      details.put("playlistItemId", intent.getStringExtra(AppLogger.EXTRA_PLAYLIST_ITEM_ID))
      details.put("sourceKind", intent.getStringExtra(AppLogger.EXTRA_SOURCE_KIND))
      details.put("localAccessMode", intent.getStringExtra(AppLogger.EXTRA_LOCAL_ACCESS_MODE))
      details.put("lifecycleState", intent.getStringExtra(AppLogger.EXTRA_LIFECYCLE_STATE))

      val errorName = intent.getStringExtra(AppLogger.EXTRA_ERROR_NAME)
      val errorMessage = intent.getStringExtra(AppLogger.EXTRA_ERROR_MESSAGE)
      val errorStack = intent.getStringExtra(AppLogger.EXTRA_ERROR_STACK)
      if (!errorName.isNullOrBlank() || !errorMessage.isNullOrBlank() || !errorStack.isNullOrBlank()) {
        val error = JSObject()
        error.put("name", errorName)
        error.put("message", errorMessage)
        error.put("stack", errorStack)
        details.put("error", error)
      }

      payload.put("details", details)
      notifyListeners("diagnosticsLog", payload)
    }
  }

  override fun load() {
    super.load()
    try {
      context.registerReceiver(diagnosticsReceiver, IntentFilter(AppLogger.ACTION_DIAGNOSTICS_LOG))
    } catch (error: Exception) {
      AppLogger.error(context, logTag, "Failed to register diagnostics receiver", "DiagnosticsBridgePlugin", error)
    }
  }

  override fun handleOnDestroy() {
    try {
      context.unregisterReceiver(diagnosticsReceiver)
    } catch (error: Exception) {
      AppLogger.warn(context, logTag, "Failed to unregister diagnostics receiver", "DiagnosticsBridgePlugin", error)
    }
    super.handleOnDestroy()
  }
}
