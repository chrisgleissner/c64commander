/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon

/**
 * The launch intent that asks the web layer to resume the stored playback session: the Play action
 * and the tap target of the paused notification once the activity is gone (issue 504).
 *
 * A notification's PendingIntent keeps its extras for as long as the notification lives, and the
 * system hands the launching intent back when it recreates the activity. A request must therefore be
 * acted on once, so each carries a nonce and [ResumeRequestGate] remembers the last one it accepted.
 */
object ResumeRequest {
    const val EXTRA_TRANSPORT_COMMAND = "uk.gleissner.c64commander.extra.RESUME_TRANSPORT_COMMAND"
    const val EXTRA_NONCE = "uk.gleissner.c64commander.extra.RESUME_NONCE"

    fun launchIntent(context: Context, nonce: Long): Intent =
            Intent(context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra(EXTRA_TRANSPORT_COMMAND, BackgroundExecutionService.TRANSPORT_COMMAND_PLAY)
                    .putExtra(EXTRA_NONCE, nonce)

    private const val REQUEST_PLAY_ACTION = 5
    private const val REQUEST_STOP_ACTION = 7

    /** A new nonce each time the notification is built, so one tap is one resume request. */
    fun activityIntent(context: Context, requestCode: Int): PendingIntent =
            PendingIntent.getActivity(
                    context,
                    requestCode,
                    launchIntent(context, System.nanoTime()),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

    /**
     * With the web layer gone a broadcast reaches nobody, so Play starts the activity with a resume
     * request instead, and Stop ends the session in the service since nothing else can.
     */
    fun addStaleSessionActions(context: Context, builder: Notification.Builder) {
        builder.addAction(
                Notification.Action.Builder(
                                Icon.createWithResource(context, android.R.drawable.ic_media_play),
                                "Play",
                                activityIntent(context, REQUEST_PLAY_ACTION)
                        )
                        .build()
        )
        val stopIntent = Intent(context, BackgroundExecutionService::class.java)
        stopIntent.action = BackgroundExecutionService.ACTION_STOP_SESSION
        builder.addAction(
                Notification.Action.Builder(
                                Icon.createWithResource(context, android.R.drawable.ic_menu_close_clear_cancel),
                                "Stop",
                                PendingIntent.getService(
                                        context,
                                        REQUEST_STOP_ACTION,
                                        stopIntent,
                                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                                )
                        )
                        .build()
        )
    }
}

/** Where the last accepted nonce survives the process, so a recreated task cannot replay it. */
interface ResumeNonceStore {
    fun read(): Long?

    fun write(nonce: Long)
}

class SharedPreferencesResumeNonceStore(context: Context) : ResumeNonceStore {
    private val preferences = context.getSharedPreferences("resume_request", Context.MODE_PRIVATE)

    override fun read(): Long? =
            if (preferences.contains(KEY_NONCE)) preferences.getLong(KEY_NONCE, 0L) else null

    override fun write(nonce: Long) {
        preferences.edit().putLong(KEY_NONCE, nonce).apply()
    }

    private companion object {
        const val KEY_NONCE = "lastAcceptedNonce"
    }
}

class ResumeRequestGate(private val store: ResumeNonceStore) {
    /** The transport command to run, or null when the intent carries none or it was already accepted. */
    fun accept(intent: Intent?): String? {
        val command = intent?.getStringExtra(ResumeRequest.EXTRA_TRANSPORT_COMMAND)
        if (command.isNullOrEmpty() || !intent.hasExtra(ResumeRequest.EXTRA_NONCE)) return null
        val nonce = intent.getLongExtra(ResumeRequest.EXTRA_NONCE, 0L)
        if (store.read() == nonce) return null
        store.write(nonce)
        return command
    }
}

/** Holds a request taken while the activity was starting until the web layer asks for it. */
object PendingResumeCommand {
    @Volatile private var command: String? = null

    fun offer(next: String) {
        command = next
    }

    fun take(): String? {
        val taken = command
        command = null
        return taken
    }
}
