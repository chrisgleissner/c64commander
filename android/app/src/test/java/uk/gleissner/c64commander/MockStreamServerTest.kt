/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import java.io.File
import java.net.DatagramPacket
import java.net.DatagramSocket
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MockStreamServerTest {
  private val assetDir = File("src/main/assets/demo-stream")

  private fun content() =
          DemoStreamContent.from(
                  File(assetDir, "font8x8.bin").readBytes(),
                  File(assetDir, "tone-ladder.json").readText(),
          )

  private fun server() = MockStreamServer { content() }

  /** Receive `count` datagrams from a fresh loopback socket the server is told to send to. */
  private fun receive(streamName: String, count: Int, timeoutMs: Int = 4000): List<ByteArray> {
    val server = server()
    DatagramSocket(0).use { receiver ->
      receiver.soTimeout = timeoutMs
      try {
        server.start(streamName, "127.0.0.1:${receiver.localPort}")
        return (0 until count).map {
          val buffer = ByteArray(2048)
          val packet = DatagramPacket(buffer, buffer.size)
          receiver.receive(packet)
          buffer.copyOfRange(packet.offset, packet.offset + packet.length)
        }
      } finally {
        server.stopAll()
      }
    }
  }

  @Test
  fun videoSendsWireFormatPacketsToTheGivenLoopbackPort() {
    val packets = receive("video", 4)
    for (packet in packets) {
      assertEquals(
              DemoStreamContent.VIC_HEADER_BYTES +
                      DemoStreamContent.VIC_LINES_PER_PACKET * DemoStreamContent.VIC_BYTES_PER_LINE,
              packet.size,
      )
      assertEquals(DemoStreamContent.VIC_FRAME_WIDTH, DemoStreamContent.readU16LE(packet, 6))
      assertEquals(DemoStreamContent.VIC_LINES_PER_PACKET, packet[8].toInt())
      assertEquals(DemoStreamContent.VIC_BITS_PER_PIXEL, packet[9].toInt())
    }
  }

  @Test
  fun videoSequenceNumbersAdvanceByOnePerPacket() {
    // The pre-built packets are reused for the whole run, so the sequence number is patched into
    // them per send. If that patch were dropped, every packet would carry seq 0 and the receiver
    // would report the stream as one endless duplicate.
    val packets = receive("video", 8)
    val sequences = packets.map { DemoStreamContent.readU16LE(it, 0) }
    for (index in 1 until sequences.size) {
      assertEquals("packet $index", (sequences[0] + index) and 0xffff, sequences[index])
    }
  }

  @Test
  fun videoFrameNumbersAdvanceOncePerFrame() {
    val perFrame = DemoStreamContent.VIC_PACKETS_PER_FRAME
    val packets = receive("video", perFrame * 2 + 1)
    val frameNumbers = packets.map { DemoStreamContent.readU16LE(it, 2) }

    // Whatever frame the capture started in, the frame number must change exactly where the
    // last-line flag says a frame ended, and nowhere else.
    for (index in 1 until packets.size) {
      val previousWasLastLine = DemoStreamContent.readU16LE(packets[index - 1], 4) and DemoStreamContent.VIC_LAST_LINE_FLAG != 0
      if (previousWasLastLine) {
        assertNotEquals("frame must advance after its last line", frameNumbers[index - 1], frameNumbers[index])
      } else {
        assertEquals("frame must not advance mid-frame", frameNumbers[index - 1], frameNumbers[index])
      }
    }
  }

  @Test
  fun audioSendsSeqPrefixedStereoPcmToTheGivenLoopbackPort() {
    val packets = receive("audio", 4)
    val expectedSize =
            DemoStreamContent.AUDIO_SEQ_BYTES +
                    DemoStreamContent.AUDIO_SAMPLES_PER_PACKET * DemoStreamContent.AUDIO_BYTES_PER_FRAME
    for (packet in packets) assertEquals(expectedSize, packet.size)

    val sequences = packets.map { DemoStreamContent.readU16LE(it, 0) }
    for (index in 1 until sequences.size) {
      assertEquals((sequences[0] + index) and 0xffff, sequences[index])
    }
  }

  @Test
  fun contentIsBuiltOnceAndReusedForEveryPacket() {
    // The whole point of pre-building is that the send loop does no work per packet. If the loop
    // ever went back to the provider, this device would be rendering nine seconds of audio and 18
    // frames again mid-stream.
    var builds = 0
    val server = MockStreamServer {
      builds += 1
      content()
    }
    DatagramSocket(0).use { receiver ->
      receiver.soTimeout = 4000
      try {
        server.start("video", "127.0.0.1:${receiver.localPort}")
        repeat(20) {
          val packet = DatagramPacket(ByteArray(2048), 2048)
          receiver.receive(packet)
        }
      } finally {
        server.stopAll()
      }
    }
    assertEquals(1, builds)
  }

  @Test
  fun contentIsNotBuiltUntilAStreamStarts() {
    var builds = 0
    MockStreamServer {
      builds += 1
      content()
    }
    assertEquals("constructing the server must not read assets or render audio", 0, builds)
  }

  @Test
  fun stopEndsTheStream() {
    val server = server()
    DatagramSocket(0).use { receiver ->
      receiver.soTimeout = 4000
      server.start("video", "127.0.0.1:${receiver.localPort}")
      receiver.receive(DatagramPacket(ByteArray(2048), 2048))
      server.stop("video")

      // Drain whatever was already in flight, then require silence.
      receiver.soTimeout = 300
      var drained = 0
      while (drained < 200) {
        try {
          receiver.receive(DatagramPacket(ByteArray(2048), 2048))
          drained += 1
        } catch (_: java.net.SocketTimeoutException) {
          return
        }
      }
      throw AssertionError("stream kept sending after stop")
    }
  }

  @Test
  fun aMissingPortFallsBackToTheDefaultForTheStream() {
    val server = server()
    DatagramSocket(MockStreamServer.DEFAULT_VIDEO_PORT).use { receiver ->
      receiver.soTimeout = 4000
      try {
        server.start("video", "127.0.0.1")
        val packet = DatagramPacket(ByteArray(2048), 2048)
        receiver.receive(packet)
        assertTrue(packet.length > DemoStreamContent.VIC_HEADER_BYTES)
      } finally {
        server.stopAll()
      }
    }
  }

  @Test
  fun unknownStreamNameIsIgnoredRatherThanThrowing() {
    val server = server()
    server.start("bogus", "127.0.0.1:11000")
    server.stop("bogus")
    server.stopAll()
  }
}
