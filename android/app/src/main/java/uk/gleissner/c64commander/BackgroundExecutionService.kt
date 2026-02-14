/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
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
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat

/**
 * Minimal foreground service that keeps the Android process and WebView JS
 * runtime alive while the screen is locked or the app is backgrounded.
 *
 * This service has **no knowledge** of playlists, SID files, or REST calls.
 * It only holds a partial WakeLock and a foreground notification so the OS
 * does not throttle or kill the hosting process.
 */
class BackgroundExecutionService : Service() {

    companion object {
        private const val TAG = "BgExecService"
        private const val CHANNEL_ID = "c64_background_execution"
        private const val NOTIFICATION_ID = 1
        private const val WAKELOCK_TAG = "c64commander:background_execution"

        /** Maximum WakeLock hold time before automatic release (10 minutes). */
        internal const val WAKELOCK_TIMEOUT_MS = 10L * 60 * 1000
        /** Idle timeout: service stops if no dueAtMs is set within this window (60 seconds). */
        internal const val IDLE_TIMEOUT_MS = 60L * 1000

        const val ACTION_UPDATE_DUE_AT = "uk.gleissner.c64commander.action.UPDATE_DUE_AT"
        const val ACTION_AUTO_SKIP_DUE = "uk.gleissner.c64commander.action.AUTO_SKIP_DUE"
        const val EXTRA_DUE_AT_MS = "dueAtMs"
        const val EXTRA_FIRED_AT_MS = "firedAtMs"

        @Volatile
        var isRunning = false
            private set

        fun start(context: Context) {
            if (isRunning) {
                AppLogger.debug(context, TAG, "Already running — ignoring start request", "BackgroundExecutionService")
                return
            }
            val intent = Intent(context, BackgroundExecutionService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            if (!isRunning) {
                AppLogger.debug(context, TAG, "Not running — ignoring stop request", "BackgroundExecutionService")
                return
            }
            context.stopService(Intent(context, BackgroundExecutionService::class.java))
        }

        fun updateDueAt(context: Context, dueAtMs: Long?) {
            val intent = Intent(context, BackgroundExecutionService::class.java)
            intent.action = ACTION_UPDATE_DUE_AT
            if (dueAtMs != null) {
                intent.putExtra(EXTRA_DUE_AT_MS, dueAtMs)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null

    private val handler = Handler(Looper.getMainLooper())
    private var dueAtMs: Long? = null
    private var dueRunnable: Runnable? = null
    private var idleRunnable: Runnable? = null

    override fun onCreate() {
        super.onCreate()
        AppLogger.info(this, TAG, "Service created", "BackgroundExecutionService")
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        if (!isRunning) {
            AppLogger.info(this, TAG, "Service starting", "BackgroundExecutionService")
            startForeground(NOTIFICATION_ID, buildNotification())
            acquireWakeLock()
            isRunning = true
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

        // Schedule idle timeout: if no dueAtMs has been set, stop the service
        scheduleIdleTimeout()

        return START_STICKY
    }

    override fun onDestroy() {
        AppLogger.info(this, TAG, "Service stopping", "BackgroundExecutionService")
        cancelIdleTimeout()
        updateDueAtInternal(null)
        releaseWakeLock()
        isRunning = false
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Background Playback",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps the app running during playback"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("C64 Commander")
            .setContentText("Playback active")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun acquireWakeLock() {
        if (wakeLock != null) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG).apply {
            acquire(WAKELOCK_TIMEOUT_MS)
        }
        AppLogger.debug(this, TAG, "WakeLock acquired (timeout=${WAKELOCK_TIMEOUT_MS}ms)", "BackgroundExecutionService")
    }

    /** Re-acquires the WakeLock with a fresh timeout, extending the hold window. */
    private fun renewWakeLock() {
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG).apply {
            acquire(WAKELOCK_TIMEOUT_MS)
        }
        AppLogger.debug(this, TAG, "WakeLock renewed (timeout=${WAKELOCK_TIMEOUT_MS}ms)", "BackgroundExecutionService")
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

    private fun updateDueAtInternal(nextDueAtMs: Long?) {
        dueAtMs = nextDueAtMs
        dueRunnable?.let { handler.removeCallbacks(it) }
        dueRunnable = null

        if (nextDueAtMs == null) {
            AppLogger.debug(this, TAG, "Cleared dueAtMs watchdog", "BackgroundExecutionService")
            return
        }

        // Renew wake lock whenever a due-time is scheduled, and cancel idle timeout
        renewWakeLock()
        cancelIdleTimeout()

        val delay = maxOf(0L, nextDueAtMs - System.currentTimeMillis())
        val runnable = Runnable {
            val currentDue = dueAtMs
            if (currentDue == null) return@Runnable
            val now = System.currentTimeMillis()
            if (now < currentDue) {
                // Re-schedule in case the clock changed.
                updateDueAtInternal(currentDue)
                return@Runnable
            }
            val broadcast = Intent(ACTION_AUTO_SKIP_DUE)
            broadcast.putExtra(EXTRA_DUE_AT_MS, currentDue)
            broadcast.putExtra(EXTRA_FIRED_AT_MS, now)
            sendBroadcast(broadcast)
            AppLogger.info(this, TAG, "Auto-skip watchdog fired (dueAtMs=$currentDue, now=$now)", "BackgroundExecutionService")
            dueAtMs = null
            dueRunnable = null
        }
        dueRunnable = runnable
        handler.postDelayed(runnable, delay)
        AppLogger.debug(this, TAG, "Scheduled dueAtMs watchdog (dueAtMs=$nextDueAtMs, delayMs=$delay)", "BackgroundExecutionService")
    }

    private fun scheduleIdleTimeout() {
        cancelIdleTimeout()
        if (dueAtMs != null) return // Already active — no idle timeout needed
        val runnable = Runnable {
            if (dueAtMs != null) return@Runnable
            AppLogger.info(this, TAG, "Idle timeout reached — stopping service", "BackgroundExecutionService")
            stopSelf()
        }
        idleRunnable = runnable
        handler.postDelayed(runnable, IDLE_TIMEOUT_MS)
        AppLogger.debug(this, TAG, "Scheduled idle timeout (${IDLE_TIMEOUT_MS}ms)", "BackgroundExecutionService")
    }

    private fun cancelIdleTimeout() {
        idleRunnable?.let { handler.removeCallbacks(it) }
        idleRunnable = null
    }
}
