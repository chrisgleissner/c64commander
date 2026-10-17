/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.app.Notification
import android.content.Context
import android.content.Intent
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import androidx.test.core.app.ApplicationProvider
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper

class PlaybackLivenessTest {
    @Test
    fun aHeartbeatKeepsTheSessionLiveUntilTheTimeoutAfterIt() {
        val liveness = PlaybackLiveness(heartbeatTimeoutMs = 15_000L)
        liveness.onHeartbeat(1_000L)

        assertFalse(liveness.isStale(15_999L))
        assertTrue(liveness.isStale(16_000L))
    }

    @Test
    fun aLaterHeartbeatMovesTheDeadline() {
        val liveness = PlaybackLiveness(heartbeatTimeoutMs = 15_000L)
        liveness.onHeartbeat(0L)
        liveness.onHeartbeat(10_000L)

        assertFalse(liveness.isStale(24_000L))
        assertEquals(1_000L, liveness.msUntilStale(24_000L))
    }

    @Test
    fun aDestroyedActivityShortensTheDeadlineToTheGracePeriod() {
        val liveness = PlaybackLiveness(heartbeatTimeoutMs = 15_000L, activityGoneGraceMs = 3_000L)
        liveness.onHeartbeat(0L)
        liveness.onActivityGone(5_000L)

        assertFalse(liveness.isStale(7_999L))
        assertTrue(liveness.isStale(8_000L))
    }

    @Test
    fun aHeartbeatFromARecreatedActivityCancelsTheGracePeriod() {
        val liveness = PlaybackLiveness(heartbeatTimeoutMs = 15_000L, activityGoneGraceMs = 3_000L)
        liveness.onHeartbeat(0L)
        liveness.onActivityGone(5_000L)
        liveness.onHeartbeat(6_000L)

        assertFalse(liveness.isStale(8_000L))
        assertTrue(liveness.isStale(21_000L))
    }

    @Test
    fun theGracePeriodNeverExtendsTheHeartbeatTimeout() {
        val liveness = PlaybackLiveness(heartbeatTimeoutMs = 15_000L, activityGoneGraceMs = 3_000L)
        liveness.onHeartbeat(0L)
        liveness.onActivityGone(14_000L)

        assertTrue(liveness.isStale(15_000L))
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [Build.VERSION_CODES.TIRAMISU])
class ResumeRequestGateTest {
    private class MemoryStore : ResumeNonceStore {
        var nonce: Long? = null

        override fun read(): Long? = nonce

        override fun write(nonce: Long) {
            this.nonce = nonce
        }
    }

    private fun intentWith(command: String?, nonce: Long?): Intent {
        val intent = Intent()
        if (command != null) intent.putExtra(ResumeRequest.EXTRA_TRANSPORT_COMMAND, command)
        if (nonce != null) intent.putExtra(ResumeRequest.EXTRA_NONCE, nonce)
        return intent
    }

    @Test
    fun aResumeRequestIsAcceptedOnce() {
        val gate = ResumeRequestGate(MemoryStore())
        val intent = intentWith("play", 42L)

        assertEquals("play", gate.accept(intent))
        assertNull("The same launch intent handed back by a recreation must not resume again", gate.accept(intent))
    }

    @Test
    fun aNewerRequestIsAcceptedAfterAnOlderOne() {
        val gate = ResumeRequestGate(MemoryStore())
        gate.accept(intentWith("play", 1L))

        assertEquals("play", gate.accept(intentWith("play", 2L)))
    }

    @Test
    fun anIntentWithoutARequestIsIgnored() {
        val gate = ResumeRequestGate(MemoryStore())

        assertNull(gate.accept(null))
        assertNull(gate.accept(Intent()))
        assertNull(gate.accept(intentWith("play", null)))
        assertNull(gate.accept(intentWith(null, 7L)))
    }

    @Test
    fun theAcceptedNonceSurvivesAGateRecreatedAfterProcessDeath() {
        val store = MemoryStore()
        ResumeRequestGate(store).accept(intentWith("play", 9L))

        assertNull(ResumeRequestGate(store).accept(intentWith("play", 9L)))
    }

