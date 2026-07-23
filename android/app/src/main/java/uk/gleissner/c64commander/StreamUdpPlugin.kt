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
 * binds the two ports natively and forwards each datagram to the JS layer as a base64
 * `datagram` event ({ name, data }). It is the native counterpart of the web server's
 * UDP -> WebSocket bridge.
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
      sockets[name] = socket
      executor.execute { receiveLoop(name, socket) }
      val result = JSObject()
      result.put("localIp", siteLocalIpv4() ?: "")
      result.put("port", socket.localPort)
      call.resolve(result)
    } catch (error: Exception) {
      // Release the multicast lock if we acquired it above but never got a running socket, so a
      // failed multicast bind cannot leak the Wi-Fi MulticastLock (it is not reference-counted).
      if (sockets.isEmpty()) releaseMulticastLock()
      Log.w(logTag, "bind failed for $name:$port (group=$group)", error)
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
    // VIC packets are ~780 bytes and audio ~770; 2048 leaves ample headroom.
    val buffer = ByteArray(2048)
    while (!socket.isClosed) {
      try {
        val packet = DatagramPacket(buffer, buffer.size)
        socket.receive(packet)
        // Stamp wire-arrival time immediately, before any encoding/bridge latency (see emitDatagram).
        val arrivalMs = clockNanos() / 1_000_000.0
        val encoded = Base64.encodeToString(packet.data, packet.offset, packet.length, Base64.NO_WRAP)
        emitDatagram(name, encoded, arrivalMs)
      } catch (error: Exception) {
        if (socket.isClosed) break
        // Transient receive error on a still-open socket: log with the stack trace (mandatory
        // exception handling) and keep listening rather than tearing the stream down.
        Log.w(logTag, "Transient receive error on $name socket; continuing", error)
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
}
