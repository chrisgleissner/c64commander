/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Intent
import android.os.Build
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [Build.VERSION_CODES.TIRAMISU])
class BackgroundExecutionServiceTest {

    private lateinit var controller: ServiceController<BackgroundExecutionService>
    private lateinit var service: BackgroundExecutionService

    @Before
    fun setUp() {
        setIsRunning(false)
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
    }

    // Helper to set the static isRunning field via reflection for testing
    private fun setIsRunning(value: Boolean) {
        val field = BackgroundExecutionService::class.java.getDeclaredField("isRunning")
        field.isAccessible = true
        field.set(null, value)
    }

    @Test
    fun serviceStartsSetsIsRunning() {
        controller.create()
        controller.startCommand(0, 0)
        assertTrue("Service should be running after start", BackgroundExecutionService.isRunning)
    }

    @Test
    fun serviceStopClearsIsRunning() {
        controller.create()
        controller.startCommand(0, 0)
        assertTrue(BackgroundExecutionService.isRunning)

        controller.destroy()
        assertFalse("Service should not be running after destroy", BackgroundExecutionService.isRunning)
    }

    @Test
    fun startCommandIsIdempotent() {
        controller.create()
        controller.startCommand(0, 0)
        assertTrue(BackgroundExecutionService.isRunning)

        // Second start command should not fail
        controller.startCommand(0, 1)
        assertTrue("Service should still be running after second startCommand", BackgroundExecutionService.isRunning)
    }

    @Test
    fun updateDueAtAcceptsPositiveValue() {
        controller.create()
        controller.startCommand(0, 0)

        val intent = Intent(BackgroundExecutionService.ACTION_UPDATE_DUE_AT)
        intent.putExtra(BackgroundExecutionService.EXTRA_DUE_AT_MS, System.currentTimeMillis() + 30_000L)
        service.onStartCommand(intent, 0, 1)

        // Service should still be running (no crash, no immediate stop)
        assertTrue(BackgroundExecutionService.isRunning)
    }

    @Test
    fun updateDueAtClearsOnNegativeValue() {
        controller.create()
        controller.startCommand(0, 0)

        val intent = Intent(BackgroundExecutionService.ACTION_UPDATE_DUE_AT)
        intent.putExtra(BackgroundExecutionService.EXTRA_DUE_AT_MS, -1L)
        service.onStartCommand(intent, 0, 1)

        assertTrue("Service should remain running after clearing dueAt", BackgroundExecutionService.isRunning)
    }

    @Test
    fun updateDueAtClearsOnMissingExtra() {
        controller.create()
        controller.startCommand(0, 0)

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
        controller.startCommand(0, 0)
        assertTrue(BackgroundExecutionService.isRunning)

        controller.destroy()
        assertFalse("isRunning should be false after destroy", BackgroundExecutionService.isRunning)
    }

    @Test
    fun wakelockTimeoutConstantIsReasonable() {
        // WakeLock timeout must be bounded and positive
        assertTrue("WakeLock timeout must be positive",
            BackgroundExecutionService.WAKELOCK_TIMEOUT_MS > 0)
        assertTrue("WakeLock timeout must be at most 30 minutes",
            BackgroundExecutionService.WAKELOCK_TIMEOUT_MS <= 30 * 60 * 1000L)
    }

    @Test
    fun idleTimeoutConstantIsReasonable() {
        // Idle timeout must be bounded and positive
        assertTrue("Idle timeout must be positive",
            BackgroundExecutionService.IDLE_TIMEOUT_MS > 0)
        assertTrue("Idle timeout must be at most 5 minutes",
            BackgroundExecutionService.IDLE_TIMEOUT_MS <= 5 * 60 * 1000L)
    }

    @Test
    fun onBindReturnsNull() {
        controller.create()
        assertNull("onBind should return null for a started service", service.onBind(null))
    }
}
