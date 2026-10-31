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
import android.os.SystemClock

internal data class NowPlayingMetadata(
        val title: String?,
        val artist: String?,
        val durationMs: Long?,
        val album: String? = null,
)

/** Where the web layer said the tune stood at [atElapsedMs] on the monotonic clock. */
private data class ReportedPosition(
        val positionMs: Long,
        val playing: Boolean,
        val seekable: Boolean,
        val atElapsedMs: Long,
)

/**
 * What [BackgroundExecutionService] tells the platform through its MediaSession: the transport
 * actions it offers, the playback state, and the tune that is playing. The service owns the
 * session's lifetime and the notification; this class owns what the session says.
 */
internal class MediaSessionPublisher(
        private val context: Context,
        private val relayTransportCommand: (String) -> Unit,
        private val relaySeekRequest: (Long) -> Unit,
        private val elapsedRealtimeMs: () -> Long = SystemClock::elapsedRealtime,
) {
    var nowPlaying = NowPlayingMetadata(title = null, artist = null, durationMs = null)
        private set
    private var reported: ReportedPosition? = null
    private var frozenAtMs: Long? = null

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

                override fun onSkipToPrevious() =
                        relayTransportCommand(BackgroundExecutionService.TRANSPORT_COMMAND_PREVIOUS)

                override fun onSeekTo(pos: Long) = relaySeekRequest(pos)
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
    fun updateNowPlaying(
            session: MediaSession?,
            title: String?,
            artist: String?,
            durationMs: Long?,
            album: String? = null,
    ): Boolean {
        val next =
                NowPlayingMetadata(
                        title = title?.trim()?.ifEmpty { null },
                        artist = artist?.trim()?.ifEmpty { null },
                        durationMs = durationMs?.takeIf { it > 0L },
                        album = album?.trim()?.ifEmpty { null },
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

    /**
     * Android advances the position itself while the state is playing, so the web layer reports it
     * only when it changes course: a tune starts, playback pauses or resumes, a seek lands.
     */
    fun updatePosition(
            session: MediaSession?,
            state: Int,
            stale: Boolean,
            positionMs: Long,
            playing: Boolean,
            seekable: Boolean,
    ) {
        val nowMs = elapsedRealtimeMs()
        reported = ReportedPosition(positionMs.coerceAtLeast(0L), playing, seekable, nowMs)
        if (frozenAtMs != null) frozenAtMs = nowMs
        publishPlaybackState(session, state, stale)
    }

    /**
     * A session that is not playing, or whose web layer has gone quiet, stands still at the
     * position it reached, and the time spent that way is not counted when it plays on.
     */
    private fun positionAt(state: Int, nowMs: Long): Long {
        if (state == PlaybackState.STATE_PLAYING) {
            frozenAtMs?.let { frozenAt ->
                reported = reported?.let { it.copy(atElapsedMs = it.atElapsedMs + (nowMs - frozenAt)) }
                frozenAtMs = null
            }
        } else if (frozenAtMs == null) {
            frozenAtMs = nowMs
        }
        val position = reported ?: return PlaybackState.PLAYBACK_POSITION_UNKNOWN
        if (!position.playing) return position.positionMs
        val untilMs = frozenAtMs ?: nowMs
        return position.positionMs + (untilMs - position.atElapsedMs).coerceAtLeast(0L)
    }

    fun buildPlaybackState(state: Int, stale: Boolean): PlaybackState {
        val nowMs = elapsedRealtimeMs()
        val positionMs = positionAt(state, nowMs)
        val advancing = state == PlaybackState.STATE_PLAYING && (reported?.playing ?: true)
        return PlaybackState.Builder()
                .setState(state, positionMs, if (advancing) 1.0f else 0.0f, nowMs)
                .setActions(
                            if (stale) {
                                // A Play the system will not let us act on is worse than none.
                                PlaybackState.ACTION_STOP
                            } else {
                                PlaybackState.ACTION_PLAY or
                                        PlaybackState.ACTION_PAUSE or
                                        PlaybackState.ACTION_PLAY_PAUSE or
                                        PlaybackState.ACTION_STOP or
                                        PlaybackState.ACTION_SKIP_TO_NEXT or
                                        PlaybackState.ACTION_SKIP_TO_PREVIOUS or
                                        (if (reported?.seekable == true) PlaybackState.ACTION_SEEK_TO else 0L)
                            },
                    )
                    .build()
    }

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
            nowPlaying.album?.let { metadata.putString(MediaMetadata.METADATA_KEY_ALBUM, it) }
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
