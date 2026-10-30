/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.Manifest
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
import com.getcapacitor.annotation.Permission

/** Alias the web layer names when it checks or requests the notification permission. */
internal const val NOTIFICATIONS_PERMISSION_ALIAS = "notifications"

/**
 * Start/stop lifecycle control for the [BackgroundExecutionService]; both methods are idempotent.
 * The permission alias gives the web layer [Plugin]'s checkPermissions/requestPermissions for
 * POST_NOTIFICATIONS, which the service's notification needs from API 33.
 */
@CapacitorPlugin(
        name = "BackgroundExecution",
        permissions =
                [
                        Permission(
                                alias = NOTIFICATIONS_PERMISSION_ALIAS,
                                strings = [Manifest.permission.POST_NOTIFICATIONS],
                        )],
)
open class BackgroundExecutionPlugin : Plugin() {
    private val logTag = "BackgroundExecutionPlugin"
    private var areServiceReceiversRegistered = false

    private val autoSkipReceiver =
            object : BroadcastReceiver() {
                override fun onReceive(context: Context?, intent: Intent?) {
                    if (intent?.action != BackgroundExecutionService.ACTION_AUTO_SKIP_DUE) return
                    val dueAtMs =
                            intent.getLongExtra(BackgroundExecutionService.EXTRA_DUE_AT_MS, -1L)
                    val firedAtMs =
                            intent.getLongExtra(BackgroundExecutionService.EXTRA_FIRED_AT_MS, -1L)
                    if (dueAtMs <= 0L || firedAtMs <= 0L) return
                    val payload = JSObject()
                    payload.put("dueAtMs", dueAtMs)
                    payload.put("firedAtMs", firedAtMs)
                    // HARD20-010: preserve a due event while Play is unmounted on tab navigation.
                    notifyListeners("backgroundAutoSkipDue", payload, true)
                }
            }

    private val transportCommandReceiver =
            object : BroadcastReceiver() {
                override fun onReceive(context: Context?, intent: Intent?) {
                    if (intent?.action != BackgroundExecutionService.ACTION_TRANSPORT_COMMAND) return
                    val command =
                            intent.getStringExtra(
                                    BackgroundExecutionService.EXTRA_TRANSPORT_COMMAND
                            )
                    if (command.isNullOrEmpty()) return
                    val payload = JSObject()
                    payload.put("command", command)
                    // Retained like the auto-skip event: a media button pressed while Play is
                    // unmounted on tab navigation must not be lost.
                    notifyListeners("backgroundTransportCommand", payload, true)
                }
            }

    private val seekRequestReceiver =
            object : BroadcastReceiver() {
                override fun onReceive(context: Context?, intent: Intent?) {
                    if (intent?.action != BackgroundExecutionService.ACTION_SEEK_REQUEST) return
                    if (!intent.hasExtra(BackgroundExecutionService.EXTRA_SEEK_POSITION_MS)) return
                    val payload = JSObject()
                    payload.put(
                            "positionMs",
                            intent.getLongExtra(BackgroundExecutionService.EXTRA_SEEK_POSITION_MS, 0L),
                    )
                    // Not retained, unlike the transport commands: a seek names an absolute position
                    // in one tune, so replaying it to a listener that arrives later would jump the
                    // wrong tune.
                    notifyListeners("backgroundSeekRequest", payload)
                }
            }

    override fun load() {
        super.load()
        if (areServiceReceiversRegistered) return
        try {
            registerPluginReceiver(
                    autoSkipReceiver,
                    IntentFilter(BackgroundExecutionService.ACTION_AUTO_SKIP_DUE),
            )
            registerPluginReceiver(
                    transportCommandReceiver,
                    IntentFilter(BackgroundExecutionService.ACTION_TRANSPORT_COMMAND),
            )
            registerPluginReceiver(
                    seekRequestReceiver,
                    IntentFilter(BackgroundExecutionService.ACTION_SEEK_REQUEST),
            )
            areServiceReceiversRegistered = true
        } catch (e: Exception) {
            AppLogger.error(
                    context,
                    logTag,
                    "Failed to register background execution receivers",
                    "BackgroundExecutionPlugin",
                    e
            )
        }
    }

    internal open fun registerPluginReceiver(receiver: BroadcastReceiver, filter: IntentFilter) {
        BroadcastReceiverCompat.registerNotExported(context, receiver, filter)
    }

    private fun unregisterQuietly(receiver: BroadcastReceiver) {
        try {
            context.unregisterReceiver(receiver)
        } catch (e: Exception) {
            AppLogger.warn(
                    context,
                    logTag,
                    "Failed to unregister background execution receiver",
                    "BackgroundExecutionPlugin",
                    e
            )
        }
    }

