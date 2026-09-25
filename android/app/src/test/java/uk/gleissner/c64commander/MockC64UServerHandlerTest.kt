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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.nio.charset.StandardCharsets

class MockC64UServerHandlerTest {
  private fun handle(server: MockC64UServer, request: HttpRequest): HttpResponse {
    val method = MockC64UServer::class.java.getDeclaredMethod("handleRequest", HttpRequest::class.java)
    method.isAccessible = true
    return method.invoke(server, request) as HttpResponse
  }

  private fun readRequest(server: MockC64UServer, raw: String): HttpRequest? {
    val method = MockC64UServer::class.java.getDeclaredMethod("readRequest", java.io.InputStream::class.java)
    method.isAccessible = true
    return method.invoke(server, ByteArrayInputStream(raw.toByteArray(StandardCharsets.UTF_8))) as HttpRequest?
  }

  private fun request(
    method: String,
    path: String,
    query: Map<String, String> = emptyMap(),
    body: ByteArray = ByteArray(0),
  ): HttpRequest = HttpRequest(method, path, query, emptyMap(), body)

  @Test
  fun handlesOptionsAndInfoEndpoints() {
    val state = MockC64UState.fromPayload(JSONObject())
    val server = MockC64UServer(state)

    val options = handle(server, request("OPTIONS", "/v1/info"))
    assertEquals(204, options.status)

    val info = handle(server, request("GET", "/v1/info"))
    val payload = JSONObject(String(info.body, StandardCharsets.UTF_8))
    assertEquals(200, info.status)
    assertEquals(state.general.deviceType, payload.getString("product"))
    assertTrue(payload.getJSONArray("errors").length() == 0)
  }

  @Test
  fun handlesConfigAndDebugRequests() {
    val config = JSONObject().apply {
      put("categories", JSONObject().apply {
        put("Audio Mixer", JSONObject().apply {
          put("Vol Socket 1", JSONObject().apply { put("value", "-6 dB") })
        })
        put("Audio Output", JSONObject().apply {
          put("Line Out", JSONObject().apply { put("value", "ON") })
        })
      })
    }
    val state = MockC64UState.fromPayload(config)
    val server = MockC64UServer(state)

    val configs = handle(server, request("GET", "/v1/configs"))
    val configsPayload = JSONObject(String(configs.body, StandardCharsets.UTF_8))
    assertTrue(configsPayload.getJSONArray("categories").length() >= 2)

    val wildcard = handle(server, request("GET", "/v1/configs/Audio*"))
    val wildcardPayload = JSONObject(String(wildcard.body, StandardCharsets.UTF_8))
    if (wildcard.status == 200) {
      var hasAudioCategory = false
      val keys = wildcardPayload.keys()
      while (keys.hasNext()) {
        val key = keys.next()
        if (key.startsWith("Audio")) {
          hasAudioCategory = true
          break
        }
      }
      assertTrue(hasAudioCategory)
    } else {
      assertEquals(404, wildcard.status)
      assertTrue(wildcardPayload.getJSONArray("errors").length() > 0)
    }

    val update = handle(
      server,
      request("PUT", "/v1/configs/Audio%20Mixer/Vol%20Socket%201", mapOf("value" to "OFF")),
    )
    assertEquals(200, update.status)
    val updatedItem = handle(server, request("GET", "/v1/configs/Audio%20Mixer/Vol%20Socket%201"))
    val updatedPayload = JSONObject(String(updatedItem.body, StandardCharsets.UTF_8))
    val items = updatedPayload.getJSONObject("Audio Mixer").getJSONObject("items")
    assertEquals("OFF", items.getJSONObject("Vol Socket 1").getString("selected"))

    val debugSet = handle(server, request("PUT", "/v1/machine:debugreg", mapOf("value" to "ff")))
    assertEquals(200, debugSet.status)
    val debugGet = handle(server, request("GET", "/v1/machine:debugreg"))
    val debugPayload = JSONObject(String(debugGet.body, StandardCharsets.UTF_8))
    assertEquals("ff", debugPayload.getString("value"))
  }

