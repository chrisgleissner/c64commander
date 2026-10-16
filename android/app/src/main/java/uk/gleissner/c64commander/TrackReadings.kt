/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.media.AudioTrack
import android.os.Build
import android.util.Log

/**
 * The track's own counters, read by the player thread at most every [INTERVAL_NANOS].
 *
 * `underrunCount`, `playbackHeadPosition` and `getTimestamp` are binder round trips to AudioFlinger.
 * Asking on each of ~200 writes a second sometimes left the realtime thread waiting on the audio
 * server when the DAC wanted its next burst: an underrun caused purely by measuring.
 */
internal class TrackReadings(private val track: AudioTrack, private val speaker: SpectrumSpeakerAnchor) {
  @Volatile
  var underruns: Int = 0
    private set

  /** Frames written but not yet played by the track. */
  @Volatile
  var queuedFrames: Long = 0
    private set

  private var lastReadNanos = 0L

  fun refreshOccasionally(now: Long, framesWritten: Long, anchorSpectrum: Boolean) {
    if (now - lastReadNanos < INTERVAL_NANOS) return
    lastReadNanos = now
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      try {
        underruns = track.underrunCount
      } catch (error: Exception) {
        Log.d(TAG, "underrunCount unavailable", error)
      }
    }
    try {
      queuedFrames = (framesWritten - track.playbackHeadPosition.toLong()).coerceAtLeast(0)
      if (anchorSpectrum) speaker.update(track, framesWritten)
    } catch (error: Exception) {
      Log.d(TAG, "playbackHeadPosition unavailable", error)
    }
  }

  private companion object {
    const val TAG = "AudioPipeline"
    const val INTERVAL_NANOS = 100_000_000L
  }
}
