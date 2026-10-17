/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.os.Handler

/**
 * Calls [onStale] once [liveness] reports silence. A heartbeat moves the deadline, so an early
 * callback re-arms itself for the remainder instead of firing.
 */
class LivenessWatchdog(
        private val handler: Handler,
        private val liveness: PlaybackLiveness,
        private val clock: () -> Long,
        private val onStale: () -> Unit,
) {
    private var pending: Runnable? = null

    fun arm() {
        cancel()
        val runnable =
                object : Runnable {
                    override fun run() {
                        pending = null
                        val now = clock()
                        if (liveness.isStale(now)) {
                            onStale()
                        } else {
                            pending = this
                            handler.postDelayed(this, liveness.msUntilStale(now))
                        }
                    }
                }
        pending = runnable
        handler.postDelayed(runnable, liveness.msUntilStale(clock()))
    }

    fun cancel() {
        pending?.let { handler.removeCallbacks(it) }
        pending = null
    }
}
