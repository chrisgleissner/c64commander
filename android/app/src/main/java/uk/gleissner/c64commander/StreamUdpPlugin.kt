/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Process
import android.util.Base64
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Native UDP receiver for the A/V mirror (Content Explorer). The C64 Ultimate streams raw
 * VIC video / audio as UDP datagrams; a WebView cannot open a UDP socket, so this plugin
 * binds the two ports natively and forwards data to the JS layer. It is the native
 * counterpart of the web server's UDP -> WebSocket bridge.
 *
 * There are two forwarding modes:
 *   - Per-packet (`datagram` events): audio, and video when native assembly is off. Each datagram
 *     is base64-encoded and crosses the Capacitor bridge on its own.
 *   - Native frame assembly (`videoframe` events, `bind({assemble:true})`): the plugin reassembles
 *     the ~68 VIC datagrams of a frame into ONE 52224-byte buffer and crosses the bridge once per
 *     FRAME (~50/s PAL). The per-event bridge overhead of the per-packet path (~3400 events/s) was
 *     the hard cap that held the mirror at ~20–30 fps; assembling natively lifts it to full rate.
 *
 * The firmware's default (and reliable) stream destination is **multicast** — unicast
 * `streams:start` returns "Network Host Resolve Error" because the device streams from its
 * wired port and cannot ARP-resolve a Wi-Fi phone. So `bind` joins the multicast group and
 * holds a Wi-Fi `MulticastLock` (without it, the Wi-Fi driver filters multicast).
 */
@CapacitorPlugin(name = "StreamUdp")
class StreamUdpPlugin : Plugin() {
  private val sockets = ConcurrentHashMap<String, DatagramSocket>()
  private val executor = Executors.newCachedThreadPool()
  private val logTag = "StreamUdpPlugin"
  private var multicastLock: WifiManager.MulticastLock? = null

  /** Test seam: monotonic clock (nanoseconds) stamped at socket receive. Default: `System.nanoTime`. */
  internal var clockNanos: () -> Long = { System.nanoTime() }

  /**
   * Test seam: how a received datagram is delivered to JS (default: a `datagram` event).
   *
   * `arrivalMs` is a **monotonic wire-arrival timestamp** (ms, `System.nanoTime`-based) captured
   * the instant the datagram is read off the socket — before the Capacitor bridge hop, base64
   * encoding, frame assembly or decode. The A/V sync analyzer measures the audio↔video offset
   * from these, so the (asymmetric) downstream latency of the two pipelines cannot skew it: both
   * streams are stamped on the same clock at the earliest possible point.
   */
  internal var emitDatagram: (String, String, Double) -> Unit = { name, data, arrivalMs ->
    val event = JSObject()
    event.put("name", name)
    event.put("data", data)
    event.put("t", arrivalMs)
    notifyListeners("datagram", event)
  }

  /**
   * Test seam: how an assembled VIC frame is delivered to JS (default: a `videoframe` event).
   * `data` is base64 of the whole 52224-byte frame, `arrivalMs` the frame-start wire time (earliest
   * packet), `height` the line count (PAL 272 / NTSC 240), `dropped` the cumulative sequence-gap
   * (packet-loss) count, `lost` the cumulative FRAME-loss count (gaps in the frame-number sequence).
   */
  internal var emitFrame: (String, String, Double, Int, Int, Int, Boolean) -> Unit = {
    name,
    data,
    arrivalMs,
    height,
    dropped,
    lost,
    present ->
    val event = JSObject()
    event.put("name", name)
    event.put("data", data)
    event.put("t", arrivalMs)
    event.put("height", height)
    event.put("dropped", dropped)
    event.put("lost", lost)
    event.put("present", present)
    notifyListeners("videoframe", event)
  }

  /**
   * Per-stream keep-rate in permille (0–1000; default 1000 = present every frame). The governor
   * pushes this so the assembler can DECIMATE natively — skipping the ~52 KB Base64 encode + the
   * bridge hop + the JS decode for frames that will not be presented. HIL showed decimating only in
   * JS barely reduced CPU because every frame was still base64'd on both sides; deciding here is what
   * makes the frame-rate governor actually save CPU. Receive, assembly and loss accounting stay
   * complete for EVERY frame (spec §11.4) — only the encode + forward of a skipped frame is elided.
   */
  private val keepPermille = ConcurrentHashMap<String, Int>()

