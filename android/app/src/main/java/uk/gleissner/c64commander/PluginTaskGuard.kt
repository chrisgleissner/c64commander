/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import com.getcapacitor.PluginCall

/**
 * Wraps a plugin worker task so an [Error] (for example OutOfMemoryError) that the task's own
 * `catch (Exception)` blocks do not handle still settles the call. Without it the error ends the
 * pool thread and the JS promise never settles.
 */
internal fun guardedPluginTask(
  context: Context?,
  tag: String,
  component: String,
  call: PluginCall,
  task: Runnable,
): Runnable = Runnable {
  try {
    task.run()
  } catch (error: Throwable) {
    val operation = call.methodName ?: component
    val failure = "$operation failed: ${error.javaClass.simpleName}: ${error.message}"
    AppLogger.error(context, tag, failure, component, error)
    call.reject(failure)
  }
}
