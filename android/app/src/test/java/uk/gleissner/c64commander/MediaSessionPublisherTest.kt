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
import android.os.Build
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [Build.VERSION_CODES.TIRAMISU], shadows = [RecordingMediaSessionShadow::class])
class MediaSessionPublisherTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val relayed = mutableListOf<String>()
    private val seeks = mutableListOf<Long>()
    private var nowMs = 1_000L
    private val publisher =
            MediaSessionPublisher(
                    context,
                    relayTransportCommand = { relayed += it },
                    relaySeekRequest = { seeks += it },
                    elapsedRealtimeMs = { nowMs },
            )

    @Before
    fun setUp() {
        RecordingMediaSessionShadow.lastMetadata = null
    }

    private val liveActions =
            PlaybackState.ACTION_PLAY or
                    PlaybackState.ACTION_PAUSE or
                    PlaybackState.ACTION_PLAY_PAUSE or
                    PlaybackState.ACTION_STOP or
                    PlaybackState.ACTION_SKIP_TO_NEXT or
                    PlaybackState.ACTION_SKIP_TO_PREVIOUS

    @Test
    fun liveSessionOffersTheFullTransport() {
        val state = publisher.buildPlaybackState(PlaybackState.STATE_PLAYING, stale = false)

        assertEquals(PlaybackState.STATE_PLAYING, state.state)
        assertEquals(liveActions, state.actions)
        assertEquals(1.0f, state.playbackSpeed)
    }

    @Test
    fun staleSessionOffersStopOnly() {
        val state = publisher.buildPlaybackState(PlaybackState.STATE_PAUSED, stale = true)

        assertEquals(PlaybackState.STATE_PAUSED, state.state)
        assertEquals(PlaybackState.ACTION_STOP, state.actions)
        assertEquals(0L, state.actions and PlaybackState.ACTION_SKIP_TO_PREVIOUS)
    }

    @Test
    fun callbackRelaysEachTransportCommandInTheWebLayersVocabulary() {
        publisher.callback.onPlay()
        publisher.callback.onPause()
        publisher.callback.onStop()
        publisher.callback.onSkipToNext()
        publisher.callback.onSkipToPrevious()

        assertEquals(
                listOf(
                        BackgroundExecutionService.TRANSPORT_COMMAND_PLAY,
                        BackgroundExecutionService.TRANSPORT_COMMAND_PLAY_PAUSE,
                        BackgroundExecutionService.TRANSPORT_COMMAND_STOP,
                        BackgroundExecutionService.TRANSPORT_COMMAND_NEXT,
                        BackgroundExecutionService.TRANSPORT_COMMAND_PREVIOUS,
                ),
                relayed,
        )
    }

    @Test
    fun nowPlayingIsNormalisedAndARepeatReportsNoChange() {
        assertTrue(publisher.updateNowPlaying(null, "  Commando ", "", 0L))
        assertEquals(
                NowPlayingMetadata(title = "Commando", artist = null, durationMs = null, album = null),
                publisher.nowPlaying,
        )

        assertFalse(publisher.updateNowPlaying(null, "Commando", "   ", -5L))
    }

    @Test
    fun albumIsPartOfTheNowPlayingIdentity() {
        assertTrue(publisher.updateNowPlaying(null, "Commando", null, null, "Tune 3 of 19"))
        assertFalse(publisher.updateNowPlaying(null, "Commando", null, null, " Tune 3 of 19 "))
        assertTrue(publisher.updateNowPlaying(null, "Commando", null, null, "Tune 4 of 19"))
        assertTrue(publisher.updateNowPlaying(null, "Commando", null, null, "  "))
        assertNull(publisher.nowPlaying.album)
    }

    @Test
    fun metadataCarriesTheAlbumOnlyWhenThereIsOne() {
        val session = MediaSession(context, "test")

        publisher.updateNowPlaying(session, "Commando", null, null, "Tune 3 of 19")
        assertEquals("Tune 3 of 19", RecordingMediaSessionShadow.lastMetadata?.getString(MediaMetadata.METADATA_KEY_ALBUM))

        publisher.updateNowPlaying(session, "Commando", null, null, null)
        assertFalse(RecordingMediaSessionShadow.lastMetadata?.containsKey(MediaMetadata.METADATA_KEY_ALBUM) ?: true)
    }

    @Test
    fun theLockScreenHasNoPositionUntilTheWebLayerReportsOne() {
        val state = publisher.buildPlaybackState(PlaybackState.STATE_PLAYING, stale = false)

        assertEquals(PlaybackState.PLAYBACK_POSITION_UNKNOWN, state.position)
    }

    @Test
    fun aReportedPositionAdvancesAtSpeedOneWhilePlaying() {
        publisher.updatePosition(null, PlaybackState.STATE_PLAYING, false, 61_000L, playing = true, seekable = false)

        nowMs += 2_000L
        val state = publisher.buildPlaybackState(PlaybackState.STATE_PLAYING, stale = false)

        assertEquals(63_000L, state.position)
        assertEquals(1.0f, state.playbackSpeed)
        assertEquals(nowMs, state.lastPositionUpdateTime)
    }

    @Test
    fun aReportedPausedPositionHasSpeedZeroAndStandsStill() {
        publisher.updatePosition(null, PlaybackState.STATE_PLAYING, false, 61_000L, playing = false, seekable = false)

        nowMs += 30_000L
        val state = publisher.buildPlaybackState(PlaybackState.STATE_PLAYING, stale = false)

        assertEquals(61_000L, state.position)
        assertEquals(0.0f, state.playbackSpeed)
    }

    @Test
    fun theServicePausingFreezesThePositionWhereItWasAndResumingContinuesFromThere() {
        publisher.updatePosition(null, PlaybackState.STATE_PLAYING, false, 10_000L, playing = true, seekable = false)

        nowMs += 3_000L
        val paused = publisher.buildPlaybackState(PlaybackState.STATE_PAUSED, stale = false)
        nowMs += 60_000L
        val stillPaused = publisher.buildPlaybackState(PlaybackState.STATE_PAUSED, stale = false)
        val resumed = publisher.buildPlaybackState(PlaybackState.STATE_PLAYING, stale = false)
        nowMs += 2_000L
        val running = publisher.buildPlaybackState(PlaybackState.STATE_PLAYING, stale = false)

        assertEquals(13_000L, paused.position)
        assertEquals(0.0f, paused.playbackSpeed)
        assertEquals(13_000L, stillPaused.position)
        assertEquals(13_000L, resumed.position)
        assertEquals(1.0f, resumed.playbackSpeed)
        assertEquals(15_000L, running.position)
    }

    @Test
    fun aStaleSessionFreezesThePositionAndContinuesWhenTheWebLayerReturns() {
        publisher.updatePosition(null, PlaybackState.STATE_PLAYING, false, 10_000L, playing = true, seekable = true)

        nowMs += 4_000L
        val stale = publisher.buildPlaybackState(PlaybackState.STATE_PAUSED, stale = true)
        nowMs += 20_000L
        val back = publisher.buildPlaybackState(PlaybackState.STATE_PLAYING, stale = false)

        assertEquals(14_000L, stale.position)
        assertEquals(0.0f, stale.playbackSpeed)
        assertEquals(14_000L, back.position)
    }

    @Test
    fun aPositionReportedWhileFrozenRestartsFromTheReportedValue() {
        publisher.buildPlaybackState(PlaybackState.STATE_PAUSED, stale = false)
        nowMs += 5_000L
        publisher.updatePosition(null, PlaybackState.STATE_PAUSED, false, 70_000L, playing = true, seekable = true)
        nowMs += 1_000L

        val resumed = publisher.buildPlaybackState(PlaybackState.STATE_PLAYING, stale = false)

        assertEquals(70_000L, resumed.position)
    }

    @Test
    fun seekToIsOfferedOnlyToASeekableLiveSession() {
        publisher.updatePosition(null, PlaybackState.STATE_PLAYING, false, 0L, playing = true, seekable = false)
        assertEquals(
                0L,
                publisher.buildPlaybackState(PlaybackState.STATE_PLAYING, false).actions and PlaybackState.ACTION_SEEK_TO,
        )

        publisher.updatePosition(null, PlaybackState.STATE_PLAYING, false, 0L, playing = true, seekable = true)
        val live = publisher.buildPlaybackState(PlaybackState.STATE_PLAYING, false)
        assertEquals(PlaybackState.ACTION_SEEK_TO, live.actions and PlaybackState.ACTION_SEEK_TO)
        assertEquals(liveActions or PlaybackState.ACTION_SEEK_TO, live.actions)

        val stale = publisher.buildPlaybackState(PlaybackState.STATE_PAUSED, stale = true)
        assertEquals(PlaybackState.ACTION_STOP, stale.actions)
    }

    @Test
    fun callbackRelaysASeekWithItsPosition() {
        publisher.callback.onSeekTo(93_000L)

        assertEquals(listOf(93_000L), seeks)
        assertTrue(relayed.isEmpty())
    }

    @Test
    fun metadataCarriesTitleArtistAndDuration() {
        val session = MediaSession(context, "test")
        publisher.updateNowPlaying(session, "Commando", "Rob Hubbard", 195_000L)

        val metadata = RecordingMediaSessionShadow.lastMetadata
        assertNotNull(metadata)
        assertEquals("Commando", metadata?.getString(MediaMetadata.METADATA_KEY_TITLE))
        assertEquals("Rob Hubbard", metadata?.getString(MediaMetadata.METADATA_KEY_ARTIST))
        assertEquals(195_000L, metadata?.getLong(MediaMetadata.METADATA_KEY_DURATION))
    }

    @Test
    fun metadataFallsBackToTheAppNameAndOmitsUnknownFields() {
        publisher.publishNowPlayingMetadata(MediaSession(context, "test"))

        val metadata = RecordingMediaSessionShadow.lastMetadata
        assertEquals(context.getString(R.string.app_name), metadata?.getString(MediaMetadata.METADATA_KEY_TITLE))
        assertNull(metadata?.getString(MediaMetadata.METADATA_KEY_ARTIST))
        assertFalse(metadata?.containsKey(MediaMetadata.METADATA_KEY_DURATION) ?: true)
    }

    @Test
    fun createdSessionIsActiveWithACallbackAndTheGivenState() {
        val session = publisher.createSession(PlaybackState.STATE_PAUSED, stale = false)

        assertNotNull(session)
        assertTrue(session!!.isActive)
        assertNotNull(RecordingMediaSessionShadow.lastMetadata)
    }
}
