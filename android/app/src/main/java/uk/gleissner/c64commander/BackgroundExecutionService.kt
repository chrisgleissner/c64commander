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
import android.util.Log
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

        const val ACTION_UPDATE_DUE_AT = "uk.gleissner.c64commander.action.UPDATE_DUE_AT"
        const val ACTION_AUTO_SKIP_DUE = "uk.gleissner.c64commander.action.AUTO_SKIP_DUE"
        const val EXTRA_DUE_AT_MS = "dueAtMs"
        const val EXTRA_FIRED_AT_MS = "firedAtMs"

        @Volatile
        var isRunning = false
            private set

        fun start(context: Context) {
            if (isRunning) {
                Log.d(TAG, "Already running — ignoring start request")
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
                Log.d(TAG, "Not running — ignoring stop request")
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

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Service created")
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        if (!isRunning) {
            Log.i(TAG, "Service starting")
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

        return START_STICKY
    }

    override fun onDestroy() {
        Log.i(TAG, "Service stopping")
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
            acquire()
        }
        Log.d(TAG, "WakeLock acquired")
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
                Log.d(TAG, "WakeLock released")
            }
        }
        wakeLock = null
    }

    private fun updateDueAtInternal(nextDueAtMs: Long?) {
        dueAtMs = nextDueAtMs
        dueRunnable?.let { handler.removeCallbacks(it) }
        dueRunnable = null

        if (nextDueAtMs == null) {
            Log.d(TAG, "Cleared dueAtMs watchdog")
            return
        }

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
            Log.i(TAG, "Auto-skip watchdog fired (dueAtMs=$currentDue, now=$now)")
            dueAtMs = null
            dueRunnable = null
        }
        dueRunnable = runnable
        handler.postDelayed(runnable, delay)
        Log.d(TAG, "Scheduled dueAtMs watchdog (dueAtMs=$nextDueAtMs, delayMs=$delay)")
    }
}
