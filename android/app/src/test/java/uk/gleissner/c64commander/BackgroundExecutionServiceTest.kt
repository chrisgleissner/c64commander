/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Intent
import android.media.session.MediaSession
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

    private fun setPlaybackState(paused: Boolean, startId: Int = 1) {
        val intent = Intent(BackgroundExecutionService.ACTION_SET_PLAYBACK_STATE)
        intent.putExtra(BackgroundExecutionService.EXTRA_PAUSED, paused)
        service.onStartCommand(intent, 0, startId)
    }

    private fun heldWakeLock(): android.os.PowerManager.WakeLock? {
        val wakeLock = getPrivateField("wakeLock") as? android.os.PowerManager.WakeLock
        return if (wakeLock?.isHeld == true) wakeLock else null
    }

    // Same reflection route as mediaSessionIsGivenACallback: Robolectric's MediaController is not
    // wired to the session, so the state the service published is only visible on the field.
    private fun playbackStateOf(session: MediaSession?): Int {
        val field = MediaSession::class.java.getDeclaredField("mPlaybackState")
        field.isAccessible = true
        val state = field.get(session) as android.media.session.PlaybackState?
        assertNotNull("Expected the session to advertise a playback state", state)
        return state!!.state
    }

    private fun notificationId(): Int {
        val field = BackgroundExecutionService::class.java.getDeclaredField("NOTIFICATION_ID")
        field.isAccessible = true
        return field.getInt(null)
    }

    private fun currentNotificationText(): String? {
        val manager = service.getSystemService(android.app.NotificationManager::class.java)
        val notification =
                Shadows.shadowOf(manager).getNotification(notificationId())
                        ?: Shadows.shadowOf(service).lastForegroundNotification
        return notification?.extras?.getCharSequence(android.app.Notification.EXTRA_TEXT)?.toString()
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
    fun companionStartSendsFreshIntentEvenWhenAlreadyRunning() {
        // HARD20-007: the old `if (isRunning) return` fast path swallowed a
        // start racing asynchronous stop destruction. start() now always
        // sends a fresh-generation intent; onStartCommand's staleness check
        // makes the genuinely-already-running case safe.
        setIsRunning(true)
        val appContext = ApplicationProvider.getApplicationContext<android.content.Context>()

        BackgroundExecutionService.start(appContext)

        val shadowApp = Shadows.shadowOf(appContext as android.app.Application)
        val startIntent = shadowApp.nextStartedService
        assertNotNull(
            "HARD20-007: start() must send a fresh intent even when isRunning is true",
            startIntent,
        )
        assertEquals(BackgroundExecutionService::class.java.name, startIntent?.component?.className)
        val generation = startIntent?.getLongExtra(BackgroundExecutionService.EXTRA_COMMAND_GENERATION, 0L) ?: 0L
        assertTrue("HARD20-007: racing start must carry a fresh generation", generation > 0L)
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
    fun nullIntentStickyRestartSatisfiesForegroundContractBeforeStopping() {
        controller.create()

        service.onStartCommand(null, 0, 1)

        // On O+, this dispatch may have originated from startForegroundService(); failing to
        // call startForeground() before stopping risks a RemoteServiceException crash
        // (HARD9-042). A throwaway notification satisfies the contract, then is torn back down —
        // ShadowService.stopForeground(true) clears lastForegroundNotification but not
        // lastForegroundNotificationId, so checking the id (>0 = startForeground was called)
        // together with isForegroundStopped proves the full sequence ran.
        val shadowService = Shadows.shadowOf(service)
        assertTrue(
            "Null sticky-restart dispatch must call startForeground before stopping",
            shadowService.lastForegroundNotificationId > 0,
        )
        assertTrue("Foreground must be torn back down immediately", shadowService.isForegroundStopped)
    }

    @Test
    fun staleGenerationIntentSatisfiesForegroundContractBeforeStopping() {
        controller.create()
        setCompanionField("commandGeneration", 5L)

        val staleIntent = Intent(service, BackgroundExecutionService::class.java)
        staleIntent.putExtra(BackgroundExecutionService.EXTRA_COMMAND_GENERATION, 3L)
        val result = service.onStartCommand(staleIntent, 0, 1)

        assertEquals(android.app.Service.START_NOT_STICKY, result)
        val shadowService = Shadows.shadowOf(service)
        assertTrue(
            "Stale-generation dispatch must call startForeground before stopping (HARD9-042)",
            shadowService.lastForegroundNotificationId > 0,
        )
        assertTrue("Foreground must be torn back down immediately", shadowService.isForegroundStopped)
        assertFalse(BackgroundExecutionService.isRunning)
    }

    @Test
    fun staleGenerationIntentWhileAlreadyRunningDoesNotTearDownActiveNotification() {
        controller.create()
        startService()
        assertTrue(BackgroundExecutionService.isRunning)

        val shadowService = Shadows.shadowOf(service)
        assertNotNull("Expected the running service to already show a notification", shadowService.lastForegroundNotification)
        assertFalse("Should not have stopped foreground yet", shadowService.isForegroundStopped)

        setCompanionField("commandGeneration", 5L)
        val staleIntent = Intent(service, BackgroundExecutionService::class.java)
        staleIntent.putExtra(BackgroundExecutionService.EXTRA_COMMAND_GENERATION, 3L)
        service.onStartCommand(staleIntent, 0, 2)

        // A stale intent for an ALREADY-running service must not tear down the active
        // notification out from under it - the foreground contract is already satisfied.
        assertFalse(
            "A stale intent for an already-running service must not stop the active foreground notification",
            shadowService.isForegroundStopped,
        )
        assertTrue("Service should remain running", BackgroundExecutionService.isRunning)
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
    fun notificationTitleUsesAppNameResourceInsteadOfHardcodedBranding() {
        controller.create()
        startService()

        val shadowService = Shadows.shadowOf(service)
        val notification = shadowService.lastForegroundNotification
        assertNotNull("Expected an active foreground notification", notification)
        val title = notification?.extras?.getCharSequence(android.app.Notification.EXTRA_TITLE)?.toString()
        assertEquals(
            "Notification title must use the app_name resource so C64U Remote is not mis-branded as C64 Commander (HARD11-005)",
            service.getString(R.string.app_name),
            title,
        )
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
    fun updateDueAtUsesStartServiceOnPreOWhenStartIsPending() {
        val appContext = ApplicationProvider.getApplicationContext<android.content.Context>()

        // A non-null dueAt update only forwards while a start() is genuinely
        // pending (HARD9-041) — mirrors updateDueAtNullDuringPendingStartQueuesClearIntent.
        BackgroundExecutionService.start(appContext)
        val shadowApp = Shadows.shadowOf(appContext as android.app.Application)
        assertNotNull("Expected initial start intent", shadowApp.nextStartedService)

        BackgroundExecutionService.updateDueAt(appContext, System.currentTimeMillis() + 10_000L)

        val started = shadowApp.nextStartedService
        assertNotNull("Expected updateDueAt to forward via startService on pre-O while a start is pending", started)
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
    fun updateDueAtNonNullDoesNotStartStoppedService() {
        val appContext = ApplicationProvider.getApplicationContext<android.content.Context>()

        BackgroundExecutionService.updateDueAt(appContext, System.currentTimeMillis() + 10_000L)

        assertFalse("Stopped service should remain stopped after a dueAt update (HARD9-041)", BackgroundExecutionService.isRunning)
        val shadowApp = Shadows.shadowOf(appContext as android.app.Application)
        assertNull("Expected no service start for a stopped-service dueAt update", shadowApp.nextStartedService)
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
    fun startRacingStopDestructionRestoresRunningServiceWithWakeLock() {
        // HARD20-007: stop() resolves before onDestroy flips isRunning=false,
        // so a start() issued in that window used to see isRunning=true and
        // return early (the old `if (isRunning) return` fast path). The
        // subsequent destroy then left the session with no foreground service
        // and no wake lock. The fix always sends a fresh-generation start
        // intent; this test reproduces the race and verifies the service ends
        // up RUNNING with a wake lock held.
        val appContext = ApplicationProvider.getApplicationContext<android.content.Context>()

        // Bring the service up under a real start intent.
        BackgroundExecutionService.start(appContext)
        val initialStart = Shadows.shadowOf(appContext as android.app.Application).nextStartedService
        assertNotNull("Expected initial start intent", initialStart)
        controller.create()
        service.onStartCommand(initialStart, 0, 1)
        assertTrue("Service should be running after initial start", BackgroundExecutionService.isRunning)

        // stop() queues onDestroy; start() races it BEFORE the looper runs the
        // destroy. Both companion calls resolve synchronously, but onDestroy
        // only fires when we drive controller.destroy() below.
        BackgroundExecutionService.stop(appContext)
        BackgroundExecutionService.start(appContext)
        val racingStart = Shadows.shadowOf(appContext as android.app.Application).nextStartedService
        assertNotNull(
            "HARD20-007: start() racing stop destruction must send a fresh intent",
            racingStart,
        )
        val racingGeneration = racingStart?.getLongExtra(BackgroundExecutionService.EXTRA_COMMAND_GENERATION, 0L) ?: 0L
        assertTrue(
            "HARD20-007: racing start must carry a fresh generation",
            racingGeneration > 0L,
        )

        // Now the async destroy processes. The old code would leave isRunning
        // false here with no intent to bring the service back (the racing
        // start was swallowed by the isRunning fast path).
        controller.destroy()
        assertFalse("Destroy should have torn down the old service", BackgroundExecutionService.isRunning)

        // The racing start intent must restart the service and acquire a fresh
        // wake lock — the exact invariant the race used to lose.
        controller = Robolectric.buildService(BackgroundExecutionService::class.java)
        service = controller.get()
        controller.create()
        service.onStartCommand(racingStart, 0, 2)
        assertTrue(
            "HARD20-007: racing start must leave the service running after destroy processes",
            BackgroundExecutionService.isRunning,
        )

        val wakeLockField = BackgroundExecutionService::class.java.getDeclaredField("wakeLock")
        wakeLockField.isAccessible = true
        val wakeLock = wakeLockField.get(service) as? android.os.PowerManager.WakeLock
        assertNotNull(
            "HARD20-007: racing start must acquire a wake lock",
            wakeLock,
        )
        assertTrue(
            "HARD20-007: racing start's wake lock must be held",
            wakeLock?.isHeld == true,
        )
    }

    @Test
    fun updateDueAtNonNullAfterStopDoesNotResurrectService() {
        val appContext = ApplicationProvider.getApplicationContext<android.content.Context>()

        // Start and let the service actually come up.
        BackgroundExecutionService.start(appContext)
        val startIntent = Shadows.shadowOf(appContext as android.app.Application).nextStartedService
        assertNotNull("Expected initial start intent", startIntent)
        controller.create()
        service.onStartCommand(startIntent, 0, 1)
        assertTrue(BackgroundExecutionService.isRunning)

        // Stop bumps commandGeneration and clears the pending-start generation.
        BackgroundExecutionService.stop(appContext)
        controller.destroy()
        assertFalse(BackgroundExecutionService.isRunning)

        // A queued auto-advance due update (JS's async latest-intent lane) flushes
        // late, after the app already believes background execution is off.
        BackgroundExecutionService.updateDueAt(appContext, System.currentTimeMillis() + 30_000L)

        val shadowApp = Shadows.shadowOf(appContext as android.app.Application)
        assertNull(
            "A non-null dueAt update after stop must not resurrect the foreground service (HARD9-041)",
            shadowApp.nextStartedService,
        )
        assertFalse(BackgroundExecutionService.isRunning)
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

    @Test
    fun autoSkipBroadcastIsAddressedToThisPackage() {
        controller.create()
        startService()

        val update = Intent(BackgroundExecutionService.ACTION_UPDATE_DUE_AT)
        update.putExtra(BackgroundExecutionService.EXTRA_DUE_AT_MS, System.currentTimeMillis() - 10L)
        service.onStartCommand(update, 0, 1)

        ShadowLooper.shadowMainLooper().idleFor(50, TimeUnit.MILLISECONDS)

        val broadcasts = Shadows.shadowOf(service.application as android.app.Application).broadcastIntents
        val autoSkip = broadcasts.lastOrNull { it.action == BackgroundExecutionService.ACTION_AUTO_SKIP_DUE }
        assertNotNull("Expected auto-skip broadcast for past due value", autoSkip)
        // An implicit broadcast is enqueued and then dropped without ever being
        // dispatched to the plugin's runtime receiver, so the auto-skip is lost.
        assertEquals(
                "Auto-skip broadcast must name this package so it is not implicit",
                service.packageName,
                autoSkip?.getPackage()
        )
    }

    @Test
    fun mediaSessionIsGivenACallback() {
        controller.create()
        startService()

        val session = getPrivateField("mediaSession") as MediaSession?
        assertNotNull("Expected a MediaSession once the service is running", session)
        // Without a callback the platform never makes this the media-button session, so a headset
        // or lock-screen press reaches nothing. MediaSession keeps the callback in mCallback;
        // a null one means setCallback() was never called.
        val callbackField = MediaSession::class.java.getDeclaredField("mCallback")
        callbackField.isAccessible = true
        assertNotNull("MediaSession must have a callback to receive media buttons", callbackField.get(session))
    }

    @Test
    fun mediaSessionCallbackBroadcastsEachTransportCommand() {
        controller.create()
        startService()
        val shadowApp = Shadows.shadowOf(service.application as android.app.Application)

        service.mediaSessionCallback.onPlay()
        service.mediaSessionCallback.onPause()
        service.mediaSessionCallback.onStop()

        val commands =
                shadowApp.broadcastIntents
                        .filter { it.action == BackgroundExecutionService.ACTION_TRANSPORT_COMMAND }
        assertEquals(
                listOf(
                        BackgroundExecutionService.TRANSPORT_COMMAND_PLAY,
                        BackgroundExecutionService.TRANSPORT_COMMAND_PLAY_PAUSE,
                        BackgroundExecutionService.TRANSPORT_COMMAND_STOP,
                ),
                commands.map { it.getStringExtra(BackgroundExecutionService.EXTRA_TRANSPORT_COMMAND) },
        )
        assertTrue(
                "Transport broadcasts must name this package so they are not implicit",
                commands.all { it.getPackage() == service.packageName },
        )
    }

    @Test
    fun pauseKeepsTheMediaSessionAliveSoHeadsetPlayStillReachesTheWebLayer() {
        // HARD27-007: pausing used to stop the service, which released the MediaSession. The
        // headset or lock-screen Play that followed reached nothing and the user had to unlock the
        // phone and press Play in the app.
        controller.create()
        startService()
        val shadowApp = Shadows.shadowOf(service.application as android.app.Application)

        setPlaybackState(paused = true)

        assertTrue("A paused session must keep its service", BackgroundExecutionService.isRunning)
        val session = getPrivateField("mediaSession") as MediaSession?
        assertNotNull("A paused session must keep its MediaSession", session)
        assertEquals(
                "A paused session must advertise STATE_PAUSED",
                android.media.session.PlaybackState.STATE_PAUSED,
                playbackStateOf(session),
        )

        service.mediaSessionCallback.onPlay()

        val commands =
                shadowApp.broadcastIntents
                        .filter { it.action == BackgroundExecutionService.ACTION_TRANSPORT_COMMAND }
        assertEquals(
                "Headset Play after a pause must still reach the web layer",
                listOf(BackgroundExecutionService.TRANSPORT_COMMAND_PLAY),
                commands.map { it.getStringExtra(BackgroundExecutionService.EXTRA_TRANSPORT_COMMAND) },
        )
    }

    @Test
    fun pauseReleasesTheWakeLockAndResumeReacquiresIt() {
        // The wake lock is the resource a pause must give back; the notification and session are
        // what it must keep.
        controller.create()
        startService()
        assertNotNull("Expected a held wake lock while playing", heldWakeLock())

        setPlaybackState(paused = true)
        assertNull("A paused session must not hold a wake lock", heldWakeLock())
        assertTrue("A paused session must keep its service", BackgroundExecutionService.isRunning)

        setPlaybackState(paused = false, startId = 2)
        assertNotNull("Resuming must re-acquire the wake lock", heldWakeLock())
        val session = getPrivateField("mediaSession") as MediaSession?
        assertEquals(
                android.media.session.PlaybackState.STATE_PLAYING,
                playbackStateOf(session),
        )
    }

    @Test
    fun pausedNotificationSaysPausedAndSaysPlayingAgainOnResume() {
        controller.create()
        startService()

        setPlaybackState(paused = true)
        assertEquals("Playback paused", currentNotificationText())

        setPlaybackState(paused = false, startId = 2)
        assertEquals("Playback active", currentNotificationText())
    }

    @Test
    fun pausedSessionStopsItselfOnceTheGracePeriodElapses() {
        // The grace period bounds the notification: a session paused and forgotten must not keep a
        // foreground service alive indefinitely.
        controller.create()
        startService()
        setPlaybackState(paused = true)

        ShadowLooper.shadowMainLooper()
                .idleFor(BackgroundExecutionService.PAUSED_GRACE_PERIOD_MS - 1_000L, TimeUnit.MILLISECONDS)
        assertFalse(
                "A session paused inside the grace period must not have stopped itself",
                Shadows.shadowOf(service).isStoppedBySelf,
        )

        ShadowLooper.shadowMainLooper().idleFor(2_000L, TimeUnit.MILLISECONDS)
        assertTrue(
                "A paused session must stop itself once the grace period elapses",
                Shadows.shadowOf(service).isStoppedBySelf,
        )
    }

    @Test
    fun resumingInsideTheGracePeriodCancelsTheExpiry() {
        controller.create()
        startService()
        setPlaybackState(paused = true)

        setPlaybackState(paused = false, startId = 2)
        ShadowLooper.shadowMainLooper()
                .idleFor(BackgroundExecutionService.PAUSED_GRACE_PERIOD_MS * 2, TimeUnit.MILLISECONDS)

        assertFalse(
                "A resumed session must not be stopped by the pause it already left",
                Shadows.shadowOf(service).isStoppedBySelf,
        )
        assertTrue(BackgroundExecutionService.isRunning)
    }

    @Test
    fun companionPauseUpdatesTheRunningServiceWithoutRestartingIt() {
        controller.create()
        startService()
        setRunningInstance(service)
        val appContext = ApplicationProvider.getApplicationContext<android.content.Context>()

        BackgroundExecutionService.setPlaybackState(appContext, true)
        ShadowLooper.shadowMainLooper().idle()

        assertNull(
                "A pause for an already-running service must not send a service intent",
                Shadows.shadowOf(appContext as android.app.Application).nextStartedService,
        )
        assertNull("The running service must have released its wake lock", heldWakeLock())
    }

    @Test
    fun companionPauseDoesNotStartAStoppedService() {
        val appContext = ApplicationProvider.getApplicationContext<android.content.Context>()

        BackgroundExecutionService.setPlaybackState(appContext, true)

        assertFalse(BackgroundExecutionService.isRunning)
        assertNull(
                "A pause with no session has nothing to keep alive",
                Shadows.shadowOf(appContext as android.app.Application).nextStartedService,
        )
    }

    @Test
    fun companionResumeAfterTheGracePeriodStartsAFreshService() {
        // The service stopped itself when the grace period elapsed, but the web layer still owns
        // the session, so a resume has to bring the service back rather than play with no wake lock.
        val appContext = ApplicationProvider.getApplicationContext<android.content.Context>()

        BackgroundExecutionService.setPlaybackState(appContext, false)

        val started = Shadows.shadowOf(appContext as android.app.Application).nextStartedService
        assertNotNull("Resuming with no running service must start one", started)
        assertEquals(BackgroundExecutionService::class.java.name, started?.component?.className)
    }

    @Test
    fun pauseDuringAPendingStartIsForwardedWithThatStartsGeneration() {
        // Mirrors updateDueAt: a pause issued while start() is still in flight must reach the
        // service that is coming up, not be dropped, or it would come up holding a wake lock.
        val appContext = ApplicationProvider.getApplicationContext<android.content.Context>()
        BackgroundExecutionService.start(appContext)
        val shadowApp = Shadows.shadowOf(appContext as android.app.Application)
        val startIntent = shadowApp.nextStartedService
        assertNotNull("Expected initial start intent", startIntent)
        val startGeneration = startIntent?.getLongExtra(BackgroundExecutionService.EXTRA_COMMAND_GENERATION, 0L)

        BackgroundExecutionService.setPlaybackState(appContext, true)

        val pauseIntent = shadowApp.nextStartedService
        assertNotNull("Expected the pause to be forwarded while a start is pending", pauseIntent)
        assertEquals(BackgroundExecutionService.ACTION_SET_PLAYBACK_STATE, pauseIntent?.action)
        assertTrue(pauseIntent?.getBooleanExtra(BackgroundExecutionService.EXTRA_PAUSED, false) == true)
        assertEquals(
                startGeneration,
                pauseIntent?.getLongExtra(BackgroundExecutionService.EXTRA_COMMAND_GENERATION, 0L),
        )
    }
}
