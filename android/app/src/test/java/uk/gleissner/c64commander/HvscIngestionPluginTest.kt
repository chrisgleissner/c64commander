package uk.gleissner.c64commander

import com.getcapacitor.PluginCall
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.Mockito.*

class HvscIngestionPluginTest {
  private lateinit var plugin: HvscIngestionPlugin

  @Before
  fun setUp() {
    plugin = HvscIngestionPlugin()
  }

  @Test
  fun installOrUpdateHvscUsesCancelToken() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("cancelToken")).thenReturn("test-token")

    plugin.installOrUpdateHvsc(call)

    // Should set keep alive for long-running operation
    verify(call).setKeepAlive(true)
    verify(call).getString("cancelToken")
  }

  @Test
  fun installOrUpdateHvscUsesDefaultToken() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("cancelToken")).thenReturn(null)

    plugin.installOrUpdateHvsc(call)

    // Should set keep alive and use default token
    verify(call).setKeepAlive(true)
    verify(call).getString("cancelToken")
  }

  @Test
  fun ingestCachedHvscUsesCancelToken() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("cancelToken")).thenReturn("test-token")

    plugin.ingestCachedHvsc(call)

    // Should set keep alive for long-running operation
    verify(call).setKeepAlive(true)
    verify(call).getString("cancelToken")
  }
}