    @Test
    fun aPendingCommandIsTakenOnce() {
        PendingResumeCommand.take()
        PendingResumeCommand.offer("play")

        assertEquals("play", PendingResumeCommand.take())
        assertNull(PendingResumeCommand.take())
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [Build.VERSION_CODES.TIRAMISU], shadows = [RecordingMediaSessionShadow::class])
class BackgroundExecutionLivenessTest {
    private lateinit var controller: ServiceController<BackgroundExecutionService>
    private lateinit var service: BackgroundExecutionService

    private fun setStatic(name: String, value: Any?) {
        val field = BackgroundExecutionService::class.java.getDeclaredField(name)
        field.isAccessible = true
        field.set(null, value)
    }

    @Before
    fun setUp() {
        setStatic("isRunning", false)
        setStatic("runningInstance", null)
        setStatic("commandGeneration", 0L)
        setStatic("startPendingGeneration", null)
        controller = Robolectric.buildService(BackgroundExecutionService::class.java)
        service = controller.get()
        controller.create()
        service.onStartCommand(Intent(service, BackgroundExecutionService::class.java), 0, 1)
    }

    @After
    fun tearDown() {
        try {
            controller.destroy()
        } catch (_: Exception) {
            // Already destroyed by the test.
        }
        setStatic("isRunning", false)
        setStatic("runningInstance", null)
    }

    private fun idle(ms: Long) = ShadowLooper.shadowMainLooper().idleFor(ms, TimeUnit.MILLISECONDS)

    private fun sessionState(): Int {
        val session = service.javaClass.getDeclaredField("mediaSession").apply { isAccessible = true }.get(service)
        val field = MediaSession::class.java.getDeclaredField("mPlaybackState")
        field.isAccessible = true
        return (field.get(session) as PlaybackState).state
    }

    private fun notification(): Notification {
        idle(BackgroundExecutionService.NOTIFICATION_COALESCE_MS)
        val manager = service.getSystemService(android.app.NotificationManager::class.java)
        return Shadows.shadowOf(manager).allNotifications.lastOrNull()
                ?: Shadows.shadowOf(service).lastForegroundNotification
    }

    private fun heartbeat() {
        BackgroundExecutionService.noteHeartbeat()
        idle(1L)
    }

    @Test
    fun aSessionWhoseWebLayerStopsReportingShowsPausedAfterTheTimeout() {
        assertEquals(PlaybackState.STATE_PLAYING, sessionState())

        idle(PlaybackLiveness.HEARTBEAT_TIMEOUT_MS - 1_000L)
        assertEquals(PlaybackState.STATE_PLAYING, sessionState())

        idle(2_000L)
        assertEquals(PlaybackState.STATE_PAUSED, sessionState())
    }

    @Test
    fun heartbeatsKeepAPlayingSessionPlayingPastTheTimeout() {
        repeat(6) {
            idle(PlaybackLiveness.HEARTBEAT_TIMEOUT_MS / 3)
            heartbeat()
        }

        assertEquals(PlaybackState.STATE_PLAYING, sessionState())
    }

    @Test
    fun aDestroyedActivityShowsPausedWithinTheGracePeriodWithoutWaitingForTheTimeout() {
        BackgroundExecutionService.noteActivityGone()
        idle(PlaybackLiveness.ACTIVITY_GONE_GRACE_MS + 500L)

        assertEquals(PlaybackState.STATE_PAUSED, sessionState())
    }

    @Test
    fun aRecreatedActivityThatReportsInsideTheGracePeriodStaysPlaying() {
        BackgroundExecutionService.noteActivityGone()
        idle(1_000L)
        heartbeat()
        idle(PlaybackLiveness.ACTIVITY_GONE_GRACE_MS)

        assertEquals(PlaybackState.STATE_PLAYING, sessionState())
    }

    @Test
    fun aHeartbeatAfterGoingStaleRestoresPlaying() {
        idle(PlaybackLiveness.HEARTBEAT_TIMEOUT_MS + 500L)
        assertEquals(PlaybackState.STATE_PAUSED, sessionState())

        heartbeat()

        assertEquals(PlaybackState.STATE_PLAYING, sessionState())
    }

