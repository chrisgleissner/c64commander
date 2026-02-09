/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import com.getcapacitor.Plugin
import com.getcapacitor.Bridge
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Before
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.*
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class FeatureFlagsPluginTest {
  private lateinit var plugin: FeatureFlagsPlugin
  private val testDispatcher = UnconfinedTestDispatcher()

  @Before
  fun setUp() {
    Dispatchers.setMain(testDispatcher)
    plugin = FeatureFlagsPlugin()
  }

  @After
  fun tearDown() {
    Dispatchers.resetMain()
  }

  private fun setPluginBridge(target: FeatureFlagsPlugin, context: Context) {
    val bridge = mock(Bridge::class.java)
    `when`(bridge.context).thenReturn(context)
    val field = Plugin::class.java.getDeclaredField("bridge")
    field.isAccessible = true
    field.set(target, bridge)
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

  @Test
  fun setFlagPersistsAndGetAllFlagsReturnsValue() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)

    val setCall = mock(PluginCall::class.java)
    `when`(setCall.getString("key")).thenReturn("demo_flag")
    `when`(setCall.getBoolean("value")).thenReturn(true)
    val setLatch = CountDownLatch(1)
    doAnswer {
      setLatch.countDown()
      null
    }.`when`(setCall).resolve()

    plugin.setFlag(setCall)
    assertTrue(setLatch.await(2, TimeUnit.SECONDS))

    val getCall = mock(PluginCall::class.java)
    val keys = JSArray().apply { put("demo_flag") }
    `when`(getCall.getArray("keys")).thenReturn(keys)
    val getLatch = CountDownLatch(1)
    var resolved: JSObject? = null
    doAnswer { invocation: org.mockito.invocation.InvocationOnMock ->
      resolved = invocation.getArgument(0) as JSObject
      getLatch.countDown()
      null
    }.`when`(getCall).resolve(any())

    plugin.getAllFlags(getCall)
    assertTrue(getLatch.await(2, TimeUnit.SECONDS))

    val flags = resolved?.getJSObject("flags")
    assertEquals(true, flags?.getBoolean("demo_flag"))
  }

}
