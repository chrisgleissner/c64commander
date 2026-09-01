/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import java.net.DatagramPacket
import java.net.DatagramSocket
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MockStreamServerTest {
  private fun u16(bytes: ByteArray, offset: Int): Int =
          (bytes[offset].toInt() and 0xff) or ((bytes[offset + 1].toInt() and 0xff) shl 8)

  @Test
  fun buildVicPacketHeaderMatchesWireFormat() {
    val frame = ByteArray(MockStreamServer.VIC_BYTES_PER_FRAME) { (it and 0xff).toByte() }
    val packet = MockStreamServer.buildVicPacket(frame, seq = 0x1234, frameNum = 0x5678, line = 40, isLastLine = false)

    assertEquals(
            MockStreamServer.VIC_HEADER_BYTES + MockStreamServer.VIC_LINES_PER_PACKET * MockStreamServer.VIC_BYTES_PER_LINE,
            packet.size,
    )
    assertEquals(0x1234, u16(packet, 0))
    assertEquals(0x5678, u16(packet, 2))
    assertEquals(40, u16(packet, 4)) // last-line flag clear
    assertEquals(MockStreamServer.VIC_FRAME_WIDTH, u16(packet, 6))
    assertEquals(MockStreamServer.VIC_LINES_PER_PACKET, packet[8].toInt())
    assertEquals(MockStreamServer.VIC_BITS_PER_PIXEL, packet[9].toInt())
    assertEquals(0, u16(packet, 10))

    val srcOffset = 40 * MockStreamServer.VIC_BYTES_PER_LINE
    for (i in 0 until MockStreamServer.VIC_LINES_PER_PACKET * MockStreamServer.VIC_BYTES_PER_LINE) {
      assertEquals(
              "payload byte $i should be copied from the source frame",
              frame[srcOffset + i],
              packet[MockStreamServer.VIC_HEADER_BYTES + i],
      )
    }
  }

  @Test
  fun buildVicPacketSetsLastLineFlagOnlyWhenAsked() {
    val frame = ByteArray(MockStreamServer.VIC_BYTES_PER_FRAME)
    val last = MockStreamServer.buildVicPacket(frame, seq = 0, frameNum = 0, line = 268, isLastLine = true)
    assertEquals(268 or MockStreamServer.VIC_LAST_LINE_FLAG, u16(last, 4))

    val notLast = MockStreamServer.buildVicPacket(frame, seq = 0, frameNum = 0, line = 268, isLastLine = false)
    assertEquals(268, u16(notLast, 4))
  }

  @Test
  fun renderColorBarFrameProducesOnlyValidPaletteIndices() {
    val frame = MockStreamServer.renderColorBarFrame(frameNum = 7)
    assertEquals(MockStreamServer.VIC_BYTES_PER_FRAME, frame.size)
    for (byte in frame) {
      val low = byte.toInt() and 0x0f
      val high = (byte.toInt() shr 4) and 0x0f
      assertTrue("low nibble $low out of palette range", low in 0..15)
      assertTrue("high nibble $high out of palette range", high in 0..15)
    }
  }

  @Test
  fun renderColorBarFrameAnimatesAcrossFrameNumbers() {
    // A demo viewer must see MOTION, not a static test card — successive frames must differ.
    val frame0 = MockStreamServer.renderColorBarFrame(frameNum = 0)
    val frame1 = MockStreamServer.renderColorBarFrame(frameNum = 4)
    assertNotEquals(frame0.toList(), frame1.toList())
  }

  @Test
  fun renderArpeggioProducesInBoundsStereoSamplesWithNoDcOffsetAtNoteStart() {
    val buffer = ByteArray(MockStreamServer.AUDIO_SAMPLES_PER_PACKET * MockStreamServer.AUDIO_BYTES_PER_FRAME)
    MockStreamServer.renderArpeggioInto(buffer, 0, startSampleIndex = 0L)

    // The envelope ramps up from zero at a note boundary (sample index 0 is one), so the very
    // first stereo frame must be silent — proves the click-avoidance envelope is actually wired.
    val firstLeft = (buffer[0].toInt() and 0xff) or (buffer[1].toInt() shl 8)
    assertEquals(0, firstLeft)

    for (i in 0 until MockStreamServer.AUDIO_SAMPLES_PER_PACKET) {
      val offset = i * MockStreamServer.AUDIO_BYTES_PER_FRAME
      val left = ((buffer[offset + 1].toInt() shl 8) or (buffer[offset].toInt() and 0xff)).toShort()
      val right = ((buffer[offset + 3].toInt() shl 8) or (buffer[offset + 2].toInt() and 0xff)).toShort()
      assertEquals("channels must match (mono content, duplicated to stereo)", left, right)
    }
  }

  @Test
  fun startVideoSendsRealDecodablePacketsToTheGivenLoopbackPort() {
    val server = MockStreamServer()
    DatagramSocket(0).use { receiver ->
      receiver.soTimeout = 2000
      val port = receiver.localPort
      try {
        server.start("video", "127.0.0.1:$port")
        val buffer = ByteArray(2048)
        val packet = DatagramPacket(buffer, buffer.size)
        receiver.receive(packet)

        assertEquals("127.0.0.1", packet.address.hostAddress)
        assertTrue("expected a full VIC line-group packet", packet.length >= MockStreamServer.VIC_HEADER_BYTES)
        assertEquals(MockStreamServer.VIC_FRAME_WIDTH, u16(packet.data.copyOfRange(packet.offset, packet.offset + 12), 6))
      } finally {
        server.stopAll()
      }
    }
  }

  @Test
  fun startAudioSendsSeqPrefixedStereoPcmToTheGivenLoopbackPort() {
    val server = MockStreamServer()
    DatagramSocket(0).use { receiver ->
      receiver.soTimeout = 2000
      val port = receiver.localPort
      try {
        server.start("audio", "127.0.0.1:$port")
        val buffer = ByteArray(2048)
        val packet = DatagramPacket(buffer, buffer.size)
        receiver.receive(packet)

        val expectedSize = MockStreamServer.AUDIO_SEQ_BYTES + MockStreamServer.AUDIO_SAMPLES_PER_PACKET * MockStreamServer.AUDIO_BYTES_PER_FRAME
        assertEquals(expectedSize, packet.length)
      } finally {
        server.stopAll()
      }
    }
  }

  @Test
  fun unknownStreamNameIsIgnoredRatherThanThrowing() {
    val server = MockStreamServer()
    server.start("bogus", "127.0.0.1:11000")
    server.stop("bogus")
    server.stopAll()
  }
}
