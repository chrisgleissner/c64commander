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
 * Tell the analyser how far the track's writes run ahead of the speaker, from the track's own
 * presentation timestamp, which covers the mixer and output latency below the app as well as the
 * track buffer. Without a timestamp (not yet started, or a framework that does not provide one) the
 * analyser keeps the previous position.
 */
internal fun SpectrumAnalyzer.anchorToSpeaker(track: AudioTrack, framesWritten: Long) {
  val timestamp = AudioTimestamp()
  val available =
      try {
        track.getTimestamp(timestamp)
      } catch (error: IllegalStateException) {
        Log.w("SpectrumSpeakerAnchor", "AudioTrack timestamp unavailable; the spectrum keeps its last speaker position", error)
        false
      }
  if (available) presentAt(framesWritten - timestamp.framePosition, timestamp.nanoTime)
}
