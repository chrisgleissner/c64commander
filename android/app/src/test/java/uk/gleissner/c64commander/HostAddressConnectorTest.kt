/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import java.net.ConnectException
import java.net.InetAddress
import java.net.SocketTimeoutException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HostAddressConnectorTest {
  private val ethernet = InetAddress.getByAddress(byteArrayOf(192.toByte(), 0, 2, 10))
  private val wifi = InetAddress.getByAddress(byteArrayOf(198.toByte(), 51, 100, 20))
  private val ipv6 =
          InetAddress.getByAddress(
                  ByteArray(16).also {
                    it[0] = 0x20
                    it[1] = 0x01
                    it[2] = 0x0d
                    it[3] = 0xb8.toByte()
                    it[15] = 1
                  },
          )

  @Test
  fun anAddressThatTimesOutUsesOnlyItsShareSoTheNextAddressFitsInTheSameBudget() {
    var clockMs = 10_000L
    val attempts = mutableListOf<Pair<InetAddress, Int>>()

    val (connected, value) =
            HostAddressConnector.connectFirstReachable(
                    listOf(wifi, ethernet),
                    totalTimeoutMs = 1_500,
                    attempt = { address, timeoutMs ->
                      attempts += address to timeoutMs
                      if (address == wifi) {
                        clockMs += timeoutMs
                        throw SocketTimeoutException("connect timed out")
                      }
                      "connected"
                    },
                    onAttemptFailed = {},
                    nowMs = { clockMs },
            )

    assertEquals(ethernet, connected)
    assertEquals("connected", value)
    assertEquals(listOf(wifi to 750, ethernet to 750), attempts)
  }

  @Test
  fun everyAttemptFailingRethrowsTheLastFailureWithTheEarlierOnesSuppressed() {
    val failures = mutableListOf<ConnectAttemptFailure>()
    val first = SocketTimeoutException("first")
    val last = ConnectException("last")

    val thrown =
            runCatching {
                      HostAddressConnector.connectFirstReachable<Unit>(
                              listOf(wifi, ethernet),
                              totalTimeoutMs = 1_000,
                              attempt = { address, _ -> throw if (address == wifi) first else last },
                              onAttemptFailed = { failures += it },
                      )
                    }
                    .exceptionOrNull()

    assertEquals(last, thrown)
    assertEquals(listOf<Throwable>(first), thrown!!.suppressed.toList())
    assertEquals(listOf(wifi, ethernet), failures.map { it.address })
  }

  @Test
  fun anExhaustedBudgetStopsBeforeTheRemainingAddresses() {
    var clockMs = 0L
    val attempted = mutableListOf<InetAddress>()

    val thrown =
            runCatching {
                      HostAddressConnector.connectFirstReachable<Unit>(
                              listOf(wifi, ethernet),
                              totalTimeoutMs = 1_000,
                              attempt = { address, _ ->
                                attempted += address
                                clockMs += 1_000
                                throw SocketTimeoutException("connect timed out")
                              },
                              onAttemptFailed = {},
                              nowMs = { clockMs },
                      )
                    }
                    .exceptionOrNull()

    assertTrue(thrown is SocketTimeoutException)
    assertEquals(listOf(wifi), attempted)
  }

  @Test
  fun resolvedAddressesAreOrderedIpv4FirstWithoutDuplicates() {
    val resolver = HostAddressResolver { listOf(ipv6, wifi, ethernet, wifi) }

    assertEquals(listOf(wifi, ethernet, ipv6), HostAddressConnector.resolveIpv4First(resolver, "ultimate.example"))
  }

  @Test
  fun literalAddressesAreRecognizedAndHostNamesAreNot() {
    assertTrue(HostAddressConnector.isIpLiteral("192.0.2.10"))
    assertTrue(HostAddressConnector.isIpLiteral("2001:db8::1"))
    assertFalse(HostAddressConnector.isIpLiteral("ultimate.example"))
    assertFalse(HostAddressConnector.isIpLiteral("ultimate"))
  }
}
