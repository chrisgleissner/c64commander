/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface
import java.net.SocketAddress
import java.util.Collections
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MulticastMembershipRefresherTest {
  private class RecordingSocket(var failJoin: Boolean = false) : MulticastSocket(null as SocketAddress?) {
    val calls: MutableList<String> = Collections.synchronizedList(mutableListOf())

    override fun leaveGroup(mcastaddr: SocketAddress, netIf: NetworkInterface?) {
      calls.add("leave")
    }

    override fun joinGroup(mcastaddr: SocketAddress, netIf: NetworkInterface?) {
      calls.add("join")
      if (failJoin) throw java.io.IOException("no route")
    }
  }

  private val group = InetSocketAddress(InetAddress.getByName("239.0.1.64"), 11000)

  private fun waitFor(condition: () -> Boolean): Boolean {
    val deadline = System.nanoTime() + 5_000_000_000L
    while (System.nanoTime() < deadline) {
      if (condition()) return true
      Thread.sleep(10)
    }
    return false
  }

  @Test
  fun refreshLeavesThenJoinsAgainSoTheRouterSeesANewReport() {
    val refresher = MulticastMembershipRefresher()
    val socket = RecordingSocket()
    refresher.start("video", socket, "239.0.1.64", 11000, null)

    refresher.refresh("video", socket, group, null)

    assertEquals(listOf("leave", "join"), socket.calls)
    assertEquals(1L, refresher.refreshCount("video"))
  }

  @Test
  fun refreshesRepeatAtTheInterval() {
    val refresher = MulticastMembershipRefresher(intervalMs = 20)
    val socket = RecordingSocket()
    refresher.start("video", socket, "239.0.1.64", 11000, null)

    assertTrue("expected repeated refreshes", waitFor { refresher.refreshCount("video") >= 3 })
    refresher.stop("video")
  }

  @Test
  fun aFailedJoinIsNotCountedAsARefresh() {
    val refresher = MulticastMembershipRefresher()
    val socket = RecordingSocket(failJoin = true)
    refresher.start("video", socket, "239.0.1.64", 11000, null)

    refresher.refresh("video", socket, group, null)

    assertEquals(0L, refresher.refreshCount("video"))
  }

  @Test
  fun aClosedSocketIsNotRefreshedAndStopsBeingTracked() {
    val refresher = MulticastMembershipRefresher()
    val socket = RecordingSocket()
    refresher.start("video", socket, "239.0.1.64", 11000, null)
    socket.close()

    refresher.refresh("video", socket, group, null)

    assertTrue(socket.calls.isEmpty())
    assertEquals(0L, refresher.refreshCount("video"))
  }

  @Test
  fun aPlainUnicastSocketIsLeftAlone() {
    val refresher = MulticastMembershipRefresher(intervalMs = 10)
    val socket = DatagramSocket(null)
    refresher.start("audio", socket, null, 11001, null)

    Thread.sleep(80)

    assertEquals(0L, refresher.refreshCount("audio"))
    socket.close()
  }
}
