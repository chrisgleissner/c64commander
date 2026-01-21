package uk.gleissner.c64commander

import com.getcapacitor.JSArray
import com.getcapacitor.PluginCall
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.Mockito.*

class FeatureFlagsPluginTest {
  private lateinit var plugin: FeatureFlagsPlugin

  @Before
  fun setUp() {
    plugin = FeatureFlagsPlugin()
  }

  @Test
  fun getFlagRejectsWhenKeyIsMissing() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("key")).thenReturn(null)

    plugin.getFlag(call)

    verify(call).reject("key is required")
  }

  @Test
  fun getFlagRejectsWhenKeyIsBlank() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("key")).thenReturn("")

    plugin.getFlag(call)

    verify(call).reject("key is required")
  }

  @Test
  fun setFlagRejectsWhenKeyIsMissing() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("key")).thenReturn(null)
    `when`(call.getBoolean("value")).thenReturn(true)

    plugin.setFlag(call)

    verify(call).reject("key is required")
  }

  @Test
  fun setFlagRejectsWhenValueIsMissing() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("key")).thenReturn("test_flag")
    `when`(call.getBoolean("value")).thenReturn(null)

    plugin.setFlag(call)

    verify(call).reject("value is required")
  }
}
