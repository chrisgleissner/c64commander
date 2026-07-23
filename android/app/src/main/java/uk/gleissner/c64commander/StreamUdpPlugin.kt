/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

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
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Native UDP receiver for the A/V mirror (Content Explorer). The C64 Ultimate streams raw
 * VIC video / audio as UDP datagrams; a WebView cannot open a UDP socket, so this plugin
 * binds the two ports natively and forwards each datagram to the JS layer as a base64
 * `datagram` event ({ name, data }). It is the native counterpart of the web server's
 * UDP -> WebSocket bridge. `bind` returns the phone's site-local IPv4 so the app can tell
 * the device where to stream.
 */
@CapacitorPlugin(name = "StreamUdp")
class StreamUdpPlugin : Plugin() {
  private val sockets = ConcurrentHashMap<String, DatagramSocket>()
  private val executor = Executors.newCachedThreadPool()
  private val logTag = "StreamUdpPlugin"

  /** Test seam: how a received datagram is delivered to JS (default: a `datagram` event). */
  internal var emitDatagram: (String, String) -> Unit = { name, data ->
    val event = JSObject()
    event.put("name", name)
    event.put("data", data)
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
    try {
      closeSocket(name)
      val socket = DatagramSocket(null).apply {
        reuseAddress = true
        bind(InetSocketAddress(port))
      }
      sockets[name] = socket
      executor.execute { receiveLoop(name, socket) }
      val result = JSObject()
      result.put("localIp", siteLocalIpv4() ?: "")
      result.put("port", socket.localPort)
      call.resolve(result)
    } catch (error: Exception) {
      Log.w(logTag, "bind failed for $name:$port", error)
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
        val encoded = Base64.encodeToString(packet.data, packet.offset, packet.length, Base64.NO_WRAP)
        emitDatagram(name, encoded)
      } catch (error: Exception) {
        if (socket.isClosed) break
        // Transient receive error; keep listening.
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
    executor.shutdownNow()
  }
}