  @Test
  fun handlesDriveAndFileEndpoints() {
    val config = JSONObject().apply {
      put("categories", JSONObject().apply {
        put("Drive A Settings", JSONObject().apply {
          put("ROM for 1541 mode", JSONObject().apply { put("value", "1541.rom") })
          put("ROM for 1571 mode", JSONObject().apply { put("value", "1571.rom") })
        })
      })
    }
    val state = MockC64UState.fromPayload(config)
    val server = MockC64UServer(state)

    val mount = handle(server, request("PUT", "/v1/drives/a:mount", mapOf("image" to "/disks/demo.d64")))
    assertEquals(200, mount.status)
    assertEquals("demo.d64", state.drives["a"]?.imageFile)

    val remove = handle(server, request("PUT", "/v1/drives/a:remove"))
    assertEquals(200, remove.status)
    assertNull(state.drives["a"]?.imageFile)

    val on = handle(server, request("PUT", "/v1/drives/a:on"))
    assertEquals(200, on.status)
    assertTrue(state.drives["a"]?.enabled == true)

    val mode = handle(server, request("PUT", "/v1/drives/a:set_mode", mapOf("mode" to "1571")))
    assertEquals(200, mode.status)
    assertEquals("1571", state.drives["a"]?.type)
    assertEquals("1571.rom", state.drives["a"]?.rom)

    val fileInfo = handle(server, request("GET", "/v1/files/demo.sid:info"))
    val infoPayload = JSONObject(String(fileInfo.body, StandardCharsets.UTF_8))
    val fileObj = infoPayload.getJSONObject("files")
    assertEquals("SID", fileObj.getString("extension"))

    val createFail = handle(server, request("PUT", "/v1/files/demo.dnp:create_dnp"))
    assertEquals(400, createFail.status)
    val createOk = handle(server, request("PUT", "/v1/files/demo.dnp:create_dnp", mapOf("tracks" to "80")))
    assertEquals(200, createOk.status)
  }

  @Test
  fun listsSoftIecAndPrinterUnderTheirFirmwareNamesAndResetsThemByEndpointKey() {
    val config = JSONObject().apply {
      put("categories", JSONObject().apply {
        put("Printer Settings", JSONObject().apply {
          put("IEC printer", JSONObject().apply { put("value", "Enabled") })
          put("Bus ID", JSONObject().apply { put("value", 5) })
        })
      })
    }
    val server = MockC64UServer(MockC64UState.fromPayload(config))

    val drives = JSONObject(String(handle(server, request("GET", "/v1/drives")).body, StandardCharsets.UTF_8))
      .getJSONArray("drives")
    val names = (0 until drives.length()).map { drives.getJSONObject(it).keys().next() }
    assertEquals(listOf("a", "b", "IEC Drive", "Printer Emulation"), names)
    val printer = drives.getJSONObject(3).getJSONObject("Printer Emulation")
    assertEquals(5, printer.getInt("bus_id"))
    assertTrue(printer.getBoolean("enabled"))
    assertTrue(!printer.has("type"))

    assertEquals(200, handle(server, request("PUT", "/v1/drives/printer:reset")).status)
    assertEquals(200, handle(server, request("PUT", "/v1/drives/softiec:reset")).status)
  }

  @Test
  fun jiffyClockAdvancesOnlyWhileRunningAndRasterAlwaysMoves() {
    val state = MockC64UState.fromPayload(JSONObject())
    var now = 0L
    state.nanoClock = { now }
    state.restartMachine()
    val server = MockC64UServer(state)
    val read = { address: String ->
      JSONObject(String(handle(server, request("GET", "/v1/machine:readmem", mapOf("address" to address, "length" to "3"))).body, StandardCharsets.UTF_8))
        .getJSONArray("data").let { data -> (0 until data.length()).map { data.getInt(it) } }
    }

    now = 1_000_000_000L
    assertEquals(listOf(0, 0, 60), read("00A0"))
    handle(server, request("PUT", "/v1/machine:pause"))
    val rasterBefore = read("D012")[0]
    now += 1_000_000L
    assertEquals(listOf(0, 0, 60), read("00A0"))
    assertTrue(read("D012")[0] != rasterBefore)
    handle(server, request("PUT", "/v1/machine:resume"))
    now += 500_000_000L
    assertEquals(90, read("00A0")[2])
  }

  @Test
  fun keyboardBufferDrainsWhileRunningSoADiskAutostartCanProceed() {
    val state = MockC64UState.fromPayload(JSONObject())
    var now = 0L
    state.nanoClock = { now }
    state.restartMachine()
    val server = MockC64UServer(state)
    val readCount = {
      JSONObject(String(handle(server, request("GET", "/v1/machine:readmem", mapOf("address" to "00C6", "length" to "1"))).body, StandardCharsets.UTF_8))
        .getJSONArray("data").getInt(0)
    }

    handle(server, request("PUT", "/v1/machine:writemem", mapOf("address" to "00C6", "data" to "0A")))
    assertEquals(10, readCount())
    now += 50_000_000L
    assertEquals(0, readCount())
  }

  @Test
  fun keyboardBufferStaysFullWhileTheMachineIsPaused() {
    val state = MockC64UState.fromPayload(JSONObject())
    var now = 0L
    state.nanoClock = { now }
    state.restartMachine()
    val server = MockC64UServer(state)
    handle(server, request("PUT", "/v1/machine:pause"))

    handle(server, request("PUT", "/v1/machine:writemem", mapOf("address" to "00C6", "data" to "0A")))
    now += 1_000_000_000L

    val count = JSONObject(String(handle(server, request("GET", "/v1/machine:readmem", mapOf("address" to "00C6", "length" to "1"))).body, StandardCharsets.UTF_8))
      .getJSONArray("data").getInt(0)
    assertEquals(10, count)
  }

