/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import java.net.Inet4Address
import java.net.InetAddress

internal fun interface HostAddressResolver {
  fun resolveAll(host: String): List<InetAddress>
}

internal val systemHostAddressResolver = HostAddressResolver { host -> InetAddress.getAllByName(host).toList() }

internal class ConnectAttemptFailure(val address: InetAddress, val timeoutMs: Int, val error: Exception)

/**
 * Connects to the first reachable address of a host name within one overall connect budget.
 *
 * An Ultimate on Ethernet and Wi-Fi at once answers at two addresses, and the one a resolver
 * returns first can belong to an interface that is down.
 */
internal object HostAddressConnector {
  private val ipv4Literal = Regex("""^\d{1,3}(\.\d{1,3}){3}$""")

  fun isIpLiteral(host: String): Boolean = ipv4Literal.matches(host) || host.contains(':')

  fun resolveIpv4First(resolver: HostAddressResolver, host: String): List<InetAddress> =
          resolver.resolveAll(host).distinct().sortedBy { if (it is Inet4Address) 0 else 1 }

  /** Splits what is left of the budget evenly over the addresses not yet tried. */
  fun attemptTimeoutMs(remainingMs: Long, remainingAddresses: Int): Int =
          (remainingMs / remainingAddresses.coerceAtLeast(1)).coerceIn(1L, Int.MAX_VALUE.toLong()).toInt()

  fun <T> connectFirstReachable(
          addresses: List<InetAddress>,
          totalTimeoutMs: Int,
          attempt: (address: InetAddress, timeoutMs: Int) -> T,
          onAttemptFailed: (ConnectAttemptFailure) -> Unit,
          nowMs: () -> Long = { System.nanoTime() / 1_000_000L },
  ): Pair<InetAddress, T> {
    require(addresses.isNotEmpty()) { "No addresses to connect to" }
    val deadlineMs = nowMs() + totalTimeoutMs
    val failures = mutableListOf<Exception>()
    for ((index, address) in addresses.withIndex()) {
      val remainingMs = deadlineMs - nowMs()
      if (remainingMs <= 0 && failures.isNotEmpty()) break
      val timeoutMs = attemptTimeoutMs(remainingMs, addresses.size - index)
      try {
        return address to attempt(address, timeoutMs)
      } catch (error: Exception) {
        failures += error
        onAttemptFailed(ConnectAttemptFailure(address, timeoutMs, error))
      }
    }
    val lastFailure = failures.last()
    failures.dropLast(1).forEach { lastFailure.addSuppressed(it) }
    throw lastFailure
  }
}
