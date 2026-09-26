/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.util.Log
import java.net.InetAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Accepts each stream's packets only from the machine it was told to listen to.
 *
 * Every Ultimate streams into the same multicast groups, so a second machine's packets would be
 * assembled into our frames. Filtering happens before any sequence or frame accounting. An unset
 * filter accepts everything, which is also the state while a host name is being resolved.
 */
class StreamSenderFilter(
  private val resolve: (String) -> InetAddress = InetAddress::getByName,
  private val runInBackground: (Runnable) -> Unit,
  private val logEvery: Long,
) {
  private val logTag = "StreamSenderFilter"
  private val expected = ConcurrentHashMap<String, InetAddress>()
  private val rejected = ConcurrentHashMap<String, AtomicLong>()

  /** The machine whose packets were dropped most recently: what turns a silent socket into a diagnosis. */
  private val lastRejected = ConcurrentHashMap<String, InetAddress>()

  /** Bumped on every retarget, so a slow lookup for an older target cannot overwrite a newer one. */
  private val generations = ConcurrentHashMap<String, Long>()

  fun expectedSource(name: String): InetAddress? = expected[name]

  fun rejectedPackets(name: String): Long = rejected[name]?.get() ?: 0L

  fun lastRejectedSource(name: String): InetAddress? = lastRejected[name]

  fun clearDiagnostics(name: String) {
    rejected.remove(name)
    lastRejected.remove(name)
  }

  fun retarget(name: String, host: String?) {
    clearDiagnostics(name)
    val trimmed = host?.trim()?.substringBefore(':')?.takeIf { it.isNotEmpty() }
    val generation = synchronized(generations) {
      val next = (generations[name] ?: 0L) + 1
      generations[name] = next
      if (trimmed == null) expected.remove(name)
      next
    }
    if (trimmed == null) return
    runInBackground(
      Runnable {
        val resolved =
          try {
            resolve(trimmed)
          } catch (error: Exception) {
            Log.w(logTag, "stream $name: could not resolve expected sender $trimmed; accepting all", error)
            null
          }
        synchronized(generations) {
          if (generations[name] != generation) {
            Log.i(logTag, "stream $name: ignoring the lookup of $trimmed; the filter was retargeted since")
            return@Runnable
          }
          if (resolved == null) expected.remove(name) else expected[name] = resolved
        }
        if (resolved != null) {
          Log.i(logTag, "stream $name: accepting packets only from $trimmed (${resolved.hostAddress})")
        }
      },
    )
  }

  /** Called per packet on both receive paths, so the common case costs a reference compare. */
  fun isForeign(name: String, source: InetAddress?): Boolean {
    val accepted = expected[name] ?: return false
    if (source === accepted || source == accepted) return false
    if (source != null && lastRejected[name] !== source) lastRejected[name] = source
    val n = rejected.getOrPut(name) { AtomicLong() }.incrementAndGet()
    if (n == 1L || n % logEvery == 0L) {
      Log.w(logTag, "stream $name: dropped $n packet(s) from ${source?.hostAddress} (expected ${accepted.hostAddress})")
    }
    return true
  }
}