  @PluginMethod
  fun setKeepFraction(call: PluginCall) {
    val name = call.getString("name")
    if (name == null) {
      call.reject("name is required")
      return
    }
    val permille = (call.getInt("permille") ?: 1000).coerceIn(0, 1000)
    keepPermille[name] = permille
    call.resolve(JSObject())
  }

  @PluginMethod
  fun bind(call: PluginCall) {
    val name = call.getString("name")
    if (name == null) {
      call.reject("name is required")
      return
    }
    val port = call.getInt("port")
    if (port == null) {
      call.reject("port is required")
      return
    }
    val group = call.getString("group") // multicast group, e.g. 239.0.1.64; null = plain unicast
    val assemble = call.getBoolean("assemble", false) == true
    try {
      closeSocket(name)
      val socket: DatagramSocket =
        if (group != null) {
          acquireMulticastLock()
          MulticastSocket(null).apply {
            reuseAddress = true
            bind(InetSocketAddress(port))
            val netIf = siteLocalInterface()
            joinGroup(InetSocketAddress(InetAddress.getByName(group), port), netIf)
          }
        } else {
          DatagramSocket(null).apply {
            reuseAddress = true
            bind(InetSocketAddress(port))
          }
        }
      // Enlarge the OS receive buffer so a scheduling gap or GC pause can't silently drop packets:
      // video is ~3400 pkt/s × ~780 B ≈ 2.6 MB/s, so the small default SO_RCVBUF can overflow under
      // load (HIL saw occasional drops even on a clean LAN). The OS may cap the request; harmless.
      try {
        socket.receiveBufferSize = RECV_BUFFER_BYTES
      } catch (error: Exception) {
        Log.d(logTag, "receiveBufferSize hint ignored for $name", error)
      }
      sockets[name] = socket
      if (assemble) {
        executor.execute { assembleLoop(name, socket) }
      } else {
        executor.execute { receiveLoop(name, socket) }
      }
      val result = JSObject()
      result.put("localIp", siteLocalIpv4() ?: "")
      result.put("port", socket.localPort)
      call.resolve(result)
    } catch (error: Exception) {
      // Release the multicast lock if we acquired it above but never got a running socket, so a
      // failed multicast bind cannot leak the Wi-Fi MulticastLock (it is not reference-counted).
      if (sockets.isEmpty()) releaseMulticastLock()
      Log.w(logTag, "bind failed for $name:$port (group=$group, assemble=$assemble)", error)
      call.reject("bind failed: ${error.message}", error)
    }
  }

  @PluginMethod
  fun close(call: PluginCall) {
    val name = call.getString("name")
    if (name == null) {
      call.reject("name is required")
      return
    }
    closeSocket(name)
    call.resolve(JSObject())
  }

