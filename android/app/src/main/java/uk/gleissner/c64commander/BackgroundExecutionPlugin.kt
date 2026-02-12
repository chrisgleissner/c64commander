/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.util.Log
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Capacitor plugin that exposes start/stop lifecycle control for the
 * [BackgroundExecutionService]. Both methods are idempotent.
 */
@CapacitorPlugin(name = "BackgroundExecution")
class BackgroundExecutionPlugin : Plugin() {
    private val logTag = "BackgroundExecutionPlugin"

    private fun traceSummary(call: PluginCall): String {
        val trace = call.getObject("traceContext") ?: return ""
        val correlationId = trace.getString("correlationId") ?: ""
        val trackInstanceId = trace.getInteger("trackInstanceId")?.toString() ?: ""
        val playlistItemId = trace.getString("playlistItemId") ?: ""
        if (correlationId.isBlank() && trackInstanceId.isBlank() && playlistItemId.isBlank()) return ""
        return "trace(correlationId=$correlationId,trackInstanceId=$trackInstanceId,playlistItemId=$playlistItemId)"
    }

    @PluginMethod
    fun start(call: PluginCall) {
        try {
            BackgroundExecutionService.start(context)
            call.resolve()
        } catch (e: Exception) {
            val trace = traceSummary(call)
            val suffix = if (trace.isBlank()) "" else " ($trace)"
            Log.e(logTag, "Failed to start background execution$suffix", e)
            call.reject("Failed to start background execution", e)
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        try {
            BackgroundExecutionService.stop(context)
            call.resolve()
        } catch (e: Exception) {
            val trace = traceSummary(call)
            val suffix = if (trace.isBlank()) "" else " ($trace)"
            Log.e(logTag, "Failed to stop background execution$suffix", e)
            call.reject("Failed to stop background execution", e)
        }
    }
}
