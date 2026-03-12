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
import org.junit.Test
import java.net.HttpURLConnection
import java.net.Socket
import java.net.URL
import java.util.Arrays

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
      } catch (error: Exception) {
        System.err.println("MockC64UServerTest waitForServer failed: ${error.message}")
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
  fun screenMemoryDefaultsMatchLiveHardwareAssumptions() {
    val config = JSONObject().apply {
      put("general", JSONObject().apply { put("baseUrl", "http://localhost") })
    }
    val state = MockC64UState.fromPayload(config)
    val server = MockC64UServer(state)
    server.start()
    waitForServer(server)

    val screenConnection = URL("${server.baseUrl}/v1/machine:readmem?address=0400&length=16").openConnection() as HttpURLConnection
    screenConnection.requestMethod = "GET"
    val screenBody = readBody(screenConnection)
    val screenData = JSONObject(screenBody).getJSONArray("data")
    repeat(16) { index ->
      assertEquals(0x20, screenData.getInt(index))
    }

    val cia2Connection = URL("${server.baseUrl}/v1/machine:readmem?address=DD00&length=1").openConnection() as HttpURLConnection
    cia2Connection.requestMethod = "GET"
    val cia2 = JSONObject(readBody(cia2Connection)).getJSONArray("data")
    assertEquals(0x3F, cia2.getInt(0))

    val vicConnection = URL("${server.baseUrl}/v1/machine:readmem?address=D018&length=1").openConnection() as HttpURLConnection
    vicConnection.requestMethod = "GET"
    val vic = JSONObject(readBody(vicConnection)).getJSONArray("data")
    assertEquals(0x15, vic.getInt(0))

    server.stop()
  }

  @Test
  fun binaryWriteSupportsFullScreenBufferRoundTrip() {
    val config = JSONObject().apply {
      put("general", JSONObject().apply { put("baseUrl", "http://localhost") })
    }
    val state = MockC64UState.fromPayload(config)
    val server = MockC64UServer(state)
    server.start()
    waitForServer(server)

    val baselineConnection = URL("${server.baseUrl}/v1/machine:readmem?address=0400&length=16").openConnection() as HttpURLConnection
    baselineConnection.requestMethod = "GET"
    val baseline = JSONObject(readBody(baselineConnection)).getJSONArray("data")
    val baselineBytes = IntArray(16) { index -> baseline.getInt(index) }

    val mutateConnection = URL("${server.baseUrl}/v1/machine:writemem?address=0400&data=54455354").openConnection() as HttpURLConnection
    mutateConnection.requestMethod = "PUT"
    assertEquals(200, mutateConnection.responseCode)
    mutateConnection.disconnect()

    val fullImage = ByteArray(65536)
    Arrays.fill(fullImage, 0)
    fullImage[0xDD00] = 0x3F.toByte()
    fullImage[0xD018] = 0x15.toByte()
    repeat(1000) { offset ->
      fullImage[0x0400 + offset] = 0x20.toByte()
      fullImage[0xD800 + offset] = 0x0E.toByte()
    }

    val restoreConnection = URL("${server.baseUrl}/v1/machine:writemem?address=0000").openConnection() as HttpURLConnection
    restoreConnection.requestMethod = "POST"
    restoreConnection.doOutput = true
    restoreConnection.setRequestProperty("Content-Type", "application/octet-stream")
    restoreConnection.outputStream.use { it.write(fullImage) }
    assertEquals(200, restoreConnection.responseCode)
    restoreConnection.disconnect()

    val verifyConnection = URL("${server.baseUrl}/v1/machine:readmem?address=0400&length=16").openConnection() as HttpURLConnection
    verifyConnection.requestMethod = "GET"
    val verify = JSONObject(readBody(verifyConnection)).getJSONArray("data")
    repeat(16) { index ->
      assertEquals(baselineBytes[index], verify.getInt(index))
    }

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