    @Test
    fun aSessionTheWebLayerPausedIsNotMadeStaleOrRevivedByTheWatchdog() {
        val pause = Intent(BackgroundExecutionService.ACTION_SET_PLAYBACK_STATE)
        pause.putExtra(BackgroundExecutionService.EXTRA_PAUSED, true)
        service.onStartCommand(pause, 0, 2)

        idle(PlaybackLiveness.HEARTBEAT_TIMEOUT_MS + 500L)
        heartbeat()

        assertEquals(PlaybackState.STATE_PAUSED, sessionState())
    }

    @Test
    fun theStaleNotificationOffersPlayThatStartsTheActivityWithAResumeRequest() {
        idle(PlaybackLiveness.HEARTBEAT_TIMEOUT_MS + 500L)

        val actions = notification().actions
        assertEquals(listOf("Play", "Stop"), actions.map { it.title.toString() })
        val shadow = Shadows.shadowOf(actions[0].actionIntent)
        assertTrue("Play must start an activity, not broadcast to a gone web layer", shadow.isActivityIntent)
        val intent = shadow.savedIntent
        assertEquals(MainActivity::class.java.name, intent.component?.className)
        assertEquals(
                BackgroundExecutionService.TRANSPORT_COMMAND_PLAY,
                intent.getStringExtra(ResumeRequest.EXTRA_TRANSPORT_COMMAND),
        )
        assertTrue(intent.hasExtra(ResumeRequest.EXTRA_NONCE))
    }

    @Test
    fun tappingTheStaleNotificationAlsoRequestsAResume() {
        idle(PlaybackLiveness.HEARTBEAT_TIMEOUT_MS + 500L)

        val shadow = Shadows.shadowOf(notification().contentIntent)
        assertTrue(shadow.isActivityIntent)
        assertNotNull(shadow.savedIntent.getStringExtra(ResumeRequest.EXTRA_TRANSPORT_COMMAND))
    }

    @Test
    fun aLiveNotificationStillBroadcastsItsTransportCommands() {
        val shadow = Shadows.shadowOf(notification().actions[0].actionIntent)

        assertTrue(shadow.isBroadcastIntent)
    }

    @Test
    fun aMediaButtonPlayWhileStaleStartsTheResumeActivityInsteadOfBroadcasting() {
        idle(PlaybackLiveness.HEARTBEAT_TIMEOUT_MS + 500L)
        val context = ApplicationProvider.getApplicationContext<Context>()
        Shadows.shadowOf(context as android.app.Application).clearBroadcastIntents()

        service.mediaSessionCallback.onPlay()

        val started = Shadows.shadowOf(service).nextStartedActivity
        assertNotNull("Play with no web layer must start the activity", started)
        assertEquals(
                BackgroundExecutionService.TRANSPORT_COMMAND_PLAY,
                started.getStringExtra(ResumeRequest.EXTRA_TRANSPORT_COMMAND),
        )
        assertTrue(
                Shadows.shadowOf(context).broadcastIntents.none {
                    it.action == BackgroundExecutionService.ACTION_TRANSPORT_COMMAND
                },
        )
    }

    @Test
    fun aMediaButtonPlayWhileLiveStillGoesToTheWebLayer() {
        service.mediaSessionCallback.onPlay()

        assertNull(Shadows.shadowOf(service).nextStartedActivity)
        val broadcasts = Shadows.shadowOf(service.application).broadcastIntents
        assertTrue(broadcasts.any { it.action == BackgroundExecutionService.ACTION_TRANSPORT_COMMAND })
    }

    @Test
    fun theStaleStopActionEndsTheSession() {
        idle(PlaybackLiveness.HEARTBEAT_TIMEOUT_MS + 500L)

        val stop = Intent(BackgroundExecutionService.ACTION_STOP_SESSION)
        service.onStartCommand(stop, 0, 3)

        assertTrue(Shadows.shadowOf(service).isStoppedBySelf)
    }
}
