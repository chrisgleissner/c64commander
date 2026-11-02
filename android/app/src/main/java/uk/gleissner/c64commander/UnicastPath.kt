/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress

internal data class UnicastPreparation(val address: String?, val reachable: Boolean)

/**
 * Getting this phone into a state where the Ultimate can send a stream straight to it.
 *
 * The Ultimate sends to a single host only after it has found that host's hardware address on its
 * wired port: it sends one probe and looks in its ARP table for about 200 ms. A phone whose Wi-Fi
 * radio is dozing answers too late, and the request fails with "Network Host Resolve Error". A phone
 * the Ultimate has just heard an ICMP echo from is already in the table, so the radio is held in
 * low-latency mode and a few echoes are sent before the stream is requested.
 */
internal object UnicastPath {
  private const val PROBE_PORT = 9
  private const val ECHO_ATTEMPTS = 3
  private const val ECHO_TIMEOUT_MS = 400

  /**
   * The address this phone uses to reach `host` (read from a connected UDP socket that sends
   * nothing), and whether `host` answered an echo. `host` may carry a `:port` suffix, which is ignored.
   */
  fun prepare(host: String, holdRadioAwake: () -> Unit): UnicastPreparation {
    val target = InetAddress.getByName(host.substringBefore(":"))
    val address =
        DatagramSocket().use { probe ->
          probe.connect(target, PROBE_PORT)
          (probe.localAddress as? Inet4Address)?.hostAddress
        }
    holdRadioAwake()
    val reachable = (1..ECHO_ATTEMPTS).any { target.isReachable(ECHO_TIMEOUT_MS) }
    return UnicastPreparation(address, reachable)
  }
}
