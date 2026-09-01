/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.util.Log
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.sin

/**
 * Synthetic Live View source for Demo Mode.
 *
 * [MockC64UServer] answers `PUT /v1/streams/{video|audio}:start` the same way the real firmware
 * does (200, no body) but never followed it with any packets — so Live View in Demo Mode showed
 * "connected" and then nothing, forever. This class is what a real Ultimate would be doing after
 * that response: it emits actual UDP datagrams, in the exact wire format
 * [StreamUdpPlugin]'s receive/assembly loops decode (see `docs/plans/content-explorer/`), so the
 * SAME receive pipeline a real device drives — native VIC frame assembly, native audio ring — also
 * renders this one. Nothing downstream needs to know the source is synthetic.
 *
 * Sent to loopback (127.0.0.1), never to the LAN: Demo Mode must work with zero network
 * connectivity (airplane mode), and must never place traffic on a shared Wi-Fi multicast group
 * another device or agent might be listening to.
 */
class MockStreamServer {
  private val logTag = "MockStreamServer"
  private var videoThread: Thread? = null
  private var audioThread: Thread? = null
  private val videoRunning = AtomicBoolean(false)
  private val audioRunning = AtomicBoolean(false)

  /** Start the named synthetic stream. `ip` is the receiver's `host:port` (only the port is used). */
  fun start(streamName: String, ip: String) {
    val port = ip.substringAfterLast(':').toIntOrNull()?.takeIf { it in 1..0xffff } ?: defaultPortFor(streamName)
    when (streamName) {
      "video" -> startVideo(port)
      "audio" -> startAudio(port)
    }
  }

  fun stop(streamName: String) {
    when (streamName) {
      "video" -> stopVideo()
      "audio" -> stopAudio()
    }
  }

  /** Stop both streams — called when the mock server itself stops or the plugin is torn down. */
  fun stopAll() {
    stopVideo()
    stopAudio()
  }

  private fun defaultPortFor(streamName: String) = if (streamName == "audio") DEFAULT_AUDIO_PORT else DEFAULT_VIDEO_PORT

  private fun startVideo(port: Int) {
    if (!videoRunning.compareAndSet(false, true)) return
    val thread = Thread({ runVideoLoop(port) }, "MockStreamServer-video")
    thread.isDaemon = true
    videoThread = thread
    thread.start()
  }

  private fun stopVideo() {
    videoRunning.set(false)
    videoThread?.interrupt()
    videoThread = null
  }

  private fun startAudio(port: Int) {
    if (!audioRunning.compareAndSet(false, true)) return
    val thread = Thread({ runAudioLoop(port) }, "MockStreamServer-audio")
    thread.isDaemon = true
    audioThread = thread
    thread.start()
  }

  private fun stopAudio() {
    audioRunning.set(false)
    audioThread?.interrupt()
    audioThread = null
  }

  /**
   * PAL VIC video: one 384x272 4bpp frame per raster refresh (50 Hz), packetized into
   * [VIC_LINES_PER_PACKET]-line groups exactly like the real firmware's wire format
   * (12-byte little-endian header + 768-byte payload; see [buildVicPacket]).
   */
  private fun runVideoLoop(port: Int) {
    try {
      DatagramSocket().use { socket ->
        val dest = InetAddress.getByName("127.0.0.1")
        val lineGroups = VIC_PAL_HEIGHT / VIC_LINES_PER_PACKET
        var frameNum = 0
        var seq = 0
        var nextTickNanos = System.nanoTime()
        while (videoRunning.get() && !Thread.currentThread().isInterrupted) {
          val frame = renderColorBarFrame(frameNum)
          for (group in 0 until lineGroups) {
            if (!videoRunning.get()) return
            val line = group * VIC_LINES_PER_PACKET
            val isLast = group == lineGroups - 1
            val packet = buildVicPacket(frame, seq, frameNum, line, isLast)
            socket.send(DatagramPacket(packet, packet.size, dest, port))
            seq = (seq + 1) and 0xffff
          }
          frameNum = (frameNum + 1) and 0xffff
          nextTickNanos += VIDEO_FRAME_INTERVAL_NANOS
          sleepUntil(nextTickNanos)
        }
      }
    } catch (error: Exception) {
      if (videoRunning.get()) Log.w(logTag, "video generator stopped unexpectedly", error)
    }
  }

