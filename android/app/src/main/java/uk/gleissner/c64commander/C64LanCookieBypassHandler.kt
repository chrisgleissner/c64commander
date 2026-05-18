/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import java.io.IOException
import java.net.CookieHandler
import java.net.URI
import java.util.Locale

internal class C64LanCookieBypassHandler(
  private val delegate: CookieHandler,
) : CookieHandler() {
  @Throws(IOException::class)
  override fun get(
    uri: URI?,
    requestHeaders: MutableMap<String, MutableList<String>>?,
  ): MutableMap<String, MutableList<String>> {
    if (shouldBypass(uri)) {
      return mutableMapOf()
    }
    return delegate.get(uri, requestHeaders ?: mutableMapOf()) ?: mutableMapOf()
  }

  @Throws(IOException::class)
  override fun put(uri: URI?, responseHeaders: MutableMap<String, MutableList<String>>?) {
    if (shouldBypass(uri)) {
      return
    }
    delegate.put(uri, responseHeaders ?: mutableMapOf())
  }

  internal companion object {
    fun shouldBypass(uri: URI?): Boolean {
      val scheme = uri?.scheme?.lowercase(Locale.ROOT) ?: return false
      if (scheme != "http" && scheme != "https") {
        return false
      }

      val host = uri.host?.lowercase(Locale.ROOT) ?: return false
      if (host == "u64" || host == "c64u" || host.endsWith(".local")) {
        return true
      }

      val octets = host.split(".")
      if (octets.size != 4) {
        return false
      }

      val numbers = octets.map { part -> part.toIntOrNull() ?: return false }
      return when {
        numbers[0] == 10 -> true
        numbers[0] == 172 && numbers[1] in 16..31 -> true
        numbers[0] == 192 && numbers[1] == 168 -> true
        numbers[0] == 169 && numbers[1] == 254 -> true
        else -> false
      }
    }
  }
}
