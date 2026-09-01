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

/**
 * Synthetic Live View source for Demo Mode.
 *
 * [MockC64UServer] answers `PUT /v1/streams/{video|audio}:start` the same way the real firmware
 * does (200, no body) but never followed it with any packets — so Live View in Demo Mode showed
 * "connected" and then nothing, forever. This class is what a real Ultimate would be doing after
 * that response: it emits actual UDP datagrams, in the exact wire format [StreamUdpPlugin]'s
 * receive/assembly loops decode, so the SAME receive pipeline a real device drives — native VIC
 * frame assembly, native audio ring, stream governor, Stats panel — also renders this one. Nothing
 * downstream needs to know the source is synthetic.
 *
 * Sent to loopback (127.0.0.1), never to the LAN: Demo Mode must work with zero network
 * connectivity (airplane mode), and must never place traffic on a shared Wi-Fi multicast group
 * another device or agent might be listening to.
 *
 * The one thing this device cannot afford is to generate the stream while it plays it — it is both
 * ends of the link, and per-frame pixel work plus per-sample trigonometry on the sending side would
 * come out of the receiving side's budget. So every byte is pre-built by [DemoStreamContent] before
 * the first packet goes out, and the send loops below do nothing per packet but patch a two-byte
 * sequence number (and, for video, the frame number) into an array they already hold and send it
 * again. No allocation, no arithmetic on the payload, for as long as the stream runs.
 */
class MockStreamServer(private val contentProvider: () -> DemoStreamContent) {
  private val logTag = "MockStreamServer"
  private var videoThread: Thread? = null
  private var audioThread: Thread? = null
  private val videoRunning = AtomicBoolean(false)
  private val audioRunning = AtomicBoolean(false)

  /**
   * Built on first use, not at construction: reading three assets and rendering nine seconds of
   * audio takes long enough that doing it when the mock REST server starts would show up as
   * startup latency for every Demo Mode session, including the ones that never open Live View.
   */
  @Volatile private var content: DemoStreamContent? = null

  private fun content(): DemoStreamContent = content ?: contentProvider().also { content = it }

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
   * One pre-packetised frame per ladder slot, each sent [DemoStreamContent.FRAMES_PER_SLOT] times.
   *
   * The card is static within a slot and only its surround colour changes between slots, so the
   * same 68 datagrams carry every frame of that half-second. The frame number still advances on
   * every one of them, which is what the receiver assembles and counts, so a stalled or duplicated
   * frame is as visible here as it would be from a real device.
   */
  private fun runVideoLoop(port: Int) {
    try {
      val content = content()
      DatagramSocket().use { socket ->
        val dest = InetAddress.getByName(LOOPBACK)
        var frameNum = 0
        var seq = 0
        var nextTickNanos = System.nanoTime()
        while (videoRunning.get() && !Thread.currentThread().isInterrupted) {
          val slotPackets = content.videoSlotPackets[(frameNum / DemoStreamContent.FRAMES_PER_SLOT) % content.slots.size]
          for (packet in slotPackets) {
            if (!videoRunning.get()) return
            DemoStreamContent.writeU16LE(packet, 0, seq)
            DemoStreamContent.writeU16LE(packet, 2, frameNum and 0xffff)
            socket.send(DatagramPacket(packet, packet.size, dest, port))
            seq = (seq + 1) and 0xffff
          }
          frameNum = (frameNum + 1) % content.loopFrames
          nextTickNanos += content.videoFrameIntervalNanos
          sleepUntil(nextTickNanos)
        }
      }
    } catch (error: Exception) {
      if (videoRunning.get()) Log.w(logTag, "video generator stopped unexpectedly", error)
    }
  }

  /**
   * The whole audio loop, pre-rendered, sent packet by packet and then started again.
   *
   * The loop lasts exactly as long as the video loop ([DemoStreamContent.loopNanos] drives both),
   * so the note and the colour that were written together stay together however long the stream
   * runs — which is the property that makes the audio-to-video offset measurable from this stream.
   */
  private fun runAudioLoop(port: Int) {
    try {
      val content = content()
      DatagramSocket().use { socket ->
        val dest = InetAddress.getByName(LOOPBACK)
        var seq = 0
        var packetIndex = 0
        var nextTickNanos = System.nanoTime()
        while (audioRunning.get() && !Thread.currentThread().isInterrupted) {
          val packet = content.audioPackets[packetIndex]
          DemoStreamContent.writeU16LE(packet, 0, seq)
          socket.send(DatagramPacket(packet, packet.size, dest, port))
          seq = (seq + 1) and 0xffff
          packetIndex = (packetIndex + 1) % content.audioPackets.size
          nextTickNanos += content.audioPacketIntervalNanos
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
    private const val LOOPBACK = "127.0.0.1"
  }
}
