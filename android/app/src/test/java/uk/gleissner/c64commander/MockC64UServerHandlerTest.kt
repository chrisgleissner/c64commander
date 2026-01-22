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