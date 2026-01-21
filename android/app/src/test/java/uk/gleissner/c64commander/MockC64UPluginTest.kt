package uk.gleissner.c64commander

import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.Mockito.*

class MockC64UPluginTest {
  private lateinit var plugin: MockC64UPlugin

  @Before
  fun setUp() {
    plugin = MockC64UPlugin()
  }

  @Test
  fun startServerRejectsWhenConfigIsMissing() {
    val call = mock(PluginCall::class.java)
    `when`(call.getObject("config")).thenReturn(null)

    plugin.startServer(call)

    verify(call).reject("config is required")
  }
}
