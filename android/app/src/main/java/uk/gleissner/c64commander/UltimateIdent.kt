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
import java.net.InetAddress
import java.net.SocketTimeoutException
import org.json.JSONException
import org.json.JSONObject

/**
 * The Ultimate's ident service (UDP 64): a `json` request is answered with the device's product,
 * hostname and unique id, without the network password.
 *
 * The reply leaves from the device's default interface, which on an Ultimate connected by Ethernet
 * and Wi-Fi is usually not the address the request went to, so the socket must stay unconnected.
 */
object UltimateIdent {
  const val PORT = 64
  private const val MAX_REPLY_BYTES = 2048

  data class Identity(val uniqueId: String, val replyFrom: String)

  fun query(host: String, timeoutMs: Int, port: Int = PORT): Identity? {
    val target = InetAddress.getByName(host)
    DatagramSocket().use { socket ->
      socket.soTimeout = timeoutMs
      val request = "json".toByteArray(Charsets.US_ASCII)
      socket.send(DatagramPacket(request, request.size, target, port))
      val buffer = ByteArray(MAX_REPLY_BYTES)
      val reply = DatagramPacket(buffer, buffer.size)
      try {
        socket.receive(reply)
      } catch (_: SocketTimeoutException) {
        return null
      }
      val uniqueId = parseUniqueId(String(reply.data, 0, reply.length, Charsets.UTF_8)) ?: return null
      return Identity(uniqueId, reply.address.hostAddress ?: "")
    }
  }

  fun parseUniqueId(reply: String): String? =
    try {
      JSONObject(reply).optString("unique_id").trim().ifEmpty { null }
    } catch (error: JSONException) {
      throw IllegalArgumentException("Ident reply is not JSON: ${reply.take(80)}", error)
    }
}
