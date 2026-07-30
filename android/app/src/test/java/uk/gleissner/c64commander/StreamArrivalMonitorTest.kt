/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The arrival monitor exists to answer one question on real hardware: is the audio arriving evenly?
 * These pin the arithmetic so a reading can be trusted as evidence — a diagnostic that quietly
 * miscounts is worse than none, because it sends the next investigation the wrong way.
 */
class StreamArrivalMonitorTest {
  private val ms = 1_000_000L

  @Test
  fun anEvenStreamReportsItsCadenceAndNoBursts() {
    val monitor = StreamArrivalMonitor()
    var t = 0L
    repeat(100) {
      monitor.record(t, it)
      t += 4 * ms
    }
    val snap = monitor.snapshot()
    assertEquals(100, snap.packets)
    assertEquals(4.0, snap.meanGapMs, 0.001)
    assertEquals(4.0, snap.maxGapMs, 0.001)
    assertEquals(0, snap.gapsOver20ms)
    assertEquals(1, snap.maxClump)
    assertEquals(0, snap.lostPackets)
  }

  @Test
  fun aBurstAfterASilenceIsReportedAsBothAGapAndAClump() {
    // The shape that starves a jitter buffer: nothing for 60 ms, then 15 packets at once. Throughput
    // over the window is unchanged, which is exactly why throughput cannot diagnose crackling.
    val monitor = StreamArrivalMonitor()
    var t = 0L
    monitor.record(t, 0)
    t += 60 * ms
    for (i in 1..15) {
      monitor.record(t, i)
      t += 100_000L // 0.1 ms apart — one burst as far as the sink is concerned
    }
    val snap = monitor.snapshot()
    assertEquals(16, snap.packets)
    assertEquals(60.0, snap.maxGapMs, 0.001)
    assertEquals(1, snap.gapsOver20ms)
    assertEquals(1, snap.gapsOver50ms)
    assertEquals(15, snap.maxClump)
  }

  @Test
  fun aMissingSequenceNumberCountsAsLoss() {
    val monitor = StreamArrivalMonitor()
    monitor.record(0, 10)
    monitor.record(4 * ms, 13) // 11 and 12 never arrived
    assertEquals(2, monitor.snapshot().lostPackets)
  }

  @Test
  fun sequenceWrapAroundIsNotMistakenForMassiveLoss() {
    // The wire sequence is 16-bit, so it wraps every ~4 minutes at 250 packets/s. Reading the wrap as
    // a 65k-packet gap would make a perfectly healthy stream look catastrophically lossy.
    val monitor = StreamArrivalMonitor()
    monitor.record(0, 0xFFFE)
    monitor.record(4 * ms, 0xFFFF)
    monitor.record(8 * ms, 0)
    monitor.record(12 * ms, 1)
    assertEquals(0, monitor.snapshot().lostPackets)
  }

  @Test
  fun aReorderedPacketIsNotCountedAsLoss() {
    val monitor = StreamArrivalMonitor()
    monitor.record(0, 5)
    monitor.record(4 * ms, 4) // arrived late, out of order
    monitor.record(8 * ms, 6)
    assertEquals(0, monitor.snapshot().lostPackets)
  }

  @Test
  fun resetStartsAFreshWindowIncludingTheMaxima() {
    // A running maximum only ever grows, so without a reset "worst gap" would answer for the whole
    // session and never for the thing being measured now.
    val monitor = StreamArrivalMonitor()
    monitor.record(0, 0)
    monitor.record(80 * ms, 1)
    assertTrue(monitor.snapshot().maxGapMs > 50)

    monitor.reset()
    var t = 200 * ms
    repeat(10) {
      monitor.record(t, it)
      t += 4 * ms
    }
    val snap = monitor.snapshot()
    assertEquals(10, snap.packets)
    assertEquals(4.0, snap.maxGapMs, 0.001)
    assertEquals(0, snap.gapsOver50ms)
  }
}
