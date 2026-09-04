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
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Keeps the app alive and the CPU awake while the HVSC library is installed (HARD27-028).
 *
 * Distinct from [BackgroundExecutionService], which is declared `mediaPlayback` and owns a
 * MediaSession, a paused-expiry timer and transport callbacks; a file transfer is `dataSync` work
 * with none of that, and stopping one must never tear down the other. See DECISIONS.md D-27.
 */
class LibraryInstallService : Service() {
    companion object {
        private const val TAG = "LibraryInstallService"
        private const val CHANNEL_ID = "c64_library_install"
        private const val NOTIFICATION_ID = 2
        private const val WAKELOCK_TAG = "c64commander:library_install"
        const val EXTRA_COMMAND_GENERATION = "commandGeneration"

        @Volatile
        @JvmStatic
        var isRunning = false
            private set

        /**
         * Tells a start that is still in flight apart from one the caller has since stopped.
         *
         * `startForegroundService` only enqueues the intent, so `onStartCommand` can run after
         * `stop`. Without this the stop was dropped — it returned early while [isRunning] was still
         * false — and the service then started, took a `PARTIAL_WAKE_LOCK`, and had no other stop
         * path, because it is `START_NOT_STICKY` with no expiry. An install that ends quickly
         * reaches that window: `fetchLatestHvscVersions` throwing offline, or a run that finds
         * nothing to do, both return within a few hundred milliseconds of the start.
         *
         * [BackgroundExecutionService] solves the same race the same way (HARD20-007).
         */
        @Volatile private var commandGeneration = 0L

        @Synchronized
        private fun nextCommandGeneration(): Long {
            commandGeneration += 1L
            return commandGeneration
        }

        fun start(context: Context) {
            val intent = Intent(context, LibraryInstallService::class.java)
            intent.putExtra(EXTRA_COMMAND_GENERATION, nextCommandGeneration())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            nextCommandGeneration()
            if (!isRunning) {
                AppLogger.debug(context, TAG, "Not running — ignoring stop request", TAG)
                return
            }
            context.stopService(Intent(context, LibraryInstallService::class.java))
        }

        /** Whether an intent carrying [intentGeneration] is still the current command. */
        @JvmStatic
        fun isCurrentGeneration(intentGeneration: Long): Boolean = intentGeneration >= commandGeneration
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    /**
     * START_NOT_STICKY, unlike the playback service: the install is driven from the web layer, so a
     * service restarted after the process died would hold a wake lock for work that no longer runs.
     */
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val intentGeneration = intent?.getLongExtra(EXTRA_COMMAND_GENERATION, 0L) ?: 0L
        if (!isCurrentGeneration(intentGeneration)) {
            AppLogger.debug(this, TAG, "Ignoring a start the caller has already stopped", TAG)
            satisfyForegroundContractAndStop(startId)
            return START_NOT_STICKY
        }
        if (!isRunning) {
            try {
                enterForeground()
            } catch (e: Exception) {
                AppLogger.warn(this, TAG, "Foreground service refused; install runs unprotected", TAG, e)
                stopSelf(startId)
                return START_NOT_STICKY
            }
            acquireWakeLock()
            isRunning = true
            AppLogger.info(this, TAG, "Library install guard started", TAG)
        }
        return START_NOT_STICKY
    }

    /**
     * A `startForegroundService` intent must reach `startForeground` even when the command it
     * carries is discarded, or the system kills the process. Entering and immediately leaving the
     * foreground satisfies that without leaving a notification behind. Mirrors
     * [BackgroundExecutionService.satisfyForegroundContractAndStop].
     */
    private fun satisfyForegroundContractAndStop(startId: Int) {
        if (!isRunning) {
            try {
                enterForeground()
                stopForegroundCompat()
            } catch (e: Exception) {
                AppLogger.warn(this, TAG, "Foreground service refused while discarding a stale start", TAG, e)
            }
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

    override fun onDestroy() {
        releaseWakeLock()
        isRunning = false
        AppLogger.info(this, TAG, "Library install guard stopped", TAG)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun enterForeground() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel =
                NotificationChannel(
                                CHANNEL_ID,
                                "Music Library Install",
                                NotificationManager.IMPORTANCE_LOW
                        )
                        .apply {
                            description = "Keeps the app running while the music library installs"
                            setShowBadge(false)
                        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
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

        val builder =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    Notification.Builder(this, CHANNEL_ID)
                } else {
                    @Suppress("DEPRECATION")
                    Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)
                }

        return builder.setContentTitle("Installing music library")
                // There is no cancel action: the progress and the Cancel button both live on the
                // Play page, which tapping the notification opens.
                .setContentText("Tap to see progress. Keep the app installed until this finishes.")
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setOngoing(true)
                .setContentIntent(pendingIntent)
                .build()
    }

    private fun acquireWakeLock() {
        if (wakeLock != null) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG).apply { acquire() }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }
}
