/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import java.util.Locale

/**
 * HARD27-025: the Kotlin mirror of the private-LAN address rule defined in
 * `web/server/src/hostValidation.ts`. Both are tested against
 * `android/app/src/test/resources/lan-host-classification.json`, so neither can
 * change without the other's test failing. The name rules are not shared - see
 * the comment on that TypeScript module for why.
 */
internal object LanHostClassification {
  val PRODUCT_HOST_NAMES = setOf("c64u", "u64")

  /** Java's `URI.getHost()` keeps the brackets around an IPv6 literal. */
  fun normalize(host: String): String =
    host.trim().lowercase(Locale.ROOT).removeSurrounding("[", "]")

  fun isLoopback(host: String): Boolean {
    val value = normalize(host)
    if (value == "localhost" || value == "::1") return true
    val octets = parseIpv4(value) ?: return false
    return octets[0] == 127
  }

  fun isPrivateLanAddress(host: String): Boolean {
    val value = normalize(host)
    if (value.isEmpty()) return false
    if (value == "localhost") return true
    return isPrivateIpv4(value) || isPrivateIpv6(value)
  }

  private fun parseIpv4(host: String): List<Int>? {
    val parts = host.split(".")
    if (parts.size != 4) return null
    val octets = parts.map { part ->
      if (part.isEmpty() || part.length > 3 || part.any { char -> !char.isDigit() }) return null
      part.toIntOrNull() ?: return null
    }
    return if (octets.all { octet -> octet in 0..255 }) octets else null
  }

  private fun isPrivateIpv4(host: String): Boolean {
    val octets = parseIpv4(host) ?: return false
    return when {
      octets[0] == 10 -> true
      octets[0] == 172 && octets[1] in 16..31 -> true
      octets[0] == 192 && octets[1] == 168 -> true
      octets[0] == 127 -> true
      octets[0] == 169 && octets[1] == 254 -> true
      else -> false
    }
  }

  private fun isPrivateIpv6(host: String): Boolean {
    if (!host.contains(":")) return false
    if (host == "::1") return true
    val firstSegment = host.substringBefore(":")
    if (firstSegment.isEmpty()) return false
    val firstHextet = firstSegment.toIntOrNull(16) ?: return false
    if (firstHextet and 0xffc0 == 0xfe80) return true
    return firstHextet and 0xfe00 == 0xfc00
  }
}
