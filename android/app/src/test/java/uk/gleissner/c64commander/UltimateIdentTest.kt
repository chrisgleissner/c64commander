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
import java.net.InetSocketAddress
import kotlin.concurrent.thread
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class UltimateIdentTest {
  private val reply = """{ "product" : "Ultimate 64 Elite", "hostname" : "u64", "unique_id" : "38C1BA" }"""

  /** Answers one `json` request from [replyAddress], the way a device replies from its other interface. */
  private fun fakeDevice(requestAddress: String, replyAddress: String): Int {
    val listener = DatagramSocket(InetSocketAddress(InetAddress.getByName(requestAddress), 0))
    val replier = DatagramSocket(InetSocketAddress(InetAddress.getByName(replyAddress), 0))
    thread(isDaemon = true) {
      listener.use { socket ->
        replier.use { out ->
          val packet = DatagramPacket(ByteArray(64), 64)
          socket.receive(packet)
          val body = reply.toByteArray()
          out.send(DatagramPacket(body, body.size, packet.socketAddress))
        }
      }
    }
    return listener.localPort
  }

  @Test
  fun readsTheUniqueIdWhenTheReplyComesFromAnotherAddressThanTheRequestWentTo() {
    val port = fakeDevice(requestAddress = "127.0.0.1", replyAddress = "127.0.0.2")

    val identity = UltimateIdent.query("127.0.0.1", timeoutMs = 2000, port = port)

    assertEquals("38C1BA", identity?.uniqueId)
    assertEquals("127.0.0.2", identity?.replyFrom)
  }

  @Test
  fun returnsNullWhenNothingAnswers() {
    val silent = DatagramSocket(InetSocketAddress(InetAddress.getLoopbackAddress(), 0))
    silent.use { assertNull(UltimateIdent.query("127.0.0.1", timeoutMs = 200, port = it.localPort)) }
  }

  @Test
  fun treatsAMissingOrBlankUniqueIdAsUnknown() {
    assertNull(UltimateIdent.parseUniqueId("""{ "product" : "Ultimate II+L" }"""))
    assertNull(UltimateIdent.parseUniqueId("""{ "unique_id" : "  " }"""))
  }

  @Test
  fun rejectsTheLegacyCommaSeparatedReplyWithItsContent() {
    val error = assertThrows(IllegalArgumentException::class.java) {
      UltimateIdent.parseUniqueId("ident,u64,*** Ultimate 64 Elite ***")
    }
    assertEquals(true, error.message?.contains("ident,u64"))
  }
}
