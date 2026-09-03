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

      val host = LanHostClassification.normalize(uri.host ?: return false)
      // No resolver is available inside a CookieHandler, so the two product
      // hostnames and mDNS names are matched by name here. The web server
      // resolves them instead; see hostValidation.ts.
      if (host in LanHostClassification.PRODUCT_HOST_NAMES || host.endsWith(".local")) {
        return true
      }
      // The loopback is a private-LAN address, but on Android it is this app's
      // own origin - the dev server, the Capacitor bridge - and never an
      // Ultimate, so its cookies are delegated rather than dropped.
      return LanHostClassification.isPrivateLanAddress(host) && !LanHostClassification.isLoopback(host)
    }
  }
}
