/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

/**
 * How evenly the audio stream is actually arriving at this device.
 *
 * For a real-time stream, throughput says nothing useful — the Ultimate sends a fixed 250 packets a
 * second and either they arrive or the speaker has nothing to play. What decides whether the
 * listener hears music or crackling is *evenness*: a jitter buffer sized for a 4 ms cadence has
 * nothing to give when 60 ms of packets arrive at once and then nothing arrives for 60 ms.
 *
 * The same measurement taken on a wired host and on the phone separates the two candidate culprits.
 * A wired capture of this stream showed a mean gap of 4.00 ms, p99 4.14 ms and zero loss, so
 * whatever unevenness this monitor reports is introduced between the Ultimate's ethernet port and
 * the app's socket — the Wi-Fi hop, or this process being descheduled.
 *
 * Recorded on the receive thread, so it allocates nothing and keeps no history: running aggregates
 * only. Reads are lock-free (plain volatile fields); a torn read across two counters costs a slightly
 * wrong mean in one diagnostic sample and nothing else.
 */
internal class StreamArrivalMonitor {
  @Volatile private var packets: Long = 0
  @Volatile private var sumGapNanos: Long = 0
  @Volatile private var maxGapNanos: Long = 0
  @Volatile private var gapsOver20ms: Long = 0
  @Volatile private var gapsOver50ms: Long = 0

  /** Longest run of packets arriving closer together than [CLUMP_NANOS] — one burst, to the sink. */
  @Volatile private var maxClump: Int = 0

  /** Gaps in the 16-bit wire sequence: packets that never arrived at all. */
  @Volatile var lostPackets: Long = 0
    private set

  private var lastArrivalNanos: Long = 0
  private var lastSeq: Int = -1
  private var clump: Int = 0

  /**
   * @param arrivalNanos monotonic timestamp taken the instant the datagram left the socket
   * @param seq the packet's 16-bit wire sequence number, or -1 when the stream has none
   */
  fun record(arrivalNanos: Long, seq: Int) {
    if (packets > 0) {
      val gap = arrivalNanos - lastArrivalNanos
      sumGapNanos += gap
      if (gap > maxGapNanos) maxGapNanos = gap
      if (gap > MS_20_NANOS) gapsOver20ms++
      if (gap > MS_50_NANOS) gapsOver50ms++
      clump = if (gap < CLUMP_NANOS) clump + 1 else 1
      if (seq >= 0 && lastSeq >= 0) {
        val step = (seq - lastSeq) and 0xFFFF
        // A step of 0 or a backwards jump is a reorder, not a loss, and `lastSeq` must not follow it
        // — otherwise the next in-order packet reads as a fresh gap and one late arrival is counted
        // as loss twice over. Only plausible forward gaps count, so a stray or spoofed sequence
        // cannot invent thousands of losses.
        if (step in 2..MAX_PLAUSIBLE_GAP) lostPackets += (step - 1).toLong()
        if (step in 1..MAX_PLAUSIBLE_GAP) lastSeq = seq
      } else if (seq >= 0) {
        lastSeq = seq
      }
    } else {
      clump = 1
      if (seq >= 0) lastSeq = seq
    }
    if (clump > maxClump) maxClump = clump
    lastArrivalNanos = arrivalNanos
    packets++
  }

  /** Snapshot for the diagnostics read. */
  fun snapshot(): Snapshot =
      Snapshot(
          packets = packets,
          meanGapMs = if (packets > 1) sumGapNanos / (packets - 1) / 1_000_000.0 else 0.0,
          maxGapMs = maxGapNanos / 1_000_000.0,
          gapsOver20ms = gapsOver20ms,
          gapsOver50ms = gapsOver50ms,
          maxClump = maxClump,
          lostPackets = lostPackets,
      )

  /**
   * Start a fresh measurement window.
   *
   * The maxima are the point of this monitor and a running maximum only ever grows, so a caller that
   * wants "how bad was the last minute" has to be able to clear it. The governor's routine poll does
   * not; a deliberate measurement does.
   */
  fun reset() {
    packets = 0
    sumGapNanos = 0
    maxGapNanos = 0
    gapsOver20ms = 0
    gapsOver50ms = 0
    maxClump = 0
    lostPackets = 0
    lastSeq = -1
    clump = 0
  }

  data class Snapshot(
      val packets: Long,
      val meanGapMs: Double,
      val maxGapMs: Double,
      val gapsOver20ms: Long,
      val gapsOver50ms: Long,
      val maxClump: Int,
      val lostPackets: Long,
  ) {
    companion object {
      val ZERO = Snapshot(0, 0.0, 0.0, 0, 0, 0, 0)
    }
  }

  private companion object {
    private const val MS_20_NANOS = 20_000_000L
    private const val MS_50_NANOS = 50_000_000L

    /** Closer than this and the sink sees one burst rather than two arrivals. */
    private const val CLUMP_NANOS = 1_000_000L

    /** Beyond this a "gap" is a reordered or spoofed sequence, not real loss. */
    private const val MAX_PLAUSIBLE_GAP = 1000
  }
}
