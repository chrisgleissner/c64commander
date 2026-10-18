/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Counts every datagram a stream's socket receives, before the sender filter and the assembler see it.
 *
 * A watchdog that waits for completed frames cannot tell a stream that stopped from a stream whose
 * packets arrive but do not assemble. This counter separates the two: it moves whenever the socket
 * delivers anything, whoever sent it.
 */
class StreamPacketCounters(private val clockNanos: () -> Long) {
  private class Counter {
    val received = AtomicLong()
    @Volatile var lastNanos = 0L
  }

  private val counters = ConcurrentHashMap<String, Counter>()

  fun note(name: String) {
    val counter = counters.getOrPut(name) { Counter() }
    counter.lastNanos = clockNanos()
    counter.received.incrementAndGet()
  }

  fun receivedPackets(name: String): Long = counters[name]?.received?.get() ?: 0L

  /** Milliseconds since the last datagram, or null when none has arrived since the socket was opened. */
  fun millisSinceLastPacket(name: String): Long? {
    val counter = counters[name] ?: return null
    if (counter.received.get() == 0L) return null
    return (clockNanos() - counter.lastNanos) / 1_000_000L
  }

  fun reset(name: String) {
    counters.remove(name)
  }
}
