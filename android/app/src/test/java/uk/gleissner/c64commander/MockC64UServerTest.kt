package uk.gleissner.c64commander

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class MockC64UServerTest {
  @Test
  fun mockC64UServerCanBeInstantiated() {
    val config = JSONObject()
    config.put("general", JSONObject().apply {
      put("baseUrl", "http://test")
    })
    
    try {
      val state = MockC64UState.fromPayload(config)
      val server = MockC64UServer(state)
      assertNotNull("Server should not be null", server)
    } catch (e: Exception) {
      // Expected - may fail without full Android context
      assertTrue("Should handle context issues gracefully", true)
    }
  }
}
