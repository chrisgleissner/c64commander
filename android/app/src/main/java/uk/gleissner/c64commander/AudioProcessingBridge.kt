/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import uk.gleissner.c64commander.dsp.AudioFxHub
import uk.gleissner.c64commander.dsp.SpectrumFrame

/** The small Capacitor surface for the shared native audio-processing state. */
internal class AudioProcessingBridge(private val hub: () -> AudioFxHub) {
  fun setProcessing(call: PluginCall) {
    hub().setParams(
        levelling = call.getBoolean("levelling", false) == true,
        bassDb = call.getDouble("bassDb") ?: 0.0,
        midDb = call.getDouble("midDb") ?: 0.0,
        trebleDb = call.getDouble("trebleDb") ?: 0.0,
        stereoWidth = call.getDouble("stereoWidth") ?: 0.0,
        reverb = call.getDouble("reverb") ?: 0.0,
    )
    call.resolve(JSObject())
  }

  fun setSpectrumEnabled(call: PluginCall) {
    hub().spectrumEnabled = call.getBoolean("enabled", false) == true
    call.resolve(JSObject())
  }

  fun readSpectrum(call: PluginCall) = call.resolve(payload(hub().readSpectrum(call.getDouble("targetNanos", 0.0)?.toLong() ?: 0L)))

  fun payload(frame: SpectrumFrame): JSObject {
    val bands = JSArray()
    for (db in frame.bands) bands.put(db)
    val channels = JSArray()
    for (channel in frame.channels) channels.put(JSObject()
        .put("id", channel.id)
        .put("rmsDb", channel.rmsDb)
        .put("peakDb", channel.peakDb)
        .put("clipped", channel.clipped))
    return JSObject()
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
  }
}
