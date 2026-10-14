/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.media.AudioTimestamp
import android.media.AudioTrack
import android.util.Log
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog
import uk.gleissner.c64commander.dsp.SpectrumAnalyzer

@RunWith(RobolectricTestRunner::class)
class SpectrumSpeakerAnchorTest {
  private val rate = 48000
  private val track: AudioTrack = mock(AudioTrack::class.java)
  private val anchor = SpectrumSpeakerAnchor(SpectrumAnalyzer { 0L }.also { it.prepare(rate) })

  @Before
  fun clearLog() {
    ShadowLog.clear()
  }

  private fun logged(type: Int) = ShadowLog.getLogsForTag("SpectrumSpeakerAnchor").filter { it.type == type }

  private fun speakerBehindBy(lagFrames: () -> Long) {
    `when`(track.getTimestamp(any(AudioTimestamp::class.java))).thenAnswer { call ->
      val timestamp = call.getArgument<AudioTimestamp>(0)
      timestamp.framePosition = 10L * rate - lagFrames()
      timestamp.nanoTime = 0L
      true
    }
  }

  @Test
  fun readsEveryTimestampIntoTheSameObject() {
    val seen = mutableListOf<AudioTimestamp>()
    `when`(track.getTimestamp(any(AudioTimestamp::class.java))).thenAnswer { call ->
      seen += call.getArgument<AudioTimestamp>(0)
      true
    }
    repeat(3) { anchor.update(track, 1000L) }
    assertEquals(3, seen.size)
    assertTrue("a new AudioTimestamp was allocated for a reading", seen.all { it === seen[0] })
  }

  @Test
  fun logsAnUnavailableTimestampWhenItStartsAndWhenItEnds() {
    `when`(track.getTimestamp(any(AudioTimestamp::class.java)))
        .thenThrow(IllegalStateException("not playing"))
        .thenThrow(IllegalStateException("not playing"))
        .thenThrow(IllegalStateException("not playing"))
        .thenReturn(true)
        .thenReturn(true)
        .thenThrow(IllegalStateException("released"))
    repeat(6) { anchor.update(track, 0L) }
    assertEquals(2, logged(Log.WARN).size)
    assertEquals(1, logged(Log.INFO).size)
  }

  @Test
  fun logsASpeakerBeyondTheSpectrumHistoryWhenItStartsAndWhenItEnds() {
    var lag = 3L * rate
    speakerBehindBy { lag }
    repeat(3) { anchor.update(track, 10L * rate) }
    lag = 1L * rate
    repeat(3) { anchor.update(track, 10L * rate) }
    assertEquals(1, logged(Log.WARN).size)
    assertTrue(logged(Log.WARN).single().msg.contains("${3 * rate} frames"))
    assertEquals(1, logged(Log.INFO).size)
  }
}
