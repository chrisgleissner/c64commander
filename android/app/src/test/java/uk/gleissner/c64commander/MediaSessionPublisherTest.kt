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
    private val publisher = MediaSessionPublisher(context) { relayed += it }

    @Before
    fun setUp() {
        RecordingMediaSessionShadow.lastMetadata = null
    }

    private val liveActions =
            PlaybackState.ACTION_PLAY or
                    PlaybackState.ACTION_PAUSE or
                    PlaybackState.ACTION_PLAY_PAUSE or
                    PlaybackState.ACTION_STOP or
                    PlaybackState.ACTION_SKIP_TO_NEXT

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
    }

    @Test
    fun callbackRelaysEachTransportCommandInTheWebLayersVocabulary() {
        publisher.callback.onPlay()
        publisher.callback.onPause()
        publisher.callback.onStop()
        publisher.callback.onSkipToNext()

        assertEquals(
                listOf(
                        BackgroundExecutionService.TRANSPORT_COMMAND_PLAY,
                        BackgroundExecutionService.TRANSPORT_COMMAND_PLAY_PAUSE,
                        BackgroundExecutionService.TRANSPORT_COMMAND_STOP,
                        BackgroundExecutionService.TRANSPORT_COMMAND_NEXT,
                ),
                relayed,
        )
    }

    @Test
    fun nowPlayingIsNormalisedAndARepeatReportsNoChange() {
        assertTrue(publisher.updateNowPlaying(null, "  Commando ", "", 0L))
        assertEquals(NowPlayingMetadata(title = "Commando", artist = null, durationMs = null), publisher.nowPlaying)

        assertFalse(publisher.updateNowPlaying(null, "Commando", "   ", -5L))
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
