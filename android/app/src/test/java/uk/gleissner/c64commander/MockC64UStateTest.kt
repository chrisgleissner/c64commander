/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class MockC64UStateTest {
  @Test
  fun fromPayloadAcceptsValidJson() {
    val payload = JSONObject()
    payload.put("general", JSONObject().apply {
      put("restApiVersion", "0.1")
      put("baseUrl", "http://localhost")
    })

    val state = MockC64UState.fromPayload(payload)
    assertNotNull("State should not be null", state)
  }

  @Test
  fun fromPayloadAcceptsEmptyJson() {
    val payload = JSONObject()

    val state = MockC64UState.fromPayload(payload)
    assertNotNull("State should not be null even with empty payload", state)
  }

  @Test
  fun updateConfigValueCreatesAndUpdatesItems() {
    val payload = JSONObject()
    payload.put("general", JSONObject().apply { put("baseUrl", "http://localhost") })
    payload.put("categories", JSONObject().apply {
      put("Audio Mixer", JSONObject().apply {
        put("Vol Socket 1", JSONObject().apply { put("value", "-6 dB") })
      })
    })

    val state = MockC64UState.fromPayload(payload)
    state.updateConfigValue("Audio Mixer", "Vol Socket 1", "+2 dB")
    assertEquals(
      "+2 dB",
      state.getCategory("Audio Mixer")?.get("Vol Socket 1")?.value
    )

    state.updateConfigValue("Audio Mixer", "New Item", "On")
    assertEquals(
      "On",
      state.getCategory("Audio Mixer")?.get("New Item")?.value
    )
  }

  @Test
  fun updateConfigBatchAppliesMultipleValues() {
    val payload = JSONObject()
    payload.put("general", JSONObject().apply { put("baseUrl", "http://localhost") })
    payload.put("categories", JSONObject().apply {
      put("Audio Mixer", JSONObject().apply {
        put("Vol Socket 1", JSONObject().apply { put("value", "-6 dB") })
        put("Vol Socket 2", JSONObject().apply { put("value", "+1 dB") })
      })
    })

    val state = MockC64UState.fromPayload(payload)
    val batch = JSONObject().apply {
      put("Audio Mixer", JSONObject().apply {
        put("Vol Socket 1", "OFF")
        put("Vol Socket 2", "-2 dB")
      })
    }
    state.updateConfigBatch(batch)

    assertEquals("OFF", state.getCategory("Audio Mixer")?.get("Vol Socket 1")?.value)
    assertEquals("-2 dB", state.getCategory("Audio Mixer")?.get("Vol Socket 2")?.value)
  }

  @Test
  fun resetConfigRestoresDefaults() {
    val payload = JSONObject()
    payload.put("general", JSONObject().apply { put("baseUrl", "http://localhost") })
    payload.put("categories", JSONObject().apply {
      put("Audio Mixer", JSONObject().apply {
        put("Vol Socket 1", JSONObject().apply { put("value", "-6 dB") })
      })
    })

    val state = MockC64UState.fromPayload(payload)
    state.updateConfigValue("Audio Mixer", "Vol Socket 1", "OFF")
    state.resetConfig()

    assertEquals(
      "-6 dB",
      state.getCategory("Audio Mixer")?.get("Vol Socket 1")?.value
    )
  }

  @Test
  fun driveStateReflectsDriveSettings() {
    val payload = JSONObject()
    payload.put("general", JSONObject().apply { put("baseUrl", "http://localhost") })
    payload.put("categories", JSONObject().apply {
      put("Drive A Settings", JSONObject().apply {
        put("Drive", JSONObject().apply { put("value", "Enabled") })
        put("Drive Bus ID", JSONObject().apply { put("value", 8) })
        put("Drive Type", JSONObject().apply { put("value", "1571") })
        put("ROM for 1571 mode", JSONObject().apply { put("value", "rom1571") })
      })
      put("Drive B Settings", JSONObject().apply {
        put("Drive", JSONObject().apply { put("value", "Disabled") })
        put("Drive Bus ID", JSONObject().apply { put("value", 9) })
        put("Drive Type", JSONObject().apply { put("value", "1541") })
      })
    })

    val state = MockC64UState.fromPayload(payload)
    val driveA = state.drives["a"]
    val driveB = state.drives["b"]

    assertNotNull(driveA)
    assertNotNull(driveB)
    assertEquals(true, driveA?.enabled)
    assertEquals(8, driveA?.busId)
    assertEquals("1571", driveA?.type)
    assertEquals("rom1571", driveA?.rom)
    assertEquals(false, driveB?.enabled)
    assertEquals(9, driveB?.busId)
    assertEquals("1541", driveB?.type)
  }

  @Test
  fun listCategoriesReturnsSortedNames() {
    val payload = JSONObject()
    payload.put("general", JSONObject().apply { put("baseUrl", "http://localhost") })
    payload.put("categories", JSONObject().apply {
      put("Zeta", JSONObject())
      put("Alpha", JSONObject())
    })

    val state = MockC64UState.fromPayload(payload)
    assertEquals(listOf("Alpha", "Zeta"), state.listCategories())
  }

  @Test
  fun getNetworkPasswordReturnsConfiguredValue() {
    val payload = JSONObject()
    payload.put("general", JSONObject().apply { put("baseUrl", "http://localhost") })
    payload.put("categories", JSONObject().apply {
      put("Network Settings", JSONObject().apply {
        put("Network Password", JSONObject().apply { put("value", "secret") })
      })
    })

    val state = MockC64UState.fromPayload(payload)
    assertEquals("secret", state.getNetworkPassword())
  }
}
