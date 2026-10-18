/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StreamPacketCountersTest {
  private var nowNanos = 0L
  private val counters = StreamPacketCounters { nowNanos }

  @Test
  fun aStreamThatReceivedNothingHasNoLastPacketAge() {
    assertEquals(0L, counters.receivedPackets("video"))
    assertNull(counters.millisSinceLastPacket("video"))
  }

  @Test
  fun countsEveryPacketPerStreamAndReportsTheTimeSinceTheLastOne() {
    nowNanos = 1_000_000_000L
    counters.note("video", nowNanos)
    counters.note("video", nowNanos)
    counters.note("audio", nowNanos)
    nowNanos = 1_250_000_000L

    assertEquals(2L, counters.receivedPackets("video"))
    assertEquals(1L, counters.receivedPackets("audio"))
    assertEquals(250L, counters.millisSinceLastPacket("video"))
  }

  @Test
  fun resettingAStreamForgetsItsPacketsButNotTheOtherStream() {
    counters.note("video", 0L)
    counters.note("audio", 0L)
    counters.reset("video")

    assertEquals(0L, counters.receivedPackets("video"))
    assertNull(counters.millisSinceLastPacket("video"))
    assertEquals(1L, counters.receivedPackets("audio"))
  }
}