  private fun receiveLoop(name: String, socket: DatagramSocket) {
    raiseThreadPriority(name)
    // VIC packets are ~780 bytes and audio ~770; 2048 leaves ample headroom.
    val buffer = ByteArray(2048)
    // Reuse one DatagramPacket across the loop (reset its length each time) to avoid a per-packet
    // allocation on the hot receive thread (~3400/s video) — less GC pressure (spec §1.4).
    val packet = DatagramPacket(buffer, buffer.size)
    val stats = RateLog(name, "raw")
    // Frame/loss accounting only makes sense for the VIC video stream; applying VIC last-line/
    // frame-number parsing to AUDIO packets reads PCM bytes as frame numbers and reports garbage
    // (HIL saw audio "lost" climbing into the thousands). Audio reports packets/s only.
    val countFrames = name == "video"
    var prevCompletedFrame = -1
    var lost = 0
    while (!socket.isClosed) {
      try {
        packet.setLength(buffer.size)
        socket.receive(packet)
        // Stamp wire-arrival time immediately, before any encoding/bridge latency (see emitDatagram).
        val arrivalNanos = clockNanos()
        val encoded = Base64.encodeToString(packet.data, packet.offset, packet.length, Base64.NO_WRAP)
        emitDatagram(name, encoded, arrivalNanos / 1_000_000.0)
        // Count a completed frame when this datagram carries the last-line flag (cheap header peek),
        // and track frame-number gaps, so the per-second measurement log reports frames/s AND frame
        // loss even on the per-packet path (JS still does the authoritative assembly + loss counting).
        var completedFrame = false
        if (countFrames && packet.length >= VIC_HEADER_BYTES && isLastLine(packet.data, packet.offset)) {
          completedFrame = true
          val frameNum = u16(packet.data, packet.offset + 2)
          if (prevCompletedFrame >= 0) {
            val gap = (frameNum - prevCompletedFrame).toShort().toInt()
            if (gap > 1) lost += gap - 1
          }
          prevCompletedFrame = frameNum
        }
        stats.record(arrivalNanos, if (completedFrame) 1 else 0, 0, lost)
      } catch (error: Exception) {
        if (socket.isClosed) break
        // Transient receive error on a still-open socket: log with the stack trace (mandatory
        // exception handling) and keep listening rather than tearing the stream down.
        Log.w(logTag, "Transient receive error on $name socket; continuing", error)
      }
    }
  }

  /**
   * Raise the receive thread's scheduling priority so a busy device can't starve packet reception
   * (packet-loss resilience, spec §10.3). Audio feeds real-time playback → URGENT_AUDIO; video →
   * DISPLAY. Threads default to background priority otherwise.
   */
  private fun raiseThreadPriority(name: String) {
    try {
      Process.setThreadPriority(
        if (name == "audio") Process.THREAD_PRIORITY_URGENT_AUDIO else Process.THREAD_PRIORITY_DISPLAY,
      )
    } catch (error: Exception) {
      Log.d(logTag, "setThreadPriority ignored for $name", error)
    }
  }

