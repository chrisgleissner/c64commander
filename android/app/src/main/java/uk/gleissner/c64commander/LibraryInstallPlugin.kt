/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** Idempotent start/stop lifecycle control for the [LibraryInstallService] (HARD27-028). */
@CapacitorPlugin(name = "LibraryInstall")
open class LibraryInstallPlugin : Plugin() {
    private val logTag = "LibraryInstallPlugin"

    @PluginMethod
    fun start(call: PluginCall) {
        try {
            LibraryInstallService.start(context)
            call.resolve()
        } catch (e: Exception) {
            AppLogger.warn(context, logTag, "Failed to start the library install guard", logTag, e)
            call.reject(e.message ?: "Failed to start the library install guard", e)
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        try {
            LibraryInstallService.stop(context)
            call.resolve()
        } catch (e: Exception) {
            AppLogger.warn(context, logTag, "Failed to stop the library install guard", logTag, e)
            call.reject(e.message ?: "Failed to stop the library install guard", e)
        }
    }
}
