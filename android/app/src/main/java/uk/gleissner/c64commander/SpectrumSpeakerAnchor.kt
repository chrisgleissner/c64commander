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
import uk.gleissner.c64commander.dsp.SpectrumAnalyzer

/**
 * Tells the analyser how far the track's writes run ahead of the speaker, from the track's own
 * presentation timestamp, which covers the mixer and output latency below the app as well as the
 * track buffer. Without a timestamp (not yet started, or a framework that does not provide one) the
 * analyser keeps the previous position.
 *
 * Runs on the player thread, so it allocates nothing per call and logs a problem when it starts and
 * when it ends rather than on every reading.
 */
internal class SpectrumSpeakerAnchor(private val analyzer: SpectrumAnalyzer) {
  private val timestamp = AudioTimestamp()
  private var timestampFailing = false
  private var beyondHistory = false

  fun update(track: AudioTrack, framesWritten: Long) {
    val available =
        try {
          track.getTimestamp(timestamp)
        } catch (error: IllegalStateException) {
          if (!timestampFailing) Log.w(TAG, "AudioTrack timestamp unavailable; the spectrum keeps its last speaker position", error)
          timestampFailing = true
          return
        }
    if (timestampFailing) Log.i(TAG, "AudioTrack timestamp available again")
    timestampFailing = false
    if (!available) return
    val lag = framesWritten - timestamp.framePosition
    val reachable = analyzer.presentAt(lag, timestamp.nanoTime)
    if (reachable == beyondHistory) {
      if (reachable) {
        Log.i(TAG, "The speaker is back within the spectrum history")
      } else {
        Log.w(TAG, "The speaker lags the writes by $lag frames, beyond the spectrum history; the bars run ahead of the sound")
      }
    }
    beyondHistory = !reachable
  }

  private companion object {
    const val TAG = "SpectrumSpeakerAnchor"
  }
}
