/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import uk.gleissner.c64commander.dsp.AudioFxHub
import uk.gleissner.c64commander.dsp.FxParams
import uk.gleissner.c64commander.dsp.SpectrumFrame

/** The small Capacitor surface for the shared native audio-processing state. */
internal class AudioProcessingBridge(private val hub: () -> AudioFxHub) {
  fun setProcessing(call: PluginCall) {
    val bands = call.data?.optJSONArray("bandsDb")
    val bandsDb =
        if (bands != null) DoubleArray(bands.length()) { bands.optDouble(it, 0.0) }
        else FxParams.legacyBands(
            call.getDouble("bassDb") ?: 0.0,
            call.getDouble("midDb") ?: 0.0,
            call.getDouble("trebleDb") ?: 0.0,
        )
    hub().setParams(
        levelling = call.getBoolean("levelling", false) == true,
        bandsDb = bandsDb,
        stereoWidth = call.getDouble("stereoWidth") ?: 0.0,
        reverb = call.getDouble("reverb") ?: 0.0,
    )
    call.resolve(JSObject())
  }

  fun setSpectrumEnabled(call: PluginCall) {
    hub().spectrumEnabled = call.getBoolean("enabled", false) == true
    call.resolve(JSObject())
  }

  fun readSpectrum(call: PluginCall) {
    val request = call.data
    val target = request?.opt("targetNanos").asLong()
    val count = request?.opt("count").asLong().toInt().coerceIn(1, MAX_FRAMES_PER_READ)
    val step = request?.opt("stepNanos").asLong()
    val wave = request?.optBoolean("wave", false) ?: false
    val bands = request?.optBoolean("bands", true) ?: true
    val first = hub().analyzer.read(hub().spectrumEnabled, target, wave, bands)
    val result = payload(first)
    if (target > 0L && step > 0L && first.aligned && count > 1) {
      val ahead = JSArray()
      var previous = first.sequence
      for (k in 1 until count) {
        val frame = hub().analyzer.read(hub().spectrumEnabled, target + k * step, wave, bands)
        if (frame.sequence == previous) break
        previous = frame.sequence
        ahead.put(payload(frame))
      }
      result.put("ahead", ahead)
    }
    call.resolve(result)
  }

  fun payload(frame: SpectrumFrame): JSObject {
    val bands = JSArray()
    for (db in frame.bands) bands.put(db)
    val channels = JSArray()
    for (channel in frame.channels) channels.put(JSObject()
        .put("id", channel.id)
        .put("rmsDb", channel.rmsDb)
        .put("peakDb", channel.peakDb)
        .put("clipped", channel.clipped))
    val result = JSObject()
        .put("enabled", frame.enabled)
        .put("active", frame.active)
        .put("sequence", frame.sequence)
        .put("sampleRate", frame.sampleRate)
        .put("bands", bands)
        .put("peakDb", frame.peakDb)
        .put("rmsDb", frame.rmsDb)
        .put("clipped", frame.clipped)
        .put("channels", channels)
        .put("timestampNanos", frame.timestampNanos)
        .put("shortfallSamples", frame.shortfallSamples)
        .put("aligned", frame.aligned)
    frame.wave?.let {
      result.put("wave", Base64.encodeToString(it, Base64.NO_WRAP)).put("waveTriggered", frame.waveTriggered)
    }
    return result
  }

  /** A JSON number arrives as an Int, Long or Double depending on its size; the typed getters drop some of them. */
  private fun Any?.asLong(): Long = (this as? Number)?.toLong() ?: 0L

  private companion object {
    const val MAX_FRAMES_PER_READ = 8
  }
}
