/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Intent
import android.util.Log
import android.content.Context

object AppLogger {
  const val ACTION_DIAGNOSTICS_LOG = "uk.gleissner.c64commander.action.DIAGNOSTICS_LOG"
  const val EXTRA_LEVEL = "level"
  const val EXTRA_MESSAGE = "message"
  const val EXTRA_COMPONENT = "component"
  const val EXTRA_CORRELATION_ID = "correlationId"
  const val EXTRA_TRACK_INSTANCE_ID = "trackInstanceId"
  const val EXTRA_PLAYLIST_ITEM_ID = "playlistItemId"
  const val EXTRA_SOURCE_KIND = "sourceKind"
  const val EXTRA_LOCAL_ACCESS_MODE = "localAccessMode"
  const val EXTRA_LIFECYCLE_STATE = "lifecycleState"
  const val EXTRA_ERROR_NAME = "errorName"
  const val EXTRA_ERROR_MESSAGE = "errorMessage"
  const val EXTRA_ERROR_STACK = "errorStack"

  data class TraceFields(
    val correlationId: String? = null,
    val trackInstanceId: String? = null,
    val playlistItemId: String? = null,
    val sourceKind: String? = null,
    val localAccessMode: String? = null,
    val lifecycleState: String? = null,
  )

  private fun logcat(level: String, tag: String, message: String, throwable: Throwable?) {
    when (level) {
      "debug" -> if (throwable != null) Log.d(tag, message, throwable) else Log.d(tag, message)
      "info" -> if (throwable != null) Log.i(tag, message, throwable) else Log.i(tag, message)
      "warn" -> if (throwable != null) Log.w(tag, message, throwable) else Log.w(tag, message)
      else -> if (throwable != null) Log.e(tag, message, throwable) else Log.e(tag, message)
    }
  }

  private fun emit(
    context: Context?,
    level: String,
    message: String,
    component: String,
    throwable: Throwable?,
    trace: TraceFields,
  ) {
    if (context == null) return
    val intent = Intent(ACTION_DIAGNOSTICS_LOG)
    intent.putExtra(EXTRA_LEVEL, level)
    intent.putExtra(EXTRA_MESSAGE, message)
    intent.putExtra(EXTRA_COMPONENT, component)
    intent.putExtra(EXTRA_CORRELATION_ID, trace.correlationId)
    intent.putExtra(EXTRA_TRACK_INSTANCE_ID, trace.trackInstanceId)
    intent.putExtra(EXTRA_PLAYLIST_ITEM_ID, trace.playlistItemId)
    intent.putExtra(EXTRA_SOURCE_KIND, trace.sourceKind)
    intent.putExtra(EXTRA_LOCAL_ACCESS_MODE, trace.localAccessMode)
    intent.putExtra(EXTRA_LIFECYCLE_STATE, trace.lifecycleState)
    if (throwable != null) {
      intent.putExtra(EXTRA_ERROR_NAME, throwable::class.java.simpleName)
      intent.putExtra(EXTRA_ERROR_MESSAGE, throwable.message)
      intent.putExtra(EXTRA_ERROR_STACK, Log.getStackTraceString(throwable))
    }
    context.sendBroadcast(intent)
  }

  fun debug(context: Context?, tag: String, message: String, component: String, trace: TraceFields = TraceFields()) {
    logcat("debug", tag, message, null)
    emit(context, "debug", message, component, null, trace)
  }

  fun info(context: Context?, tag: String, message: String, component: String, trace: TraceFields = TraceFields()) {
    logcat("info", tag, message, null)
    emit(context, "info", message, component, null, trace)
  }

  fun warn(
    context: Context?,
    tag: String,
    message: String,
    component: String,
    throwable: Throwable? = null,
    trace: TraceFields = TraceFields(),
  ) {
    logcat("warn", tag, message, throwable)
    emit(context, "warn", message, component, throwable, trace)
  }

  fun error(
    context: Context?,
    tag: String,
    message: String,
    component: String,
    throwable: Throwable? = null,
    trace: TraceFields = TraceFields(),
  ) {
    logcat("error", tag, message, throwable)
    emit(context, "error", message, component, throwable, trace)
  }
}