  @Test
  fun resumeEntersAnArmedCaptureHandlerHookedOnTheKernalIrqVector() {
    val state = MockC64UState.fromPayload(JSONObject())
    val server = MockC64UServer(state)
    val handler = 0x033C
    val armed = 0x0380
    state.memory[handler] = 0xAD
    state.memory[handler + 1] = armed and 0xFF
    state.memory[handler + 2] = armed shr 8
    state.memory[armed] = 1
    state.memory[armed + 1] = 0
    state.memory[0x0314] = handler and 0xFF
    state.memory[0x0315] = handler shr 8

    handle(server, request("PUT", "/v1/machine:pause"))
    assertEquals(0, state.memory[armed + 1])
    handle(server, request("PUT", "/v1/machine:resume"))

    assertEquals(1, state.memory[armed + 1])
    assertEquals(0, state.memory[armed])
    val scratch = (armed - 7 until armed).map { state.memory[it] }
    assertEquals(listOf(0xCD, 0xE5, 0x00, 0x00, 0x0A, 0xF6, 0x22), scratch)
  }

  @Test
  fun theAppsCpuRestoreCartridgeReportsReadyAndAnyOtherCartridgeDoesNot() {
    val state = MockC64UState.fromPayload(JSONObject())
    val server = MockC64UServer(state)

    handle(server, request("POST", "/v1/runners:run_crt", body = "C64 CARTRIDGE   GAME CART".toByteArray()))
    assertNull(state.memory[0x02])

    handle(server, request("POST", "/v1/runners:run_crt", body = "C64 CARTRIDGE   C64C CPU RESTORE".toByteArray()))
    assertEquals(0xA5, state.memory[0x02])
  }

  @Test
  fun resumeLeavesTheMachineAloneWhenNoCaptureHandlerIsArmed() {
    val state = MockC64UState.fromPayload(JSONObject())
    val server = MockC64UServer(state)
    state.memory[0x0314] = 0x31
    state.memory[0x0315] = 0xEA
    state.memory[0xEA31] = 0xAD
    state.memory[0xEA32] = 0x80
    state.memory[0xEA33] = 0x03

    handle(server, request("PUT", "/v1/machine:resume"))

    assertNull(state.memory[0x0381])
  }

  @Test
  fun handlesStreamsAndRunners() {
    val server = MockC64UServer(MockC64UState.fromPayload(JSONObject()))

    val streamFail = handle(server, request("PUT", "/v1/streams/sid:start"))
    assertEquals(400, streamFail.status)

    val streamOk = handle(server, request("PUT", "/v1/streams/sid:start", mapOf("ip" to "127.0.0.1")))
    assertEquals(200, streamOk.status)

    val runnerFail = handle(server, request("PUT", "/v1/runners:sidplay"))
    assertEquals(400, runnerFail.status)
    val runnerOk = handle(server, request("PUT", "/v1/runners:sidplay", mapOf("file" to "/music/demo.sid")))
    assertEquals(200, runnerOk.status)
  }

  @Test
  fun handlesConfigAndMemoryErrors() {
    val config = JSONObject().apply {
      put("categories", JSONObject().apply {
        put("Audio Mixer", JSONObject().apply {
          put("Vol Socket 1", JSONObject().apply { put("value", "-6 dB") })
        })
      })
    }
    val server = MockC64UServer(MockC64UState.fromPayload(config))

    val badConfig = handle(server, request("POST", "/v1/configs", body = "{invalid".toByteArray()))
    assertEquals(400, badConfig.status)

    val missingCategory = handle(server, request("GET", "/v1/configs/Unknown"))
    assertEquals(404, missingCategory.status)

    val missingValue = handle(server, request("PUT", "/v1/configs/Audio%20Mixer/Vol%20Socket%201"))
    assertEquals(400, missingValue.status)

    val badWrite = handle(
      server,
      request("PUT", "/v1/machine:writemem", mapOf("address" to "00C6", "data" to "ZZ")),
    )
    assertEquals(400, badWrite.status)

    val missingRead = handle(server, request("GET", "/v1/machine:readmem"))
    assertEquals(400, missingRead.status)
  }

  @Test
  fun readRequestParsesHeadersBodyAndQuery() {
    val server = MockC64UServer(MockC64UState.fromPayload(JSONObject()))
    val raw = """
      PUT /v1/machine:writemem?address=00C6&data=01 HTTP/1.1
      Host: localhost
      Content-Length: 3
      
      abc
    """.trimIndent()

    val request = readRequest(server, raw)
    assertNotNull(request)
    assertEquals("PUT", request?.method)
    assertEquals("/v1/machine:writemem", request?.path)
    assertEquals("00C6", request?.queryParams?.get("address"))
    assertEquals("01", request?.queryParams?.get("data"))
    assertEquals("abc", request?.body?.toString(StandardCharsets.UTF_8))
  }
}