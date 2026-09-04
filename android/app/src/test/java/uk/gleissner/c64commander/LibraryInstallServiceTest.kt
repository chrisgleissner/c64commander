/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.ComponentName
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.PowerManager
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
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
class LibraryInstallServiceTest {

    private lateinit var controller: ServiceController<LibraryInstallService>
    private lateinit var service: LibraryInstallService

    @Before
    fun setUp() {
        setIsRunning(false)
        controller = Robolectric.buildService(LibraryInstallService::class.java)
        service = controller.create().get()
    }

    @After
    fun tearDown() {
        try {
            controller.destroy()
        } catch (_: Exception) {
            // Already destroyed by the test.
        }
        setIsRunning(false)
    }

    private fun setIsRunning(value: Boolean) {
        val field = LibraryInstallService::class.java.getDeclaredField("isRunning")
        field.isAccessible = true
        field.set(null, value)
    }

    private fun heldWakeLock(): PowerManager.WakeLock? {
        val field = LibraryInstallService::class.java.getDeclaredField("wakeLock")
        field.isAccessible = true
        val wakeLock = field.get(service) as? PowerManager.WakeLock
        return if (wakeLock?.isHeld == true) wakeLock else null
    }

    private fun startService(startId: Int = 1): Int =
            service.onStartCommand(Intent(service, LibraryInstallService::class.java), 0, startId)

    @Test
    fun `an install holds a partial wake lock and a data-sync foreground notification`() {
        startService()

        assertTrue("the guard must report itself running", LibraryInstallService.isRunning)
        assertNotNull("an install without a wake lock is what dozes mid-download", heldWakeLock())

        val shadow = Shadows.shadowOf(service)
        assertNotNull(
                "the install must run in the foreground or the OS may reclaim it",
                shadow.lastForegroundNotification,
        )
        assertEquals(
                "a download declared as media playback is the wrong foreground service type",
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
                service.foregroundServiceType,
        )
    }

    @Test
    fun `the manifest declares the install guard as data sync and leaves playback its own type`() {
        val packageManager = ApplicationProvider.getApplicationContext<android.content.Context>().packageManager
        val packageName = ApplicationProvider.getApplicationContext<android.content.Context>().packageName

        val guard =
                packageManager.getServiceInfo(
                        ComponentName(packageName, LibraryInstallService::class.java.name),
                        0,
                )
        val playback =
                packageManager.getServiceInfo(
                        ComponentName(packageName, BackgroundExecutionService::class.java.name),
                        0,
                )

        assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC, guard.foregroundServiceType)
        assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK, playback.foregroundServiceType)
    }

    @Test
    fun `a refused foreground service stops the guard instead of leaving a wake lock behind`() {
        Shadows.shadowOf(service)
                .setThrowInStartForeground(IllegalStateException("mAllowStartForeground false"))

        val result = startService()

        assertEquals(android.app.Service.START_NOT_STICKY, result)
        assertFalse("a guard that never reached the foreground must not claim to be running", LibraryInstallService.isRunning)
        assertNull("a wake lock without a foreground service is the worst of both", heldWakeLock())
        assertTrue(Shadows.shadowOf(service).isStoppedBySelf)
    }

    @Test
    fun `the guard uses its own notification id so stopping it leaves playback alone`() {
        startService()

        assertEquals(2, Shadows.shadowOf(service).lastForegroundNotificationId)
    }

    @Test
    fun `destroying the service releases the wake lock`() {
        startService()
        assertNotNull(heldWakeLock())

        controller.destroy()

        assertNull("a wake lock left held after the install drains the battery", heldWakeLock())
        assertFalse(LibraryInstallService.isRunning)
    }

    @Test
    fun `a second start command does not stack a second wake lock`() {
        startService(startId = 1)
        val first = heldWakeLock()

        startService(startId = 2)

        assertSame(first, heldWakeLock())
    }

    @Test
    fun `the guard does not restart itself after the process that was installing died`() {
        assertEquals(android.app.Service.START_NOT_STICKY, startService())
    }
}
