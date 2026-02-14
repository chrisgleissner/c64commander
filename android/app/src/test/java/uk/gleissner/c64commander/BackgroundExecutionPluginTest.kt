/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import com.getcapacitor.Bridge
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.*
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class BackgroundExecutionPluginTest {
    private lateinit var plugin: BackgroundExecutionPlugin
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        plugin = BackgroundExecutionPlugin()
        injectBridge(plugin, context)
        // Ensure the service is stopped before each test
        BackgroundExecutionService.stop(context)
    }

    private fun injectBridge(target: Plugin, ctx: Context) {
        val bridge = mock(Bridge::class.java)
        `when`(bridge.context).thenReturn(ctx)
        val field = Plugin::class.java.getDeclaredField("bridge")
        field.isAccessible = true
        field.set(target, bridge)
    }

    @Test
    fun startResolvesOnSuccess() {
        val call = mock(PluginCall::class.java)
        plugin.start(call)
        verify(call).resolve()
        verify(call, never()).reject(anyString(), any(Exception::class.java))
    }

    @Test
    fun stopResolvesOnSuccess() {
        val call = mock(PluginCall::class.java)
        plugin.stop(call)
        verify(call).resolve()
        verify(call, never()).reject(anyString(), any(Exception::class.java))
    }

    @Test
    fun setDueAtMsResolvesWithPositiveValue() {
        val call = mock(PluginCall::class.java)
        `when`(call.getLong("dueAtMs")).thenReturn(System.currentTimeMillis() + 60_000L)
        plugin.setDueAtMs(call)
        verify(call).resolve()
    }

    @Test
    fun setDueAtMsResolvesWithNullValue() {
        val call = mock(PluginCall::class.java)
        `when`(call.getLong("dueAtMs")).thenReturn(null)
        plugin.setDueAtMs(call)
        verify(call).resolve()
    }

    @Test
    fun setDueAtMsResolvesWithZeroValue() {
        val call = mock(PluginCall::class.java)
        `when`(call.getLong("dueAtMs")).thenReturn(0L)
        plugin.setDueAtMs(call)
        verify(call).resolve()
    }

    @Test
    fun setDueAtMsResolvesWithNegativeValue() {
        val call = mock(PluginCall::class.java)
        `when`(call.getLong("dueAtMs")).thenReturn(-1L)
        plugin.setDueAtMs(call)
        verify(call).resolve()
    }

    @Test
    fun startThenStopIsIdempotent() {
        val startCall = mock(PluginCall::class.java)
        val stopCall = mock(PluginCall::class.java)
        plugin.start(startCall)
        plugin.stop(stopCall)
        plugin.stop(stopCall)
        verify(startCall, times(1)).resolve()
        verify(stopCall, times(2)).resolve()
    }

    @Test
    fun traceContextIsExtractedFromCall() {
        val call = mock(PluginCall::class.java)
        val traceContext = JSObject()
        traceContext.put("correlationId", "test-123")
        traceContext.put("trackInstanceId", 42)
        traceContext.put("sourceKind", "hvsc")
        `when`(call.getObject("traceContext")).thenReturn(traceContext)
        // start should still resolve even with traceContext set
        plugin.start(call)
        verify(call).resolve()
    }
}
