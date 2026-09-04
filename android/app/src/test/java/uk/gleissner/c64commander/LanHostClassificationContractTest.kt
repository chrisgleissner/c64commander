/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URI

/**
 * HARD27-025: the private-LAN address rule is defined once, in
 * `web/server/src/hostValidation.ts`, and mirrored here. Both sides are tested
 * against the same fixture, so a change to one that is not made in the other
 * fails a test rather than silently diverging. Name matching is platform
 * policy and is covered by C64LanCookieBypassHandlerTest instead.
 *
 * The one deliberate difference on the shared rule: on Android the loopback is
 * the app's own origin (the dev server, the Capacitor bridge), never an
 * Ultimate, so its cookies must be delegated rather than bypassed.
 */
class LanHostClassificationContractTest {
  private data class HostCase(
    val host: String,
    val privateLan: Boolean,
    val loopback: Boolean,
    val note: String,
  )

  private fun loadCases(): List<HostCase> {
    val text = checkNotNull(
      javaClass.getResourceAsStream("/lan-host-classification.json"),
    ) { "lan-host-classification.json is missing from the test resources" }
      .bufferedReader()
      .use { reader -> reader.readText() }

    val array = JSONObject(text).getJSONArray("cases")
    return (0 until array.length()).map { index ->
      val entry = array.getJSONObject(index)
      HostCase(
        host = entry.getString("host"),
        privateLan = entry.getBoolean("privateLan"),
        loopback = entry.getBoolean("loopback"),
        note = entry.getString("note"),
      )
    }
  }

  private fun uriFor(host: String): URI {
    val authority = if (host.contains(":")) "[$host]" else host
    return URI("http://$authority/v1/info")
  }

  @Test
  fun fixtureCoversBothAnswersAndTheLoopbackException() {
    val cases = loadCases()
    assertTrue(cases.any { case -> case.privateLan })
    assertTrue(cases.any { case -> !case.privateLan })
    assertTrue(cases.any { case -> case.loopback })
  }

  @Test
  fun classifiesEveryFixtureAddressLikeTheWebServerDoes() {
    for (case in loadCases()) {
      assertEquals(
        "${case.host} (${case.note})",
        case.privateLan,
        LanHostClassification.isPrivateLanAddress(case.host),
      )
      assertEquals(
        "${case.host} (${case.note})",
        case.loopback,
        LanHostClassification.isLoopback(case.host),
      )
    }
  }

  @Test
  fun bypassFollowsTheSharedRuleExceptForTheLoopback() {
    for (case in loadCases()) {
      val expected = case.privateLan && !case.loopback
      assertEquals(
        "${case.host} (${case.note})",
        expected,
        C64LanCookieBypassHandler.shouldBypass(uriFor(case.host)),
      )
    }
  }
}
