/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Intent
import android.os.Build
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.shadows.ShadowLooper
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [Build.VERSION_CODES.TIRAMISU])
class BackgroundExecutionServiceTest {

    private lateinit var controller: ServiceController<BackgroundExecutionService>
    private lateinit var service: BackgroundExecutionService

    @Before
    fun setUp() {
        setIsRunning(false)
        setRunningInstance(null)
        setCompanionField("commandGeneration", 0L)
        setCompanionField("startPendingGeneration", null)
        controller = Robolectric.buildService(BackgroundExecutionService::class.java)
        service = controller.get()
    }

    @After
    fun tearDown() {
        try {
            controller.destroy()
        } catch (_: Exception) {
            // Service may already be destroyed
        }
        setIsRunning(false)
        setRunningInstance(null)
        setCompanionField("commandGeneration", 0L)
        setCompanionField("startPendingGeneration", null)
    }

    // Helper to set the static isRunning field via reflection for testing
    private fun setIsRunning(value: Boolean) {
        val field = BackgroundExecutionService::class.java.getDeclaredField("isRunning")
        field.isAccessible = true
        field.set(null, value)
    }

    private fun setRunningInstance(value: BackgroundExecutionService?) {
        val field = BackgroundExecutionService::class.java.getDeclaredField("runningInstance")
        field.isAccessible = true
        field.set(null, value)
    }

    private fun setCompanionField(name: String, value: Any?) {
        val field = BackgroundExecutionService::class.java.getDeclaredField(name)
        field.isAccessible = true
        field.set(null, value)
    }

    private fun getPrivateField(name: String): Any? {
        val field = BackgroundExecutionService::class.java.getDeclaredField(name)
        field.isAccessible = true
        return field.get(service)
    }

    private fun startService(startId: Int = 0) {
        service.onStartCommand(Intent(service, BackgroundExecutionService::class.java), 0, startId)
    }

    @Test
    fun serviceStartsSetsIsRunning() {
        controller.create()
        startService()
        assertTrue("Service should be running after start", BackgroundExecutionService.isRunning)
    }

    @Test
    fun serviceStopClearsIsRunning() {
        controller.create()
        startService()
        assertTrue(BackgroundExecutionService.isRunning)

        controller.destroy()
        assertFalse("Service should not be running after destroy", BackgroundExecutionService.isRunning)
    }

    @Test
    fun startCommandIsIdempotent() {
        controller.create()
        startService()
        assertTrue(BackgroundExecutionService.isRunning)

        // Second start command should not fail
        startService(1)
        assertTrue("Service should still be running after second startCommand", BackgroundExecutionService.isRunning)
    }

    @Test
    fun updateDueAtAcceptsPositiveValue() {
        controller.create()
        startService()

        val intent = Intent(BackgroundExecutionService.ACTION_UPDATE_DUE_AT)
        intent.putExtra(BackgroundExecutionService.EXTRA_DUE_AT_MS, System.currentTimeMillis() + 30_000L)
        service.onStartCommand(intent, 0, 1)

        // Service should still be running (no crash, no immediate stop)
        assertTrue(BackgroundExecutionService.isRunning)
    }

    @Test
    fun updateDueAtClearsOnNegativeValue() {
        controller.create()
        startService()

        val intent = Intent(BackgroundExecutionService.ACTION_UPDATE_DUE_AT)
        intent.putExtra(BackgroundExecutionService.EXTRA_DUE_AT_MS, -1L)
        service.onStartCommand(intent, 0, 1)

        assertTrue("Service should remain running after clearing dueAt", BackgroundExecutionService.isRunning)
    }

    @Test
    fun updateDueAtClearsOnMissingExtra() {
        controller.create()
        startService()

        val intent = Intent(BackgroundExecutionService.ACTION_UPDATE_DUE_AT)
        // No EXTRA_DUE_AT_MS set — should clear
        service.onStartCommand(intent, 0, 1)

        assertTrue("Service should remain running after clearing dueAt (no extra)", BackgroundExecutionService.isRunning)
    }

    @Test
    fun companionStartIgnoresWhenAlreadyRunning() {
        setIsRunning(true)
        // Should not throw or crash
        BackgroundExecutionService.start(service)
        assertTrue(BackgroundExecutionService.isRunning)
    }

    @Test
    fun companionStopIgnoresWhenNotRunning() {
        setIsRunning(false)
        // Should not throw or crash
        BackgroundExecutionService.stop(service)
        assertFalse(BackgroundExecutionService.isRunning)
    }

    @Test
    fun destroyReleasesResources() {
        controller.create()
        startService()
        assertTrue(BackgroundExecutionService.isRunning)

        controller.destroy()
        assertFalse("isRunning should be false after destroy", BackgroundExecutionService.isRunning)
    }

    @Test
    fun serviceDoesNotAutoStopWithoutDueAt() {
        controller.create()
        startService()

        ShadowLooper.shadowMainLooper().idleFor(2, TimeUnit.MINUTES)

        assertTrue("Service should remain running without dueAt until explicit stop", BackgroundExecutionService.isRunning)
    }

    @Test
    fun stickyRestartWithoutCommandDoesNotLeaveOrphanServiceRunning() {
        controller.create()

        val result = service.onStartCommand(null, 0, 1)

        assertEquals(
            "Null sticky restart should not keep a foreground service alive without JS re-registration",
            android.app.Service.START_NOT_STICKY,
            result,
        )
        assertFalse("Null sticky restart should not mark service running", BackgroundExecutionService.isRunning)
    }