  /**
   * Native VIC frame assembler (the Live View fast path). Reassembles the per-line datagrams of a
   * frame into one 52224-byte 4bpp buffer and emits it as a single `videoframe` event, collapsing
   * ~68 bridge hops per frame into one. Format/guard rules mirror the JS `VicStreamAssembler` and
   * c64stream exactly (width 384, 4 lines/packet, 4 bpp). Thread-confined: the buffer and all
   * assembly state live on this receive thread, so no synchronisation is needed.
   */
  private fun assembleLoop(name: String, socket: DatagramSocket) {
    raiseThreadPriority(name)
    val buffer = ByteArray(2048)
    // Reuse one DatagramPacket across the loop (reset length per receive) — no per-packet alloc on
    // the hot video receive thread (~3400/s).
    val packet = DatagramPacket(buffer, buffer.size)
    val frame = ByteArray(VIC_BYTES_PER_FRAME)
    var lastSeq = -1
    var dropped = 0
    var lost = 0
    var prevCompletedFrame = -1
    var curFrameNum = -1
    var frameStartNanos = Long.MAX_VALUE
    var frameHeight = VIC_PAL_HEIGHT
    // Bresenham phase accumulator (permille units) for native cadence decimation; thread-confined.
    var phaseAccum = 0
    val stats = RateLog(name, "assembled")
    while (!socket.isClosed) {
      try {
        packet.setLength(buffer.size)
        socket.receive(packet)
        val arrivalNanos = clockNanos()
        val data = packet.data
        val off = packet.offset
        val len = packet.length
        if (len < VIC_HEADER_BYTES) {
          continue
        }

        val seq = u16(data, off + 0)
        val frameNum = u16(data, off + 2)
        val lineRaw = u16(data, off + 4)
        val line = lineRaw and 0x7FFF
        val lastLine = (lineRaw and LAST_LINE_FLAG) != 0
        val width = u16(data, off + 6)
        val linesPerPacket = data[off + 8].toInt() and 0xFF
        val bpp = data[off + 9].toInt() and 0xFF

        // Dropped-packet accounting via 16-bit sequence gaps (mirrors VicStreamAssembler).
        if (lastSeq >= 0) {
          val gap = (seq - lastSeq - 1) and 0xFFFF
          if (gap in 1 until 0x8000) dropped += gap
        }
        lastSeq = seq

        // Frame-start = the earliest wire arrival of any packet of this frame (top of frame == when
        // the av-sync tone gate opens), so the analyzer can cancel the asymmetric assembly latency.
        if (frameNum != curFrameNum) {
          curFrameNum = frameNum
          frameStartNanos = arrivalNanos
        } else if (arrivalNanos < frameStartNanos) {
          frameStartNanos = arrivalNanos
        }

        val valid = width == VIC_FRAME_WIDTH && linesPerPacket == VIC_LINES_PER_PACKET && bpp == VIC_BITS_PER_PIXEL
        if (valid) {
          val writeOffset = line * VIC_BYTES_PER_LINE
          if (writeOffset < VIC_BYTES_PER_FRAME) {
            val available = VIC_BYTES_PER_FRAME - writeOffset
            val payloadLen = len - VIC_HEADER_BYTES
            val count = minOf(payloadLen, linesPerPacket * VIC_BYTES_PER_LINE, available)
            if (count > 0) System.arraycopy(data, off + VIC_HEADER_BYTES, frame, writeOffset, count)
          }
        }

        if (lastLine) {
          // Height derives from the last packet (line + linesPerPacket), clamped to [NTSC, PAL].
          frameHeight = clampFrameHeight(line + (if (linesPerPacket > 0) linesPerPacket else VIC_LINES_PER_PACKET))
          // Frame-loss: a jump of >1 in the frame number between consecutively completed frames means
          // the intervening frame(s) never completed. Wrap-safe (65535→0) via Short truncation.
          if (prevCompletedFrame >= 0) {
            val gap = (frameNum - prevCompletedFrame).toShort().toInt()
            if (gap > 1) lost += gap - 1
          }
          prevCompletedFrame = frameNum
          // Native cadence decision: present this frame only when the accumulator crosses 1000.
          // A skipped frame emits a tiny event (empty data, present=false) so JS still counts it —
          // but its ~52 KB Base64 encode + bridge payload are elided (the CPU win).
          val permille = keepPermille[name] ?: DEFAULT_KEEP_PERMILLE
          phaseAccum += permille
          val present = phaseAccum >= 1000
          if (present) phaseAccum -= 1000
          val encoded =
            if (present) Base64.encodeToString(frame, 0, VIC_BYTES_PER_FRAME, Base64.NO_WRAP) else ""
          emitFrame(name, encoded, frameStartNanos / 1_000_000.0, frameHeight, dropped, lost, present)
          curFrameNum = -1
          frameStartNanos = Long.MAX_VALUE
          stats.record(arrivalNanos, 1, dropped, lost)
        } else {
          stats.record(arrivalNanos, 0, dropped, lost)
        }
      } catch (error: Exception) {
        if (socket.isClosed) break
        Log.w(logTag, "Transient receive error on $name assembler; continuing", error)
      }
    }
  }

  /** Peek a datagram's VIC last-line flag without full parsing (little-endian u16 at offset 4). */
  private fun isLastLine(data: ByteArray, offset: Int): Boolean = (u16(data, offset + 4) and LAST_LINE_FLAG) != 0

  private fun u16(data: ByteArray, index: Int): Int =
    (data[index].toInt() and 0xFF) or ((data[index + 1].toInt() and 0xFF) shl 8)

  private fun clampFrameHeight(height: Int): Int =
    if (height < VIC_NTSC_HEIGHT) VIC_NTSC_HEIGHT else if (height > VIC_PAL_HEIGHT) VIC_PAL_HEIGHT else height

  /**
   * Per-second frame-progression measurement (the c64stream network/obs-CSV analysis, delivered
   * through logcat). One `Log.i` a second reports packets/s, frames/s and cumulative drops so a
   * `adb logcat -s StreamUdpPlugin` capture shows the wire rate and whether the pipeline keeps up.
   */
  private inner class RateLog(private val name: String, private val mode: String) {
    private var windowStartNanos = 0L
    private var packets = 0
    private var frames = 0

    fun record(arrivalNanos: Long, framesCompleted: Int, dropped: Int, lost: Int) {
      if (windowStartNanos == 0L) windowStartNanos = arrivalNanos
      packets += 1
      frames += framesCompleted
      val elapsed = arrivalNanos - windowStartNanos
      if (elapsed >= 1_000_000_000L) {
        val secs = elapsed / 1_000_000_000.0
        Log.i(
          logTag,
          "progression name=$name mode=$mode fps=%.1f pkts/s=%.0f dropped=%d lost=%d".format(
            frames / secs,
            packets / secs,
            dropped,
            lost,
          ),
        )
        windowStartNanos = arrivalNanos
        packets = 0
        frames = 0
      }
    }
  }

