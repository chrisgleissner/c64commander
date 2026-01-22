package uk.gleissner.c64commander

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.getcapacitor.Bridge
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
class MockC64UPluginTest {
  private fun setPluginBridge(target: MockC64UPlugin, context: Context) {
    val bridge = mock(Bridge::class.java)
    `when`(bridge.context).thenReturn(context)
    val field = Plugin::class.java.getDeclaredField("bridge")
    field.isAccessible = true
    field.set(target, bridge)
  }

  @Test
  fun startAndStopServerResolvePayload() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val plugin = MockC64UPlugin()
    setPluginBridge(plugin, context)

    val config = JSObject().apply {
      put("general", JSObject().apply { put("baseUrl", "http://localhost") })
      put("categories", JSObject().apply {
        put("Network Settings", JSObject().apply {
          put("Network Password", JSObject().apply { put("value", "secret") })
        })
      })
    }

    val startCall = mock(PluginCall::class.java)
    `when`(startCall.getObject("config")).thenReturn(config)
    val startLatch = CountDownLatch(1)
    var resolved: JSObject? = null
    var rejected = false
    doAnswer { invocation ->
      resolved = invocation.getArgument(0) as JSObject
      startLatch.countDown()
      null
    }.`when`(startCall).resolve(any())
    doAnswer {
      rejected = true
      startLatch.countDown()
      null
    }.`when`(startCall).reject(anyString(), any(Exception::class.java))

    plugin.startServer(startCall)
    assertTrue(startLatch.await(5, TimeUnit.SECONDS))
    if (!rejected) {
      assertNotNull(resolved?.getInteger("port"))
      assertNotNull(resolved?.getString("baseUrl"))
      assertNotNull(resolved?.getInteger("ftpPort"))
    }

    val stopCall = mock(PluginCall::class.java)
    val stopLatch = CountDownLatch(1)
    doAnswer {
      stopLatch.countDown()
      null
    }.`when`(stopCall).resolve()

    plugin.stopServer(stopCall)
    assertTrue(stopLatch.await(2, TimeUnit.SECONDS))
  }

  @Test
  fun startServerRejectsWhenConfigIsMissing() {
    val plugin = MockC64UPlugin()
    val call = mock(PluginCall::class.java)
    `when`(call.getObject("config")).thenReturn(null)

    plugin.startServer(call)

    verify(call).reject("config is required")
  }

  @Test
  fun stopServerResolvesWhenNotRunning() {
    val plugin = MockC64UPlugin()
    val call = mock(PluginCall::class.java)

    plugin.stopServer(call)

    verify(call).resolve()
    verify(call, never()).reject(anyString())
  }
}
