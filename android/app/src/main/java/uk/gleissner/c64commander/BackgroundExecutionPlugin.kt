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
import android.util.Log
import com.getcapacitor.JSObject
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

    private val autoSkipReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != BackgroundExecutionService.ACTION_AUTO_SKIP_DUE) return
            val dueAtMs = intent.getLongExtra(BackgroundExecutionService.EXTRA_DUE_AT_MS, -1L)
            val firedAtMs = intent.getLongExtra(BackgroundExecutionService.EXTRA_FIRED_AT_MS, -1L)
            if (dueAtMs <= 0L || firedAtMs <= 0L) return
            val payload = JSObject()
            payload.put("dueAtMs", dueAtMs)
            payload.put("firedAtMs", firedAtMs)
            notifyListeners("backgroundAutoSkipDue", payload)
        }
    }

    override fun load() {
        super.load()
        try {
            context.registerReceiver(autoSkipReceiver, IntentFilter(BackgroundExecutionService.ACTION_AUTO_SKIP_DUE))
        } catch (e: Exception) {
            Log.e(logTag, "Failed to register auto-skip receiver", e)
        }
    }

    override fun handleOnDestroy() {
        try {
            context.unregisterReceiver(autoSkipReceiver)
        } catch (e: Exception) {
            Log.w(logTag, "Failed to unregister auto-skip receiver", e)
        }
        super.handleOnDestroy()
    }

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
    fun setDueAtMs(call: PluginCall) {
        val dueAtMs = call.getLong("dueAtMs")
        try {
            if (dueAtMs == null || dueAtMs <= 0) {
                BackgroundExecutionService.updateDueAt(context, null)
            } else {
                BackgroundExecutionService.updateDueAt(context, dueAtMs)
            }
            call.resolve()
        } catch (e: Exception) {
            val trace = traceSummary(call)
            val suffix = if (trace.isBlank()) "" else " ($trace)"
            Log.e(logTag, "Failed to update background auto-skip due time$suffix", e)
            call.reject("Failed to update background auto-skip due time", e)
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        try {
            BackgroundExecutionService.updateDueAt(context, null)
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