    override fun handleOnDestroy() {
        BackgroundExecutionService.noteActivityGone()
        if (!areServiceReceiversRegistered) {
            super.handleOnDestroy()
            return
        }
        // Separately, so a failure on the first does not leak the second.
        unregisterQuietly(autoSkipReceiver)
        unregisterQuietly(transportCommandReceiver)
        unregisterQuietly(seekRequestReceiver)
        areServiceReceiversRegistered = false
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
        } catch (error: Throwable) {
            Log.e(logTag, "Plugin context unavailable", error)
            null
        }
    }

    @PluginMethod
    fun start(call: PluginCall) {
        try {
            BackgroundExecutionService.start(context)
            call.resolve()
        } catch (e: Exception) {
            AppLogger.error(
                    pluginContextOrNull(),
                    logTag,
                    "Failed to start background execution",
                    "BackgroundExecutionPlugin",
                    e,
                    traceFields(call)
            )
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
            AppLogger.error(
                    pluginContextOrNull(),
                    logTag,
                    "Failed to update background auto-skip due time",
                    "BackgroundExecutionPlugin",
                    e,
                    traceFields(call)
            )
            call.reject("Failed to update background auto-skip due time", e)
        }
    }

    @PluginMethod
    fun setPlaybackState(call: PluginCall) {
        val paused = call.getBoolean("paused") ?: false
        try {
            BackgroundExecutionService.setPlaybackState(context, paused)
            call.resolve()
        } catch (e: Exception) {
            AppLogger.error(
                    pluginContextOrNull(),
                    logTag,
                    "Failed to update background playback state",
                    "BackgroundExecutionPlugin",
                    e,
                    traceFields(call)
            )
            call.reject("Failed to update background playback state", e)
        }
    }

    /**
     * `PluginCall.getLong` returns null unless the JSON parser already made the value a Long, and a
     * tune's length in milliseconds fits in an Integer until it is about 24 days long. Reading the
     * raw number and widening it here is what keeps the duration from being silently dropped.
     */
    internal fun readDurationMs(call: PluginCall): Long? = readMillis(call, "durationMs")

    private fun readMillis(call: PluginCall, name: String): Long? = (call.data.opt(name) as? Number)?.toLong()

    @PluginMethod
    fun setNowPlaying(call: PluginCall) {
        try {
            BackgroundExecutionService.setNowPlaying(
                    context,
                    call.getString("title"),
                    call.getString("artist"),
                    readDurationMs(call),
                    call.getString("album"),
            )
            call.resolve()
        } catch (e: Exception) {
            AppLogger.error(
                    pluginContextOrNull(),
                    logTag,
                    "Failed to update background now-playing metadata",
                    "BackgroundExecutionPlugin",
                    e,
                    traceFields(call)
            )
            call.reject("Failed to update background now-playing metadata", e)
        }
    }

    @PluginMethod
    fun setPlaybackPosition(call: PluginCall) {
        val positionMs = readMillis(call, "positionMs")
        if (positionMs == null) {
            call.reject("Missing positionMs")
            return
        }
        try {
            BackgroundExecutionService.setPlaybackPosition(
                    context,
                    positionMs,
                    call.getBoolean("playing") ?: false,
                    call.getBoolean("seekable") ?: false,
            )
            call.resolve()
        } catch (e: Exception) {
            AppLogger.error(
                    pluginContextOrNull(),
                    logTag,
                    "Failed to update background playback position",
                    "BackgroundExecutionPlugin",
                    e,
                    traceFields(call)
            )
            call.reject("Failed to update background playback position", e)
        }
    }

    /** Sent while the web layer plays, so the service can tell a live session from an orphaned one. */
    @PluginMethod
    fun heartbeat(call: PluginCall) {
        BackgroundExecutionService.noteHeartbeat()
        call.resolve()
    }

    /** The resume request the activity was launched with, once: null if there was none or it was taken. */
    @PluginMethod
    fun takeLaunchCommand(call: PluginCall) {
        val result = JSObject()
        result.put("command", PendingResumeCommand.take())
        call.resolve(result)
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        try {
            BackgroundExecutionService.updateDueAt(context, null)
            BackgroundExecutionService.stop(context)
            call.resolve()
        } catch (e: Exception) {
            AppLogger.error(
                    pluginContextOrNull(),
                    logTag,
                    "Failed to stop background execution",
                    "BackgroundExecutionPlugin",
                    e,
                    traceFields(call)
            )
            call.reject("Failed to stop background execution", e)
        }
    }
}