  private fun closeSocket(name: String) {
    sockets.remove(name)?.let {
      try {
        it.close()
      } catch (error: Exception) {
        Log.d(logTag, "socket close for $name ignored", error)
      }
    }
    if (sockets.isEmpty()) releaseMulticastLock()
  }

  private fun acquireMulticastLock() {
    if (multicastLock?.isHeld == true) return
    try {
      val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
      multicastLock =
        wifi?.createMulticastLock("c64commander-avmirror")?.apply {
          setReferenceCounted(false)
          acquire()
        }
    } catch (error: Exception) {
      Log.w(logTag, "MulticastLock acquire failed", error)
    }
  }

  private fun releaseMulticastLock() {
    try {
      multicastLock?.let { if (it.isHeld) it.release() }
    } catch (error: Exception) {
      Log.d(logTag, "MulticastLock release ignored", error)
    }
    multicastLock = null
  }

  /** The active site-local IPv4 interface (Wi-Fi), used to join multicast on the right NIC. */
  private fun siteLocalInterface(): NetworkInterface? {
    try {
      for (intf in NetworkInterface.getNetworkInterfaces()) {
        if (!intf.isUp || intf.isLoopback || !intf.supportsMulticast()) continue
        for (addr in intf.inetAddresses) {
          if (!addr.isLoopbackAddress && addr is Inet4Address && addr.isSiteLocalAddress) return intf
        }
      }
    } catch (error: Exception) {
      Log.d(logTag, "multicast interface lookup failed", error)
    }
    return null
  }

  private fun siteLocalIpv4(): String? {
    try {
      for (intf in NetworkInterface.getNetworkInterfaces()) {
        if (!intf.isUp || intf.isLoopback) continue
        for (addr in intf.inetAddresses) {
          if (!addr.isLoopbackAddress && addr is Inet4Address && addr.isSiteLocalAddress) {
            return addr.hostAddress
          }
        }
      }
    } catch (error: Exception) {
      Log.d(logTag, "site-local IPv4 lookup failed", error)
    }
    return null
  }

  override fun handleOnDestroy() {
    super.handleOnDestroy()
    sockets.values.forEach {
      try {
        it.close()
      } catch (error: Exception) {
        Log.d(logTag, "socket close on destroy ignored", error)
      }
    }
    sockets.clear()
    releaseMulticastLock()
    executor.shutdownNow()
  }

  companion object {
    // OS socket receive-buffer request (2 MB) — ~0.8 s of video at the 2.6 MB/s wire rate, ample
    // headroom for a scheduling/GC gap. The kernel may clamp it to net.core.rmem_max.
    private const val RECV_BUFFER_BYTES = 2 * 1024 * 1024

    // Default native keep-rate: present every assembled frame.
    private const val DEFAULT_KEEP_PERMILLE = 1000

    // VIC wire-format constants (source of truth: src/lib/streams/vicStream.ts + c64stream).
    private const val VIC_HEADER_BYTES = 12
    private const val VIC_FRAME_WIDTH = 384
    private const val VIC_BYTES_PER_LINE = VIC_FRAME_WIDTH / 2 // 192 (4 bits per pixel)
    private const val VIC_PAL_HEIGHT = 272
    private const val VIC_NTSC_HEIGHT = 240
    private const val VIC_BYTES_PER_FRAME = VIC_FRAME_WIDTH * VIC_PAL_HEIGHT / 2 // 52224
    private const val VIC_LINES_PER_PACKET = 4
    private const val VIC_BITS_PER_PIXEL = 4
    private const val LAST_LINE_FLAG = 0x8000
  }
}
