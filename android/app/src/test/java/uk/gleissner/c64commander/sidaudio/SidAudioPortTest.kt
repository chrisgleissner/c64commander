/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.sidaudio

import org.junit.Assert.assertEquals
import org.junit.Test

class SidAudioPortTest {
  private val received = mutableListOf<List<Long>>()
  private val port = SidAudioPort { serial, seq, bytes, offset, frames -> received.add(listOf(serial.toLong(), seq, offset.toLong(), frames.toLong(), bytes.size.toLong())) }

  private fun message(kind: Int, serial: Int, seq: Long, frames: Int, payloadFrames: Int = frames, magic: Int = SidAudioPort.MAGIC): ByteArray {
    val out = ByteArray(SidAudioPort.HEADER_BYTES + payloadFrames * 4)
    fun put(at: Int, value: Long) {
      for (i in 0 until 4) out[at + i] = ((value shr (8 * i)) and 0xFF).toByte()
    }
    put(0, magic.toLong())
    put(4, kind.toLong())
    put(8, serial.toLong())
    put(12, seq)
    put(16, frames.toLong())
    return out
  }

  @Test
  fun `hands a PCM message to the feed with the payload offset and frame count`() {
    port.handle(message(SidAudioPort.KIND_PCM, 7, 4_000_000_000L, 3))
    assertEquals(listOf(listOf(7L, 4_000_000_000L, 24L, 3L, 36L)), received)
  }

  @Test
  fun `counts a probe without passing anything on`() {
    port.handle(message(SidAudioPort.KIND_PROBE, 0, 0, 0))
    assertEquals(1, port.probesReceived)
    assertEquals(0, received.size)
  }

  @Test
  fun `rejects a wrong magic, an unknown kind, a short message and a frame count past the payload`() {
    port.handle(message(SidAudioPort.KIND_PCM, 1, 1, 2, magic = 0x12345678))
    port.handle(message(9, 1, 1, 2))
    port.handle(ByteArray(10))
    port.handle(message(SidAudioPort.KIND_PCM, 1, 1, 5, payloadFrames = 4))
    assertEquals(4, port.rejectedMessages)
    assertEquals(0, received.size)
  }
}
