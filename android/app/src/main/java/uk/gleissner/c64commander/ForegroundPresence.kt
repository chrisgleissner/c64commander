/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.os.SystemClock

/**
 * Whether the app was in front a moment ago. A command app that the system starts on top of this one pauses it first,
 * so "in front" has to include the last [RECENT_MS].
 */
internal object ForegroundPresence {
  internal const val RECENT_MS = 2_000L

  @Volatile private var resumed = false
  @Volatile private var pausedAtMs: Long? = null

  fun onResumed() {
    resumed = true
  }

  fun onPaused(nowMs: Long = SystemClock.elapsedRealtime()) {
    resumed = false
    pausedAtMs = nowMs
  }

  fun wasInFront(nowMs: Long = SystemClock.elapsedRealtime()): Boolean {
    val pausedAt = pausedAtMs
    return resumed || (pausedAt != null && nowMs - pausedAt <= RECENT_MS)
  }

  /**
   * [wasInFront] for a companion command. One answered "in front" puts the companion on top of this app until it hands
   * back, so it restarts the window: the next press of a quick burst is then still answered "in front".
   */
  fun answerCompanionCommand(nowMs: Long = SystemClock.elapsedRealtime()): Boolean {
    val inFront = wasInFront(nowMs)
    if (inFront && !resumed) pausedAtMs = nowMs
    return inFront
  }

  internal fun reset() {
    resumed = false
    pausedAtMs = null
  }
}
