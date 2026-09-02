/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat

/**
 * Minimal foreground service that keeps the Android process and WebView JS runtime alive while the
 * screen is locked or the app is backgrounded.
 *
 * This service has **no knowledge** of playlists, SID files, or REST calls. It only holds a partial
 * WakeLock and a foreground notification so the OS does not throttle or kill the hosting process.
 */
class BackgroundExecutionService : Service() {

    companion object {
        private const val TAG = "BgExecService"
        private const val CHANNEL_ID = "c64_background_execution"
        private const val NOTIFICATION_ID = 1
        private const val WAKELOCK_TAG = "c64commander:background_execution"

        const val ACTION_UPDATE_DUE_AT = "uk.gleissner.c64commander.action.UPDATE_DUE_AT"
        const val ACTION_AUTO_SKIP_DUE = "uk.gleissner.c64commander.action.AUTO_SKIP_DUE"
        const val ACTION_TRANSPORT_COMMAND = "uk.gleissner.c64commander.action.TRANSPORT_COMMAND"
        const val ACTION_SET_PLAYBACK_STATE = "uk.gleissner.c64commander.action.SET_PLAYBACK_STATE"
        const val EXTRA_DUE_AT_MS = "dueAtMs"
        const val EXTRA_FIRED_AT_MS = "firedAtMs"
        const val EXTRA_COMMAND_GENERATION = "commandGeneration"
        const val EXTRA_TRANSPORT_COMMAND = "transportCommand"
        const val EXTRA_PAUSED = "paused"

        /**
         * HARD27-007: how long a paused session keeps its notification and MediaSession alive so a
         * headset or lock-screen Play still reaches the web layer. The wake lock is released as
         * soon as playback pauses, so the only cost over this window is a notification and the
         * process's foreground priority.
         */
        const val PAUSED_GRACE_PERIOD_MS = 10L * 60L * 1000L

        /** The three transport commands the session's PlaybackState already advertises. */
        const val TRANSPORT_COMMAND_PLAY = "play"
        const val TRANSPORT_COMMAND_PLAY_PAUSE = "playPause"
        const val TRANSPORT_COMMAND_STOP = "stop"

        @Volatile
        var isRunning = false
            private set
        @Volatile
        private var runningInstance: BackgroundExecutionService? = null
        @Volatile
        private var commandGeneration = 0L
        @Volatile
        private var startPendingGeneration: Long? = null

        @Synchronized
        private fun nextCommandGeneration(): Long {
            commandGeneration += 1L
            return commandGeneration
        }

        fun start(context: Context) {
            // HARD20-007: a start racing asynchronous stop destruction must
            // carry a fresh generation rather than being swallowed by isRunning.
            val generation = nextCommandGeneration()
            startPendingGeneration = generation
            val intent = Intent(context, BackgroundExecutionService::class.java)
            intent.putExtra(EXTRA_COMMAND_GENERATION, generation)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            nextCommandGeneration()
            startPendingGeneration = null
            if (!isRunning) {
                AppLogger.debug(
                        context,
                        TAG,
                        "Not running — ignoring stop request",
                        "BackgroundExecutionService"
                )
                return
            }
            context.stopService(Intent(context, BackgroundExecutionService::class.java))
        }

        /**
         * HARD27-007: pausing must not release the MediaSession, or the headset Play that follows
         * reaches nothing. Resuming after the grace period has already stopped the service starts a
         * fresh one, because the web layer still owns the session.
         */
        fun setPlaybackState(context: Context, paused: Boolean) {
            val activeService = runningInstance
            if (isRunning && activeService != null) {
                activeService.applyPlaybackStateUpdate(paused)
                return
            }
            val pendingGeneration = startPendingGeneration
            if (pendingGeneration == null) {
                if (paused) {
                    AppLogger.debug(
                            context,
                            TAG,
                            "Not running — ignoring pause request",
                            "BackgroundExecutionService"
                    )
                    return
                }
                start(context)
                return
            }
            val intent = Intent(context, BackgroundExecutionService::class.java)
            intent.action = ACTION_SET_PLAYBACK_STATE
            intent.putExtra(EXTRA_PAUSED, paused)
            intent.putExtra(EXTRA_COMMAND_GENERATION, pendingGeneration)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun updateDueAt(context: Context, dueAtMs: Long?) {
            val activeService = runningInstance
            if (isRunning && activeService != null) {
                activeService.applyDueAtUpdate(dueAtMs)
                return
            }
            // No running instance: only forward the update if a start() is genuinely
            // still in flight (startPendingGeneration), carrying that SAME captured
            // generation so onStartCommand accepts it once the service comes up.
            // Never start a fresh service from here — a due timer without an active
            // session (e.g. this update raced a stop()) has no consumer, and unlike a
            // start()-triggered intent, using the current (post-stop) commandGeneration
            // would pass the staleness check and resurrect a phantom foreground
            // service + wake lock (HARD9-041).
            val pendingGeneration = startPendingGeneration
            if (pendingGeneration == null) {
                AppLogger.debug(
                        context,
                        TAG,
                        "Not running — ignoring dueAt ${if (dueAtMs == null) "clear" else "update"} request",
                        "BackgroundExecutionService"
                )
                return
            }
            val intent = Intent(context, BackgroundExecutionService::class.java)
            intent.action = ACTION_UPDATE_DUE_AT
            if (dueAtMs != null) {
                intent.putExtra(EXTRA_DUE_AT_MS, dueAtMs)
            }
            intent.putExtra(EXTRA_COMMAND_GENERATION, pendingGeneration)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var mediaSession: MediaSession? = null

    /*
     * Audio focus is NOT requested here. This service starts for a tune on the Play page and not for
     * the A/V mirror, and it ends on its own lifecycle rather than the speaker's, so the focus it
     * held said nothing about whether the app was making sound. `StreamUdpPlugin` owns focus now:
     * it opens and closes the only audio sink either source plays through (HARD27-006).
     */

    /**
     * A MediaSession with no callback is never made the platform's media-button session, so a
     * headset, lock-screen or Bluetooth transport press reaches nothing at all. This service knows
     * nothing about playback, so each press is forwarded to the web layer, which owns the transport.
     */
    internal val mediaSessionCallback =
            object : MediaSession.Callback() {
                override fun onPlay() = broadcastTransportCommand(TRANSPORT_COMMAND_PLAY)

                override fun onPause() = broadcastTransportCommand(TRANSPORT_COMMAND_PLAY_PAUSE)

                override fun onStop() = broadcastTransportCommand(TRANSPORT_COMMAND_STOP)
            }

    private val handler = Handler(Looper.getMainLooper())
    private var isPausedState = false
    private var pausedExpiryRunnable: Runnable? = null
    private var dueAtMs: Long? = null
    private var dueAtElapsedMs: Long? = null
    private var dueRunnable: Runnable? = null

    override fun onCreate() {
        super.onCreate()
        runningInstance = this
        AppLogger.info(this, TAG, "Service created", "BackgroundExecutionService")
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) {
            AppLogger.warn(
                    this,
                    TAG,
                    "Ignoring sticky restart without command; JS must explicitly re-register background execution",
                    "BackgroundExecutionService"
            )
            satisfyForegroundContractAndStop(startId)
            return START_NOT_STICKY
        }
        val action = intent.action
        val intentGeneration = intent.getLongExtra(EXTRA_COMMAND_GENERATION, commandGeneration)
        if (intentGeneration < commandGeneration) {
            AppLogger.debug(
                    this,
                    TAG,
                    "Ignoring stale background execution command (intentGeneration=$intentGeneration, currentGeneration=$commandGeneration)",
                    "BackgroundExecutionService"
            )
            satisfyForegroundContractAndStop(startId)
            return START_NOT_STICKY
        }
        if (startPendingGeneration == intentGeneration) {
            startPendingGeneration = null
        }
        if (!isRunning) {
            AppLogger.info(this, TAG, "Service starting", "BackgroundExecutionService")
            startForeground(NOTIFICATION_ID, buildNotification())
            acquireWakeLock()
            initializeMediaSession()
            isRunning = true
        }

        if (action == ACTION_SET_PLAYBACK_STATE) {
            updatePlaybackStateInternal(intent.getBooleanExtra(EXTRA_PAUSED, false))
            return START_STICKY
        }

        if (action == ACTION_UPDATE_DUE_AT) {
            val nextDue = intent.getLongExtra(EXTRA_DUE_AT_MS, -1L)
            if (nextDue <= 0L) {
                updateDueAtInternal(null)
            } else {
                updateDueAtInternal(nextDue)
            }
            return START_STICKY
        }

        return START_STICKY
    }

    override fun onDestroy() {
        AppLogger.info(this, TAG, "Service stopping", "BackgroundExecutionService")
        updateDueAtInternal(null)
        cancelPausedExpiry()
        releaseMediaSession()
        releaseWakeLock()
        isRunning = false
        runningInstance = null
        startPendingGeneration = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel =
                    NotificationChannel(
                                    CHANNEL_ID,
                                    "Background Playback",
                                    NotificationManager.IMPORTANCE_LOW
                            )
                            .apply {
                                description = "Keeps the app running during playback"
                                setShowBadge(false)
                            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun applyPlaybackStateUpdate(paused: Boolean) {
        handler.post { updatePlaybackStateInternal(paused) }
    }

    /**
     * Pausing releases the wake lock, because nothing has to run, but keeps the notification and
     * the MediaSession so the platform still routes media buttons here (HARD27-007).
     */
    private fun updatePlaybackStateInternal(paused: Boolean) {
        if (paused == isPausedState) return
        isPausedState = paused
        if (paused) {
            releaseWakeLock()
            publishPlaybackState(PlaybackState.STATE_PAUSED)
            schedulePausedExpiry()
        } else {
            cancelPausedExpiry()
            acquireWakeLock()
            publishPlaybackState(PlaybackState.STATE_PLAYING)
        }
        refreshNotification()
        AppLogger.info(
                this,
                TAG,
                "Playback state ${if (paused) "paused" else "playing"}",
                "BackgroundExecutionService"
        )
    }

    private fun schedulePausedExpiry() {
        cancelPausedExpiry()
        val runnable = Runnable {
            pausedExpiryRunnable = null
            AppLogger.info(
                    this,
                    TAG,
                    "Paused grace period elapsed; stopping service",
                    "BackgroundExecutionService"
            )
            stopSelf()
        }
        pausedExpiryRunnable = runnable
        handler.postDelayed(runnable, PAUSED_GRACE_PERIOD_MS)
    }

    private fun cancelPausedExpiry() {
        pausedExpiryRunnable?.let { handler.removeCallbacks(it) }
        pausedExpiryRunnable = null
    }

    private fun refreshNotification() {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        manager.notify(NOTIFICATION_ID, buildNotification())
    }

    private fun publishPlaybackState(state: Int) {
        val session = mediaSession ?: return
        try {
            session.setPlaybackState(buildPlaybackState(state))
        } catch (e: Exception) {
            AppLogger.warn(
                    this,
                    TAG,
                    "Failed to publish playback state",
                    "BackgroundExecutionService",
                    e
            )
        }
    }

    private fun buildPlaybackState(state: Int): PlaybackState =
            PlaybackState.Builder()
                    .setState(state, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1.0f)
                    .setActions(
                            PlaybackState.ACTION_PLAY or
                                    PlaybackState.ACTION_PAUSE or
                                    PlaybackState.ACTION_PLAY_PAUSE or
                                    PlaybackState.ACTION_STOP,
                    )
                    .build()

    private fun applyDueAtUpdate(nextDueAtMs: Long?) {
        handler.post { updateDueAtInternal(nextDueAtMs) }
    }

    /**
     * Every start() / updateDueAt() call reaches us via startForegroundService() on O+, which
     * obligates the service to call startForeground() promptly regardless of which onStartCommand
     * branch handles it. The stale-generation and null-intent (sticky restart) branches used to
     * stopSelf() without ever doing so, risking a RemoteServiceException crash (HARD9-042). Satisfy
     * the contract with a throwaway notification, then immediately tear it back down — but only
     * when the service isn't already legitimately in the foreground under a newer generation;
     * otherwise this would tear down that still-active notification out from under it.
     */
    private fun satisfyForegroundContractAndStop(startId: Int) {
        if (!isRunning) {
            startForeground(NOTIFICATION_ID, buildNotification())
            stopForegroundCompat()
        }
        stopSelf(startId)
    }

    @Suppress("DEPRECATION")
    private fun stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            stopForeground(true)
        }
    }

    private fun buildNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent =
                PendingIntent.getActivity(
                        this,
                        0,
                        launchIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )

        return NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(if (isPausedState) "Playback paused" else "Playback active")
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setOngoing(true)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()
    }

    private fun acquireWakeLock() {
        if (wakeLock != null) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock =
                pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG).apply {
                    acquire()
                }
        AppLogger.debug(
                this,
                TAG,
                "WakeLock acquired",
                "BackgroundExecutionService"
        )
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
                AppLogger.debug(this, TAG, "WakeLock released", "BackgroundExecutionService")
            }
        }
        wakeLock = null
    }

    private fun initializeMediaSession() {
        if (mediaSession != null) return
        try {
            val session = MediaSession(this, "C64CommanderBackgroundExecution")
            session.setCallback(mediaSessionCallback)
            session.setPlaybackState(
                    buildPlaybackState(
                            if (isPausedState) PlaybackState.STATE_PAUSED
                            else PlaybackState.STATE_PLAYING
                    )
            )
            session.isActive = true
            mediaSession = session
            AppLogger.debug(this, TAG, "MediaSession initialized", "BackgroundExecutionService")
        } catch (e: Exception) {
            AppLogger.warn(
                    this,
                    TAG,
                    "Failed to initialize MediaSession",
                    "BackgroundExecutionService",
                    e
            )
        }
    }

    private fun broadcastTransportCommand(command: String) {
        val broadcast = Intent(ACTION_TRANSPORT_COMMAND)
        broadcast.setPackage(packageName)
        broadcast.putExtra(EXTRA_TRANSPORT_COMMAND, command)
        sendBroadcast(broadcast)
        AppLogger.info(
                this,
                TAG,
                "Media button transport command ($command)",
                "BackgroundExecutionService"
        )
    }

    private fun releaseMediaSession() {
        mediaSession?.let { session ->
            try {
                session.isActive = false
                session.release()
                AppLogger.debug(this, TAG, "MediaSession released", "BackgroundExecutionService")
            } catch (e: Exception) {
                AppLogger.warn(
                        this,
                        TAG,
                        "Failed to release MediaSession",
                        "BackgroundExecutionService",
                        e
                )
            }
        }
        mediaSession = null
    }

    private fun updateDueAtInternal(nextDueAtMs: Long?) {
        dueRunnable?.let { handler.removeCallbacks(it) }
        dueRunnable = null
        dueAtMs = null
        dueAtElapsedMs = null

        if (nextDueAtMs == null) {
            AppLogger.debug(this, TAG, "Cleared dueAtMs watchdog", "BackgroundExecutionService")
            return
        }

        val nowWall = System.currentTimeMillis()
        val nowElapsed = SystemClock.elapsedRealtime()
        val delay = maxOf(0L, nextDueAtMs - nowWall)
        val scheduledElapsed = nowElapsed + delay
        dueAtMs = nextDueAtMs
        dueAtElapsedMs = scheduledElapsed
        lateinit var runnable: Runnable
        runnable = Runnable {
            val currentDue = dueAtMs
            val currentDueElapsed = dueAtElapsedMs
            if (currentDue == null) return@Runnable
            if (currentDueElapsed == null) return@Runnable

            val nowElapsedRealtime = SystemClock.elapsedRealtime()
            if (nowElapsedRealtime < currentDueElapsed) {
                val remaining = currentDueElapsed - nowElapsedRealtime
                handler.postDelayed(runnable, remaining)
                AppLogger.debug(
                        this,
                        TAG,
                        "Due watchdog not ready yet; rescheduled using monotonic clock (remainingMs=$remaining)",
                        "BackgroundExecutionService"
                )
                return@Runnable
            }

            val now = System.currentTimeMillis()
            // Implicit (no package) this never reaches the plugin's runtime receiver:
            // the record is enqueued and then dropped without a dispatch. AppLogger's
            // DIAGNOSTICS_LOG broadcast already sets the package for the same reason.
            val broadcast = Intent(ACTION_AUTO_SKIP_DUE)
            broadcast.setPackage(packageName)
            broadcast.putExtra(EXTRA_DUE_AT_MS, currentDue)
            broadcast.putExtra(EXTRA_FIRED_AT_MS, now)
            sendBroadcast(broadcast)
            AppLogger.info(
                    this,
                    TAG,
                    "Auto-skip watchdog fired (dueAtMs=$currentDue, now=$now)",
                    "BackgroundExecutionService"
            )
            dueAtMs = null
            dueAtElapsedMs = null
            dueRunnable = null
        }
        dueRunnable = runnable
        handler.postDelayed(runnable, delay)
        AppLogger.debug(
                this,
                TAG,
                "Scheduled dueAtMs watchdog (dueAtMs=$nextDueAtMs, delayMs=$delay, dueAtElapsedMs=$scheduledElapsed)",
                "BackgroundExecutionService"
        )
    }
}
