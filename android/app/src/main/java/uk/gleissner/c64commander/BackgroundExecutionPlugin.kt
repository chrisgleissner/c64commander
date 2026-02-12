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
            AppLogger.error(context, logTag, "Failed to register auto-skip receiver", "BackgroundExecutionPlugin", e)
        }
    }

    override fun handleOnDestroy() {
        try {
            context.unregisterReceiver(autoSkipReceiver)
        } catch (e: Exception) {
            AppLogger.warn(context, logTag, "Failed to unregister auto-skip receiver", "BackgroundExecutionPlugin", e)
        }
        super.handleOnDestroy()
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

    @PluginMethod
    fun start(call: PluginCall) {
        try {
            BackgroundExecutionService.start(context)
            call.resolve()
        } catch (e: Exception) {
            AppLogger.error(pluginContextOrNull(), logTag, "Failed to start background execution", "BackgroundExecutionPlugin", e, traceFields(call))
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
            AppLogger.error(pluginContextOrNull(), logTag, "Failed to update background auto-skip due time", "BackgroundExecutionPlugin", e, traceFields(call))
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
            AppLogger.error(pluginContextOrNull(), logTag, "Failed to stop background execution", "BackgroundExecutionPlugin", e, traceFields(call))
            call.reject("Failed to stop background execution", e)
        }
    }
}