  /**
   * PCM audio: a soft, looping arpeggio so Demo Mode's Live View has something musical to play,
   * not silence or noise. Wire format matches [StreamUdpPlugin.receiveLoop]'s audio path exactly:
   * a 2-byte little-endian sequence number, then whole interleaved-stereo S16LE frames.
   */
  private fun runAudioLoop(port: Int) {
    try {
      DatagramSocket().use { socket ->
        val dest = InetAddress.getByName("127.0.0.1")
        var seq = 0
        var sampleIndex = 0L
        val packet = ByteArray(AUDIO_SEQ_BYTES + AUDIO_SAMPLES_PER_PACKET * AUDIO_BYTES_PER_FRAME)
        var nextTickNanos = System.nanoTime()
        while (audioRunning.get() && !Thread.currentThread().isInterrupted) {
          writeU16LE(packet, 0, seq)
          renderArpeggioInto(packet, AUDIO_SEQ_BYTES, sampleIndex)
          socket.send(DatagramPacket(packet, packet.size, dest, port))
          seq = (seq + 1) and 0xffff
          sampleIndex += AUDIO_SAMPLES_PER_PACKET
          nextTickNanos += AUDIO_PACKET_INTERVAL_NANOS
          sleepUntil(nextTickNanos)
        }
      }
    } catch (error: Exception) {
      if (audioRunning.get()) Log.w(logTag, "audio generator stopped unexpectedly", error)
    }
  }

  private fun sleepUntil(targetNanos: Long) {
    val remaining = targetNanos - System.nanoTime()
    if (remaining <= 0) return
    try {
      Thread.sleep(remaining / 1_000_000, (remaining % 1_000_000).toInt())
    } catch (error: InterruptedException) {
      Thread.currentThread().interrupt()
    }
  }

