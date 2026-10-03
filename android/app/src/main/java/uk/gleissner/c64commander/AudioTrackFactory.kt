/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build

/**
 * The real speaker track.
 *
 * Built at the DEVICE's output rate, not the stream's. A track whose rate the hardware does not
 * have is resampled by AudioFlinger, and a resampled track cannot use the fast mixer — which is
 * why asking for the C64's 47983 Hz produced a 60 ms minimum buffer and a permanent per-frame
 * conversion in the audio server. Converting to the native rate in this pipeline instead costs a
 * linear interpolation we were going to need anyway for drift correction, and buys the low-latency
 * path back.
 */
internal fun buildAudioTrack(outputRate: Int, bufferBytes: Int): AudioTrack {
  val builder =
      AudioTrack.Builder()
          .setAudioAttributes(
              AudioAttributes.Builder()
                  .setUsage(AudioAttributes.USAGE_MEDIA)
                  .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                  .build(),
          )
          .setAudioFormat(
              AudioFormat.Builder()
                  .setEncoding(AudioPipeline.ENCODING)
                  .setSampleRate(outputRate)
                  .setChannelMask(AudioPipeline.CHANNEL_CONFIG)
                  .build(),
          )
          .setBufferSizeInBytes(bufferBytes)
          .setTransferMode(AudioTrack.MODE_STREAM)
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
    builder.setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
  }
  return builder.build()
}
