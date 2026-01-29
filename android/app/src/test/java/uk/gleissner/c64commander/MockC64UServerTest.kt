package uk.gleissner.c64commander

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL
import java.net.Socket

class MockC64UServerTest {
  private fun readBody(connection: HttpURLConnection): String {
    val stream = if (connection.responseCode >= 400) connection.errorStream else connection.inputStream
    return stream.bufferedReader().use { it.readText() }
  }

  private fun waitForServer(server: MockC64UServer) {
    repeat(10) {
      try {
        Socket("127.0.0.1", server.port).use { }
        return
      } catch (_: Exception) {
        Thread.sleep(25)
      }
    }
  }

  @Test
  fun versionEndpointReturnsConfiguredVersion() {
    val config = JSONObject().apply {
      put("general", JSONObject().apply {
        put("baseUrl", "http://localhost")
        put("restApiVersion", "1.2.3")
      })
    }
    val state = MockC64UState.fromPayload(config)
    val server = MockC64UServer(state)
    server.start()
    waitForServer(server)

    val connection = URL("${server.baseUrl}/v1/version").openConnection() as HttpURLConnection
    connection.requestMethod = "GET"
    val body = readBody(connection)
    val response = JSONObject(body)

    assertEquals(200, connection.responseCode)
    assertEquals("1.2.3", response.getString("version"))
    server.stop()
  }

  @Test
  fun configBatchUpdatesAreReflectedInCategoryResponse() {
    val config = JSONObject().apply {
      put("general", JSONObject().apply { put("baseUrl", "http://localhost") })
      put("categories", JSONObject().apply {
        put("Audio Mixer", JSONObject().apply {
          put("Vol Socket 1", JSONObject().apply { put("value", "-6 dB") })
        })
      })
    }
    val state = MockC64UState.fromPayload(config)
    val server = MockC64UServer(state)
    server.start()
    waitForServer(server)

    val updatePayload = JSONObject().apply {
      put("Audio Mixer", JSONObject().apply {
        put("Vol Socket 1", "OFF")
      })
    }
    val updateConnection = URL("${server.baseUrl}/v1/configs").openConnection() as HttpURLConnection
    updateConnection.requestMethod = "POST"
    updateConnection.doOutput = true
    updateConnection.outputStream.use { it.write(updatePayload.toString().toByteArray()) }
    assertEquals(200, updateConnection.responseCode)
    updateConnection.disconnect()

    val getConnection = URL("${server.baseUrl}/v1/configs/Audio%20Mixer").openConnection() as HttpURLConnection
    getConnection.requestMethod = "GET"
    val body = readBody(getConnection)
    val response = JSONObject(body)
    val items = response.getJSONObject("Audio Mixer").getJSONObject("items")
    val volEntry = items.getJSONObject("Vol Socket 1")

    assertEquals("OFF", volEntry.getString("selected"))
    server.stop()
  }

  @Test
  fun memoryReadWriteEndpointsRoundTrip() {
    val config = JSONObject().apply {
      put("general", JSONObject().apply { put("baseUrl", "http://localhost") })
    }
    val state = MockC64UState.fromPayload(config)
    val server = MockC64UServer(state)
    server.start()
    waitForServer(server)

    val writeConnection = URL("${server.baseUrl}/v1/machine:writemem?address=00C6&data=01").openConnection() as HttpURLConnection
    writeConnection.requestMethod = "PUT"
    assertEquals(200, writeConnection.responseCode)
    writeConnection.disconnect()

    val readConnection = URL("${server.baseUrl}/v1/machine:readmem?address=00C6&length=1").openConnection() as HttpURLConnection
    readConnection.requestMethod = "GET"
    val body = readBody(readConnection)
    val response = JSONObject(body)
    val data = response.getJSONArray("data")
    assertEquals(1, data.length())
    assertEquals(1, data.getInt(0))
    server.stop()
  }

  @Test
  fun resetClearsKeyboardBuffer() {
    val config = JSONObject().apply {
      put("general", JSONObject().apply { put("baseUrl", "http://localhost") })
    }
    val state = MockC64UState.fromPayload(config)
    val server = MockC64UServer(state)
    server.start()
    waitForServer(server)

    val writeConnection = URL("${server.baseUrl}/v1/machine:writemem?address=00C6&data=05").openConnection() as HttpURLConnection
    writeConnection.requestMethod = "PUT"
    assertEquals(200, writeConnection.responseCode)
    writeConnection.disconnect()

    val resetConnection = URL("${server.baseUrl}/v1/machine:reset").openConnection() as HttpURLConnection
    resetConnection.requestMethod = "PUT"
    assertEquals(200, resetConnection.responseCode)
    resetConnection.disconnect()

    val readConnection = URL("${server.baseUrl}/v1/machine:readmem?address=00C6&length=1").openConnection() as HttpURLConnection
    readConnection.requestMethod = "GET"
    val body = readBody(readConnection)
    val response = JSONObject(body)
    val data = response.getJSONArray("data")
    assertEquals(0, data.getInt(0))
    server.stop()
  }
  @Test
  fun mockC64UServerCanBeInstantiated() {
    val config = JSONObject()
    config.put("general", JSONObject().apply {
      put("baseUrl", "http://localhost")
    })

    val state = MockC64UState.fromPayload(config)
    val server = MockC64UServer(state)
    assertNotNull("Server should not be null", server)
  }
}
