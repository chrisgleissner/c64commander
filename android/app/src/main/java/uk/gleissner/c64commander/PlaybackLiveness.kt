/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

/**
 * Decides whether the web layer that owns playback is still there to play. The foreground service
 * outlives the activity, so without this it kept announcing "playing" after Android destroyed the
 * activity and the audio stopped (issue 504).
 *
 * The web layer sends a heartbeat while it plays. Silence for [heartbeatTimeoutMs] means it is gone
 * or frozen; the activity being destroyed shortens that to [activityGoneGraceMs], which still leaves
 * time for the activity to be recreated and send its first heartbeat.
 *
 * All times are on one monotonic clock chosen by the caller.
 */
class PlaybackLiveness(
        private val heartbeatTimeoutMs: Long = HEARTBEAT_TIMEOUT_MS,
        private val activityGoneGraceMs: Long = ACTIVITY_GONE_GRACE_MS,
) {
    companion object {
        const val HEARTBEAT_TIMEOUT_MS = 15_000L
        const val ACTIVITY_GONE_GRACE_MS = 3_000L
    }

    private var lastHeartbeatMs = 0L
    private var activityGoneAtMs: Long? = null

    fun onHeartbeat(nowMs: Long) {
        lastHeartbeatMs = nowMs
        activityGoneAtMs = null
    }

    fun onActivityGone(nowMs: Long) {
        if (activityGoneAtMs == null) activityGoneAtMs = nowMs
    }

    private fun deadlineMs(): Long {
        val heartbeatDeadline = lastHeartbeatMs + heartbeatTimeoutMs
        val goneAt = activityGoneAtMs ?: return heartbeatDeadline
        return minOf(heartbeatDeadline, goneAt + activityGoneGraceMs)
    }

    fun isStale(nowMs: Long): Boolean = nowMs >= deadlineMs()

    fun msUntilStale(nowMs: Long): Long = maxOf(0L, deadlineMs() - nowMs)
}