    @Test
    fun serviceStartInitializesMediaSessionAndAudioFocusState() {
        controller.create()
        startService()

        assertNotNull("MediaSession should be initialized when service starts", getPrivateField("mediaSession"))
        assertNotNull("AudioManager should be initialized when service starts", getPrivateField("audioManager"))
    }

    @Test
    fun serviceDestroyReleasesMediaSessionAndAudioFocusState() {
        controller.create()
        startService()

        controller.destroy()

        assertNull("MediaSession should be released on destroy", getPrivateField("mediaSession"))
        assertNull("AudioManager reference should clear on destroy", getPrivateField("audioManager"))
        assertNull("AudioFocusRequest should clear on destroy", getPrivateField("audioFocusRequest"))
    }

    @Test
    fun onBindReturnsNull() {
        controller.create()
        assertNull("onBind should return null for a started service", service.onBind(null))
    }

    @Test
    @Config(sdk = [Build.VERSION_CODES.N])
    fun companionStartUsesStartServiceOnPreO() {
        setIsRunning(false)
        val appContext = ApplicationProvider.getApplicationContext<android.content.Context>()

        BackgroundExecutionService.start(appContext)

        val shadowApp = Shadows.shadowOf(appContext as android.app.Application)
        val started = shadowApp.nextStartedService
        assertNotNull("Expected startService intent on pre-O", started)
        assertEquals(BackgroundExecutionService::class.java.name, started?.component?.className)
    }

    @Test
    @Config(sdk = [Build.VERSION_CODES.N])
    fun updateDueAtUsesStartServiceOnPreO() {
        val appContext = ApplicationProvider.getApplicationContext<android.content.Context>()

        BackgroundExecutionService.updateDueAt(appContext, System.currentTimeMillis() + 10_000L)

        val shadowApp = Shadows.shadowOf(appContext as android.app.Application)
        val started = shadowApp.nextStartedService
        assertNotNull("Expected updateDueAt to start service on pre-O", started)
        assertEquals(
            BackgroundExecutionService.ACTION_UPDATE_DUE_AT,
            started?.action,
        )
    }

    @Test
    fun updateDueAtNullDoesNotStartStoppedService() {
        val appContext = ApplicationProvider.getApplicationContext<android.content.Context>()

        BackgroundExecutionService.updateDueAt(appContext, null)

        assertFalse("Stopped service should remain stopped after clearing dueAt", BackgroundExecutionService.isRunning)
        val shadowApp = Shadows.shadowOf(appContext as android.app.Application)
        assertNull("Expected no service start for a stopped-service dueAt clear", shadowApp.nextStartedService)
    }

    @Test
    fun updateDueAtNullDuringPendingStartQueuesClearIntent() {
        val appContext = ApplicationProvider.getApplicationContext<android.content.Context>()

        BackgroundExecutionService.start(appContext)
        val shadowApp = Shadows.shadowOf(appContext as android.app.Application)
        assertNotNull("Expected initial start intent", shadowApp.nextStartedService)

        BackgroundExecutionService.updateDueAt(appContext, null)

        val clearIntent = shadowApp.nextStartedService
        assertNotNull("Expected dueAt clear intent while start is pending", clearIntent)
        assertEquals(BackgroundExecutionService.ACTION_UPDATE_DUE_AT, clearIntent?.action)
    }

    @Test
    fun staleQueuedStartAfterStopDoesNotStartService() {
        val appContext = ApplicationProvider.getApplicationContext<android.content.Context>()

        BackgroundExecutionService.start(appContext)
        val startIntent = Shadows.shadowOf(appContext as android.app.Application).nextStartedService
        assertNotNull("Expected initial start intent", startIntent)

        BackgroundExecutionService.stop(appContext)
        controller.create()
        service.onStartCommand(startIntent, 0, 1)

        assertFalse("Stale start intent should not leave service running", BackgroundExecutionService.isRunning)
    }

    @Test
    fun updateDueAtUpdatesRunningServiceWithoutRestartingForegroundService() {
        controller.create()
        startService()
        val appContext = ApplicationProvider.getApplicationContext<android.content.Context>()
        val dueAtMs = System.currentTimeMillis() + 10_000L

        BackgroundExecutionService.updateDueAt(appContext, dueAtMs)
        ShadowLooper.shadowMainLooper().idle()

        assertEquals(dueAtMs, getPrivateField("dueAtMs"))
        val shadowApp = Shadows.shadowOf(appContext as android.app.Application)
        assertNull("Expected no new started service intent when service is already running", shadowApp.nextStartedService)
    }

    @Test
    fun updateDueAtInternalFiresBroadcastWhenDueIsInPast() {
        controller.create()
        startService()

        val update = Intent(BackgroundExecutionService.ACTION_UPDATE_DUE_AT)
        update.putExtra(BackgroundExecutionService.EXTRA_DUE_AT_MS, System.currentTimeMillis() - 10L)
        service.onStartCommand(update, 0, 1)

        ShadowLooper.shadowMainLooper().idleFor(50, TimeUnit.MILLISECONDS)

        val broadcasts = Shadows.shadowOf(service.application as android.app.Application).broadcastIntents
        val autoSkip = broadcasts.lastOrNull { it.action == BackgroundExecutionService.ACTION_AUTO_SKIP_DUE }
        assertNotNull("Expected auto-skip broadcast for past due value", autoSkip)
        assertTrue((autoSkip?.getLongExtra(BackgroundExecutionService.EXTRA_DUE_AT_MS, -1L) ?: -1L) > 0L)
        assertTrue((autoSkip?.getLongExtra(BackgroundExecutionService.EXTRA_FIRED_AT_MS, -1L) ?: -1L) > 0L)
    }
}
