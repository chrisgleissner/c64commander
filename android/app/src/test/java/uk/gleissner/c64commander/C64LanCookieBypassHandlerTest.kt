/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.CookieHandler
import java.net.URI

class C64LanCookieBypassHandlerTest {
  @Test
  fun bypassesKnownC64HostsAndPrivateLanAddresses() {
    assertTrue(C64LanCookieBypassHandler.shouldBypass(URI("http://u64/v1/info")))
    assertTrue(C64LanCookieBypassHandler.shouldBypass(URI("http://c64u/v1/info")))
    assertTrue(C64LanCookieBypassHandler.shouldBypass(URI("http://ultimate64.local/v1/info")))
    assertTrue(C64LanCookieBypassHandler.shouldBypass(URI("http://192.168.1.13/v1/info")))
    assertTrue(C64LanCookieBypassHandler.shouldBypass(URI("http://10.0.0.9/v1/info")))
    assertTrue(C64LanCookieBypassHandler.shouldBypass(URI("http://172.16.4.20/v1/info")))
    assertFalse(C64LanCookieBypassHandler.shouldBypass(URI("https://example.com")))
    assertFalse(C64LanCookieBypassHandler.shouldBypass(URI("http://localhost:5173")))
  }

  @Test
  fun skipsDelegationForBypassedHosts() {
    val delegate = RecordingCookieHandler()
    val handler = C64LanCookieBypassHandler(delegate)

    val result = handler.get(URI("http://192.168.1.13/v1/info"), mutableMapOf("Cookie" to mutableListOf("a=b")))

    assertTrue(result.isEmpty())
    assertEquals(0, delegate.getCalls)
  }

  @Test
  fun delegatesNonLanHosts() {
    val delegate = RecordingCookieHandler()
    val handler = C64LanCookieBypassHandler(delegate)

    val result = handler.get(URI("https://example.com/data"), mutableMapOf())
    handler.put(URI("https://example.com/data"), mutableMapOf("Set-Cookie" to mutableListOf("demo=true")))

    assertEquals(1, delegate.getCalls)
    assertEquals(1, delegate.putCalls)
    assertEquals(listOf("delegate=true"), result["Cookie"])
  }

  private class RecordingCookieHandler : CookieHandler() {
    var getCalls = 0
    var putCalls = 0

    override fun get(
      uri: URI?,
      requestHeaders: MutableMap<String, MutableList<String>>?,
    ): MutableMap<String, MutableList<String>> {
      getCalls += 1
      return mutableMapOf("Cookie" to mutableListOf("delegate=true"))
    }

    override fun put(uri: URI?, responseHeaders: MutableMap<String, MutableList<String>>?) {
      putCalls += 1
    }
  }
}
