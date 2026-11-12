/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import java.io.InputStream
import java.util.concurrent.ConcurrentHashMap

/**
 * Tracks the requestIds the JS layer has asked to cancel mid-read, and the live input streams keyed
 * by requestId. Cancelling closes the stream so a blocked read() unblocks immediately, which lets
 * the user abort even a stalled transfer and releases the firmware's FTP data channel.
 *
 * A cancel that arrives after the read already finished (routine when it races natural completion
 * on navigate-away) must not leave a permanent mark: the JS-side requestId counter resets on
 * WebView reload while the plugin instance survives, so a reused id would be rejected instantly.
 * See HARD9-073.
 */
internal class FtpReadCancellationRegistry(private val maxTrackedCompletedReads: Int = 256) {
  private val cancelledReads = ConcurrentHashMap.newKeySet<String>()
  private val activeReadStreams = ConcurrentHashMap<String, InputStream>()
  private val completedReads = ConcurrentHashMap.newKeySet<String>()

  /** Reclaims the id from the finished set so a new read for a reused id is not blocked by a stale mark. */
  fun begin(requestId: String) {
    completedReads.remove(requestId)
  }

  fun isCancelled(requestId: String): Boolean = cancelledReads.contains(requestId)

  fun attachStream(requestId: String, stream: InputStream) {
    activeReadStreams[requestId] = stream
  }

  fun detachStream(requestId: String) {
    activeReadStreams.remove(requestId)
  }

  fun finish(requestId: String) {
    activeReadStreams.remove(requestId)
    cancelledReads.remove(requestId)
    completedReads.add(requestId)
    if (completedReads.size > maxTrackedCompletedReads) completedReads.clear()
  }

  /** Returns false, recording nothing, when the read has already finished. */
  fun markCancelled(requestId: String): Boolean {
    if (completedReads.contains(requestId)) return false
    cancelledReads.add(requestId)
    return true
  }

  fun activeStream(requestId: String): InputStream? = activeReadStreams[requestId]
}
