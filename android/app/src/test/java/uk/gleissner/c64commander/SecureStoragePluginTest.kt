/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.getcapacitor.Bridge
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify
import org.mockito.Mockito.any
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
class SecureStoragePluginTest {
  private lateinit var plugin: SecureStoragePlugin

  @Before
  fun setUp() {
    plugin = SecureStoragePlugin()
  }

  private fun setPluginBridge(target: SecureStoragePlugin, context: Context) {
    val bridge = mock(Bridge::class.java)
    org.mockito.Mockito.`when`(bridge.context).thenReturn(context)
    val field = Plugin::class.java.getDeclaredField("bridge")
    field.isAccessible = true
    field.set(target, bridge)
  }

  @Test
  fun setPasswordRejectsMissingValue() {
    val call = mock(PluginCall::class.java)
    org.mockito.Mockito.`when`(call.getString("value")).thenReturn(null)

    plugin.setPassword(call)

    verify(call).reject("value is required")
  }

  @Test
  fun setGetAndClearPassword() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)

    val setCall = mock(PluginCall::class.java)
    org.mockito.Mockito.`when`(setCall.getString("value")).thenReturn("secret")
    val setLatch = CountDownLatch(1)
    doAnswer {
      setLatch.countDown()
      null
    }.`when`(setCall).resolve()

    plugin.setPassword(setCall)
    assertTrue(setLatch.await(2, TimeUnit.SECONDS))

    val getCall = mock(PluginCall::class.java)
    val getLatch = CountDownLatch(1)
    var resolved: JSObject? = null
    doAnswer { invocation: org.mockito.invocation.InvocationOnMock ->
      resolved = invocation.getArgument(0) as JSObject
      getLatch.countDown()
      null
    }.`when`(getCall).resolve(org.mockito.Mockito.any())

    plugin.getPassword(getCall)
    assertTrue(getLatch.await(2, TimeUnit.SECONDS))
    assertEquals("secret", resolved?.getString("value"))

    val clearCall = mock(PluginCall::class.java)
    val clearLatch = CountDownLatch(1)
    doAnswer {
      clearLatch.countDown()
      null
    }.`when`(clearCall).resolve()

    plugin.clearPassword(clearCall)
    assertTrue(clearLatch.await(2, TimeUnit.SECONDS))

    val getAfterClearCall = mock(PluginCall::class.java)
    val getAfterClearLatch = CountDownLatch(1)
    var clearedPayload: JSObject? = null
    doAnswer { invocation: org.mockito.invocation.InvocationOnMock ->
      clearedPayload = invocation.getArgument(0) as JSObject
      getAfterClearLatch.countDown()
      null
    }.`when`(getAfterClearCall).resolve(org.mockito.Mockito.any())

    plugin.getPassword(getAfterClearCall)
    assertTrue(getAfterClearLatch.await(2, TimeUnit.SECONDS))
    assertEquals(null, clearedPayload?.getString("value"))
  }

  @Test
  fun setPasswordRejectsWhenPrefsProviderFails() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    plugin.prefsProvider = { throw RuntimeException("prefs set failed") }

    val call = mock(PluginCall::class.java)
    org.mockito.Mockito.`when`(call.getString("value")).thenReturn("secret")

    plugin.setPassword(call)

    verify(call).reject(any(), any(Exception::class.java))
  }

  @Test
  fun getPasswordRejectsWhenPrefsProviderFails() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    plugin.prefsProvider = { throw RuntimeException("prefs get failed") }

    val call = mock(PluginCall::class.java)
    plugin.getPassword(call)

    verify(call).reject(any(), any(Exception::class.java))
  }

  @Test
  fun clearPasswordRejectsWhenPrefsProviderFails() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    setPluginBridge(plugin, context)
    plugin.prefsProvider = { throw RuntimeException("prefs clear failed") }

    val call = mock(PluginCall::class.java)
    plugin.clearPassword(call)

    verify(call).reject(any(), any(Exception::class.java))
  }
}
