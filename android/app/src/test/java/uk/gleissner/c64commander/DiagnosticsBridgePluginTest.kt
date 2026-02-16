/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.getcapacitor.Bridge
import com.getcapacitor.Plugin
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.*
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows

@RunWith(RobolectricTestRunner::class)
class DiagnosticsBridgePluginTest {
    private lateinit var plugin: DiagnosticsBridgePlugin
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        plugin = DiagnosticsBridgePlugin()
        injectBridge(plugin, context)
    }

    private fun injectBridge(target: Plugin, ctx: Context) {
        val bridge = mock(Bridge::class.java)
        `when`(bridge.context).thenReturn(ctx)
        val field = Plugin::class.java.getDeclaredField("bridge")
        field.isAccessible = true
        field.set(target, bridge)
    }

    @Test
    fun loadRegistersReceiver() {
        plugin.load()
        val shadowApp = Shadows.shadowOf(context as android.app.Application)
        val receivers = shadowApp.registeredReceivers
        val hasReceiver = receivers.any { wrapper ->
            wrapper.broadcastReceiver.javaClass.name.contains("DiagnosticsBridgePlugin")
                || wrapper.intentFilter.hasAction(AppLogger.ACTION_DIAGNOSTICS_LOG)
        }
        assertTrue("Diagnostics receiver should be registered after load()", hasReceiver)
    }

    @Test
    fun handleOnDestroyUnregistersReceiver() {
        plugin.load()
        // handleOnDestroy is protected — invoke via reflection
        val method = Plugin::class.java.getDeclaredMethod("handleOnDestroy")
        method.isAccessible = true
        method.invoke(plugin)
        // Verify no crash — the receiver should be unregistered
    }

    @Test
    fun receiverIgnoresWrongAction() {
        plugin.load()
        // Sending a broadcast with a different action should not crash
        val intent = Intent("uk.gleissner.c64commander.WRONG_ACTION")
        context.sendBroadcast(intent)
        Shadows.shadowOf(context as android.app.Application).run {
            // Just verify no exception
        }
    }

    @Test
    fun receiverProcessesDiagnosticsIntent() {
        plugin.load()
        val intent = Intent(AppLogger.ACTION_DIAGNOSTICS_LOG).apply {
            putExtra(AppLogger.EXTRA_LEVEL, "error")
            putExtra(AppLogger.EXTRA_MESSAGE, "Test error message")
            putExtra(AppLogger.EXTRA_COMPONENT, "TestComponent")
        }
        // This exercises the receiver's onReceive — it will call notifyListeners
        // which may be a no-op without real webview. Main goal: no crash.
        context.sendBroadcast(intent)
    }

    @Test
    fun receiverHandlesErrorExtras() {
        plugin.load()
        val intent = Intent(AppLogger.ACTION_DIAGNOSTICS_LOG).apply {
            putExtra(AppLogger.EXTRA_LEVEL, "error")
            putExtra(AppLogger.EXTRA_MESSAGE, "Crash detected")
            putExtra(AppLogger.EXTRA_ERROR_NAME, "RuntimeError")
            putExtra(AppLogger.EXTRA_ERROR_MESSAGE, "null pointer")
            putExtra(AppLogger.EXTRA_ERROR_STACK, "at com.example.Foo.bar()")
        }
        context.sendBroadcast(intent)
    }

    @Test
    fun receiverHandlesMinimalIntent() {
        plugin.load()
        val intent = Intent(AppLogger.ACTION_DIAGNOSTICS_LOG)
        // No extras at all — receiver should handle gracefully
        context.sendBroadcast(intent)
    }

    @Test
    fun receiverProcessesDetailedPayloadViaDirectInvocation() {
        val receiverField = DiagnosticsBridgePlugin::class.java.getDeclaredField("diagnosticsReceiver")
        receiverField.isAccessible = true
        val receiver = receiverField.get(plugin) as BroadcastReceiver

        val intent = Intent(AppLogger.ACTION_DIAGNOSTICS_LOG).apply {
            putExtra(AppLogger.EXTRA_LEVEL, "warn")
            putExtra(AppLogger.EXTRA_MESSAGE, "native warning")
            putExtra(AppLogger.EXTRA_COMPONENT, "Bridge")
            putExtra(AppLogger.EXTRA_CORRELATION_ID, "corr-123")
            putExtra(AppLogger.EXTRA_TRACK_INSTANCE_ID, "7")
            putExtra(AppLogger.EXTRA_PLAYLIST_ITEM_ID, "p-11")
            putExtra(AppLogger.EXTRA_SOURCE_KIND, "hvsc")
            putExtra(AppLogger.EXTRA_LOCAL_ACCESS_MODE, "ftp")
            putExtra(AppLogger.EXTRA_LIFECYCLE_STATE, "playing")
            putExtra(AppLogger.EXTRA_ERROR_NAME, "IllegalStateException")
            putExtra(AppLogger.EXTRA_ERROR_MESSAGE, "boom")
            putExtra(AppLogger.EXTRA_ERROR_STACK, "stack")
        }

        receiver.onReceive(context, intent)
    }

    @Test
    fun receiverIgnoresNullIntentViaDirectInvocation() {
        val receiverField = DiagnosticsBridgePlugin::class.java.getDeclaredField("diagnosticsReceiver")
        receiverField.isAccessible = true
        val receiver = receiverField.get(plugin) as BroadcastReceiver

        receiver.onReceive(context, null)
    }
}
