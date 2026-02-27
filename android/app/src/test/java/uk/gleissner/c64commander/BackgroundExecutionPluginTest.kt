/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import com.getcapacitor.Bridge
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.eq
import org.mockito.Mockito.*
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows

/** Test-only subclass that captures notifyListeners calls for verification. */
private open class TestableBackgroundExecutionPlugin : BackgroundExecutionPlugin() {
    val notifyListenersCalls = mutableListOf<Pair<String?, JSObject?>>()

    public override fun notifyListeners(eventName: String?, data: JSObject?) {
        notifyListenersCalls.add(Pair(eventName, data))
    }
}

@RunWith(RobolectricTestRunner::class)
class BackgroundExecutionPluginTest {
    private lateinit var plugin: TestableBackgroundExecutionPlugin
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        plugin = TestableBackgroundExecutionPlugin()
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

    @Test
    fun loadRegistersAutoSkipReceiver() {
        plugin.load()
        val shadowApp = Shadows.shadowOf(context as android.app.Application)
        val hasReceiver = shadowApp.registeredReceivers.any { wrapper ->
            wrapper.intentFilter.hasAction(BackgroundExecutionService.ACTION_AUTO_SKIP_DUE)
        }
        assertTrue("Auto-skip receiver should be registered after load()", hasReceiver)
    }

    @Test
    fun autoSkipReceiverIgnoresWrongAction() {
        plugin.load()
        val receiverField = BackgroundExecutionPlugin::class.java.getDeclaredField("autoSkipReceiver")
        receiverField.isAccessible = true
        val receiver = receiverField.get(plugin) as BroadcastReceiver

        plugin.notifyListenersCalls.clear()
        receiver.onReceive(context, Intent("uk.gleissner.c64commander.WRONG"))

        assertTrue("notifyListeners should not be called for wrong action",
            plugin.notifyListenersCalls.none { it.first == "backgroundAutoSkipDue" })
    }

    @Test
    fun autoSkipReceiverIgnoresInvalidDueValues() {
        plugin.load()
        val receiverField = BackgroundExecutionPlugin::class.java.getDeclaredField("autoSkipReceiver")
        receiverField.isAccessible = true
        val receiver = receiverField.get(plugin) as BroadcastReceiver

        val invalidIntent = Intent(BackgroundExecutionService.ACTION_AUTO_SKIP_DUE).apply {
            putExtra(BackgroundExecutionService.EXTRA_DUE_AT_MS, -1L)
            putExtra(BackgroundExecutionService.EXTRA_FIRED_AT_MS, 0L)
        }
        plugin.notifyListenersCalls.clear()
        receiver.onReceive(context, invalidIntent)

        assertTrue("notifyListeners should not be called for invalid due values",
            plugin.notifyListenersCalls.none { it.first == "backgroundAutoSkipDue" })
    }

    @Test
    fun autoSkipReceiverAcceptsValidPayload() {
        plugin.load()
        val receiverField = BackgroundExecutionPlugin::class.java.getDeclaredField("autoSkipReceiver")
        receiverField.isAccessible = true
        val receiver = receiverField.get(plugin) as BroadcastReceiver

        val now = System.currentTimeMillis()
        val validIntent = Intent(BackgroundExecutionService.ACTION_AUTO_SKIP_DUE).apply {
            putExtra(BackgroundExecutionService.EXTRA_DUE_AT_MS, now - 1_000L)
            putExtra(BackgroundExecutionService.EXTRA_FIRED_AT_MS, now)
        }
        plugin.notifyListenersCalls.clear()
        receiver.onReceive(context, validIntent)

        val calls = plugin.notifyListenersCalls.filter { it.first == "backgroundAutoSkipDue" }
        assertEquals("notifyListeners should be called once", 1, calls.size)
        val payload = calls[0].second!!
        assertTrue(payload.getLong("dueAtMs") > 0L)
        assertTrue(payload.getLong("firedAtMs") > 0L)
        assertTrue(payload.getLong("firedAtMs") >= payload.getLong("dueAtMs"))
    }

    @Test
    fun stopRejectsWhenPluginContextIsUnavailable() {
        val pluginWithoutBridge = BackgroundExecutionPlugin()
        val call = mock(PluginCall::class.java)

        pluginWithoutBridge.stop(call)

        verify(call).reject(eq("Failed to stop background execution"), any(Exception::class.java))
    }

    @Test
    fun startRejectsWhenPluginContextGetterThrows() {
        val throwingBridge = mock(Bridge::class.java)
        `when`(throwingBridge.context).thenThrow(RuntimeException("bridge context unavailable"))
        val target = BackgroundExecutionPlugin()
        val field = Plugin::class.java.getDeclaredField("bridge")
        field.isAccessible = true
        field.set(target, throwingBridge)

        val call = mock(PluginCall::class.java)
        val traceContext = JSObject()
        traceContext.put("correlationId", "corr-start")
        traceContext.put("trackInstanceId", 17)
        traceContext.put("playlistItemId", "playlist-17")
        traceContext.put("sourceKind", "local")
        traceContext.put("localAccessMode", "filesystem")
        traceContext.put("lifecycleState", "queued")
        `when`(call.getObject("traceContext")).thenReturn(traceContext)

        target.start(call)

        verify(call).reject(eq("Failed to start background execution"), any(Exception::class.java))
    }

    @Test
    fun loadHandlesReceiverRegistrationFailure() {
        val brokenContext = mock(Context::class.java)
        `when`(
            brokenContext.registerReceiver(any(BroadcastReceiver::class.java), any(IntentFilter::class.java)),
        ).thenThrow(RuntimeException("register failed"))

        val bridge = mock(Bridge::class.java)
        `when`(bridge.context).thenReturn(brokenContext)
        val target = BackgroundExecutionPlugin()
        val field = Plugin::class.java.getDeclaredField("bridge")
        field.isAccessible = true
        field.set(target, bridge)

        target.load()
    }

    @Test
    fun handleOnDestroyHandlesReceiverUnregisterFailure() {
        val brokenContext = mock(Context::class.java)
        doThrow(RuntimeException("unregister failed")).`when`(brokenContext)
            .unregisterReceiver(any(BroadcastReceiver::class.java))

        val bridge = mock(Bridge::class.java)
        `when`(bridge.context).thenReturn(brokenContext)
        val target = BackgroundExecutionPlugin()
        val field = Plugin::class.java.getDeclaredField("bridge")
        field.isAccessible = true
        field.set(target, bridge)

        val method = Plugin::class.java.getDeclaredMethod("handleOnDestroy")
        method.isAccessible = true
        method.invoke(target)
    }
}