  companion object {
    const val DEFAULT_VIDEO_PORT = 11000
    const val DEFAULT_AUDIO_PORT = 11001

    // VIC wire format — must match src/lib/streams/vicStream.ts and vicDecode.ts exactly, since
    // the JS/native decoders on the receiving end are built against those constants.
    const val VIC_HEADER_BYTES = 12
    const val VIC_FRAME_WIDTH = 384
    const val VIC_BYTES_PER_LINE = VIC_FRAME_WIDTH / 2 // 192, 4bpp
    const val VIC_LAST_LINE_FLAG = 0x8000
    const val VIC_LINES_PER_PACKET = 4
    const val VIC_BITS_PER_PIXEL = 4
    const val VIC_PAL_HEIGHT = 272
    const val VIC_BYTES_PER_FRAME = (VIC_FRAME_WIDTH * VIC_PAL_HEIGHT) / 2 // 52224
    private const val VIDEO_FRAME_INTERVAL_NANOS = 20_000_000L // 50 Hz PAL

    // Audio wire format — must match StreamUdpPlugin's AUDIO_SEQ_BYTES/AUDIO_BYTES_PER_FRAME.
    const val AUDIO_SEQ_BYTES = 2
    const val AUDIO_BYTES_PER_FRAME = 4 // stereo S16LE
    // C64U PAL audio sample rate (same source of truth as StreamUdpPlugin.DEFAULT_AUDIO_SAMPLE_RATE).
    const val AUDIO_SAMPLE_RATE = 47983
    // ~4 ms/packet, matching the real device's per-packet cadence (see StreamUdpPlugin receiveLoop).
    const val AUDIO_SAMPLES_PER_PACKET = 192
    private const val AUDIO_PACKET_INTERVAL_NANOS = AUDIO_SAMPLES_PER_PACKET * 1_000_000_000L / AUDIO_SAMPLE_RATE

    private fun writeU16LE(buffer: ByteArray, offset: Int, value: Int) {
      buffer[offset] = (value and 0xff).toByte()
      buffer[offset + 1] = ((value ushr 8) and 0xff).toByte()
    }

    /**
     * One [VIC_HEADER_BYTES]-byte little-endian header + one line-group's payload, matching the
     * real firmware's packet layout byte-for-byte (see `vicStream.ts`'s `parseVicHeader` and
     * `vicTestPattern.ts`'s `packetizeVicFrame`, which this mirrors in Kotlin).
     */
    fun buildVicPacket(frame: ByteArray, seq: Int, frameNum: Int, line: Int, isLastLine: Boolean): ByteArray {
      val packet = ByteArray(VIC_HEADER_BYTES + VIC_LINES_PER_PACKET * VIC_BYTES_PER_LINE)
      writeU16LE(packet, 0, seq and 0xffff)
      writeU16LE(packet, 2, frameNum and 0xffff)
      writeU16LE(packet, 4, (line and 0x7fff) or (if (isLastLine) VIC_LAST_LINE_FLAG else 0))
      writeU16LE(packet, 6, VIC_FRAME_WIDTH)
      packet[8] = VIC_LINES_PER_PACKET.toByte()
      packet[9] = VIC_BITS_PER_PIXEL.toByte()
      writeU16LE(packet, 10, 0)
      val srcOffset = line * VIC_BYTES_PER_LINE
      System.arraycopy(frame, srcOffset, packet, VIC_HEADER_BYTES, VIC_LINES_PER_PACKET * VIC_BYTES_PER_LINE)
      return packet
    }

    /**
     * A moving rainbow raster-bar pattern — 16px-wide vertical bars cycling through all 16 VIC
     * palette indices, scrolling sideways at one bar-width every 8 frames, with a per-row sine
     * wobble so it reads as motion rather than a static test card. Every nibble is a valid palette
     * index (0-15) by construction, so it always decodes to a full-colour frame.
     */
    fun renderColorBarFrame(frameNum: Int): ByteArray {
      val frame = ByteArray(VIC_BYTES_PER_FRAME)
      val scrollPx = (frameNum * 2) % (BAR_WIDTH_PX * PALETTE_SIZE)
      for (y in 0 until VIC_PAL_HEIGHT) {
        val wobble = (sin((y + frameNum).toDouble() / 24.0) * 6.0).toInt()
        val rowOffset = y * VIC_BYTES_PER_LINE
        for (xByte in 0 until VIC_BYTES_PER_LINE) {
          val xLeft = xByte * 2
          val xRight = xLeft + 1
          val left = colorIndexForColumn(xLeft + scrollPx + wobble)
          val right = colorIndexForColumn(xRight + scrollPx + wobble)
          frame[rowOffset + xByte] = ((right shl 4) or left).toByte()
        }
      }
      return frame
    }

    private const val BAR_WIDTH_PX = 16
    private const val PALETTE_SIZE = 16

    private fun colorIndexForColumn(x: Int): Int {
      val wrapped = ((x % (BAR_WIDTH_PX * PALETTE_SIZE)) + BAR_WIDTH_PX * PALETTE_SIZE) % (BAR_WIDTH_PX * PALETTE_SIZE)
      return (wrapped / BAR_WIDTH_PX) and 0x0f
    }

    // A pentatonic arpeggio (C major pentatonic, A4=440Hz equal temperament) — pleasant and
    // unmistakably synthetic, so nobody mistakes Demo Mode's audio for a captured SID recording.
    private val ARPEGGIO_HZ = doubleArrayOf(261.63, 293.66, 329.63, 392.00, 440.00, 392.00, 329.63, 293.66)
    private const val NOTE_SECONDS = 0.5
    private const val AMPLITUDE = 6000.0

    /**
     * Renders [AUDIO_SAMPLES_PER_PACKET] interleaved-stereo S16LE frames starting at the given
     * absolute sample index into `buffer` at `offset`, with a short attack/release envelope at
     * each note boundary so the arpeggio has no audible clicks.
     */
    fun renderArpeggioInto(buffer: ByteArray, offset: Int, startSampleIndex: Long) {
      val samplesPerNote = (NOTE_SECONDS * AUDIO_SAMPLE_RATE).toLong()
      for (i in 0 until AUDIO_SAMPLES_PER_PACKET) {
        val sampleIndex = startSampleIndex + i
        val noteIndex = ((sampleIndex / samplesPerNote) % ARPEGGIO_HZ.size).toInt()
        val positionInNote = sampleIndex % samplesPerNote
        val hz = ARPEGGIO_HZ[noteIndex]
        val phase = 2.0 * Math.PI * hz * (sampleIndex.toDouble() / AUDIO_SAMPLE_RATE)
        val envelope = noteEnvelope(positionInNote, samplesPerNote)
        val value = (sin(phase) * AMPLITUDE * envelope).toInt().coerceIn(-32768, 32767)
        val byteOffset = offset + i * AUDIO_BYTES_PER_FRAME
        writeU16LE(buffer, byteOffset, value and 0xffff) // left
        writeU16LE(buffer, byteOffset + 2, value and 0xffff) // right
      }
    }

    private fun noteEnvelope(positionInNote: Long, samplesPerNote: Long): Double {
      val rampSamples = (samplesPerNote / 10).coerceAtLeast(1)
      return when {
        positionInNote < rampSamples -> positionInNote.toDouble() / rampSamples
        positionInNote > samplesPerNote - rampSamples -> (samplesPerNote - positionInNote).toDouble() / rampSamples
        else -> 1.0
      }
    }
  }
}
