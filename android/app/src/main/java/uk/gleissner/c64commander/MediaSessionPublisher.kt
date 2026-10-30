/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState

internal data class NowPlayingMetadata(val title: String?, val artist: String?, val durationMs: Long?)

/**
 * What [BackgroundExecutionService] tells the platform through its MediaSession: the transport
 * actions it offers, the playback state, and the tune that is playing. The service owns the
 * session's lifetime and the notification; this class owns what the session says.
 */
internal class MediaSessionPublisher(
        private val context: Context,
        private val relayTransportCommand: (String) -> Unit,
) {
    var nowPlaying = NowPlayingMetadata(title = null, artist = null, durationMs = null)
        private set

    /**
     * A MediaSession with no callback is never made the platform's media-button session, so a
     * headset, lock-screen or Bluetooth transport press reaches nothing at all. The service knows
     * nothing about playback, so each press is forwarded to the web layer, which owns the transport.
     */
    val callback =
            object : MediaSession.Callback() {
                override fun onPlay() = relayTransportCommand(BackgroundExecutionService.TRANSPORT_COMMAND_PLAY)

                override fun onPause() =
                        relayTransportCommand(BackgroundExecutionService.TRANSPORT_COMMAND_PLAY_PAUSE)

                override fun onStop() = relayTransportCommand(BackgroundExecutionService.TRANSPORT_COMMAND_STOP)

                override fun onSkipToNext() = relayTransportCommand(BackgroundExecutionService.TRANSPORT_COMMAND_NEXT)
            }

    fun createSession(state: Int, stale: Boolean): MediaSession? =
            try {
                val session = MediaSession(context, "C64CommanderBackgroundExecution")
                session.setCallback(callback)
                session.setPlaybackState(buildPlaybackState(state, stale))
                session.isActive = true
                publishNowPlayingMetadata(session)
                AppLogger.debug(context, TAG, "MediaSession initialized", COMPONENT)
                session
            } catch (e: Exception) {
                AppLogger.warn(context, TAG, "Failed to initialize MediaSession", COMPONENT, e)
                null
            }

    fun releaseSession(session: MediaSession) {
        try {
            session.isActive = false
            session.release()
            AppLogger.debug(context, TAG, "MediaSession released", COMPONENT)
        } catch (e: Exception) {
            AppLogger.warn(context, TAG, "Failed to release MediaSession", COMPONENT, e)
        }
    }

    /**
     * Blank fields are normalised to null so an empty title falls back to the app name rather than
     * showing an empty lock-screen control. Returns false when nothing changed.
     */
    fun updateNowPlaying(session: MediaSession?, title: String?, artist: String?, durationMs: Long?): Boolean {
        val next =
                NowPlayingMetadata(
                        title = title?.trim()?.ifEmpty { null },
                        artist = artist?.trim()?.ifEmpty { null },
                        durationMs = durationMs?.takeIf { it > 0L },
                )
        if (next == nowPlaying) return false
        nowPlaying = next
        publishNowPlayingMetadata(session)
        return true
    }

    fun publishPlaybackState(session: MediaSession?, state: Int, stale: Boolean) {
        session ?: return
        try {
            session.setPlaybackState(buildPlaybackState(state, stale))
        } catch (e: Exception) {
            AppLogger.warn(context, TAG, "Failed to publish playback state", COMPONENT, e)
        }
    }

    fun buildPlaybackState(state: Int, stale: Boolean): PlaybackState =
            PlaybackState.Builder()
                    .setState(state, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1.0f)
                    .setActions(
                            if (stale) {
                                // A Play the system will not let us act on is worse than none.
                                PlaybackState.ACTION_STOP
                            } else {
                                PlaybackState.ACTION_PLAY or
                                        PlaybackState.ACTION_PAUSE or
                                        PlaybackState.ACTION_PLAY_PAUSE or
                                        PlaybackState.ACTION_STOP or
                                        PlaybackState.ACTION_SKIP_TO_NEXT
                            },
                    )
                    .build()

    /**
     * What the lock screen reads. Published even before the web layer names a tune, so the control
     * carries the app name rather than an empty title.
     */
    fun publishNowPlayingMetadata(session: MediaSession?) {
        session ?: return
        try {
            val metadata =
                    MediaMetadata.Builder()
                            .putString(
                                    MediaMetadata.METADATA_KEY_TITLE,
                                    nowPlaying.title ?: context.getString(R.string.app_name)
                            )
            nowPlaying.artist?.let { metadata.putString(MediaMetadata.METADATA_KEY_ARTIST, it) }
            nowPlaying.durationMs?.let { metadata.putLong(MediaMetadata.METADATA_KEY_DURATION, it) }
            session.setMetadata(metadata.build())
        } catch (e: Exception) {
            AppLogger.warn(context, TAG, "Failed to publish now-playing metadata", COMPONENT, e)
        }
    }

    private companion object {
        const val TAG = "BgExecService"
        const val COMPONENT = "BackgroundExecutionService"
    }
}
