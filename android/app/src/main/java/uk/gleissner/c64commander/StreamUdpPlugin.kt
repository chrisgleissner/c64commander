/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.AudioTrack
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Process
import android.util.Base64
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Native UDP receiver for the A/V mirror (Content Explorer). The C64 Ultimate streams raw
 * VIC video / audio as UDP datagrams; a WebView cannot open a UDP socket, so this plugin
 * binds the two ports natively and forwards data to the JS layer. It is the native
 * counterpart of the web server's UDP -> WebSocket bridge.
 *
 * There are two forwarding modes:
 *   - Per-packet (`datagram` events): audio, and video when native assembly is off. Each datagram
 *     is base64-encoded and crosses the Capacitor bridge on its own.
 *   - Native frame assembly (`videoframe` events, `bind({assemble:true})`): the plugin reassembles
 *     the ~68 VIC datagrams of a frame into ONE 52224-byte buffer and crosses the bridge once per
 *     FRAME (~50/s PAL). The per-event bridge overhead of the per-packet path (~3400 events/s) was
 *     the hard cap that held the mirror at ~20–30 fps; assembling natively lifts it to full rate.
 *
 * The firmware's default (and reliable) stream destination is **multicast** — unicast
 * `streams:start` returns "Network Host Resolve Error" because the device streams from its
 * wired port and cannot ARP-resolve a Wi-Fi phone. So `bind` joins the multicast group and
 * holds a Wi-Fi `MulticastLock` (without it, the Wi-Fi driver filters multicast).
 */
@CapacitorPlugin(name = "StreamUdp")
class StreamUdpPlugin : Plugin() {
  private val sockets = ConcurrentHashMap<String, DatagramSocket>()
  private val executor = Executors.newCachedThreadPool()

  /**
   * True while the native pipeline owns audio playback. Read on the receive hot path to decide
   * whether the packet still has to cross the bridge, so it is a plain @Volatile: asking whether a
   * pipeline exists must never wait on whoever is opening or closing one.
   */
  @Volatile private var nativeAudioOwnsPlayback = false

  /**
   * Opt-in: also deliver audio packets to JS for the A/V-sync analyser. Off by default because it
   * costs a base64 encode and a bridge hop per packet on the URGENT_AUDIO thread.
   */
  @Volatile private var audioAnalysisEnabled = false

  /**
   * Distinct source addresses seen on each stream.
   *
   * The mirror's groups are MULTICAST, so any machine on the LAN can send to them — and more than
   * one Ultimate will, because they all default to the same group. Two senders is not a subtle
   * fault: the app receives both at once, at double the expected rate and with two independent
   * sequence spaces interleaved, which is heard as a rough, patchy, wrong-pitch stream while every
   * packet arrives perfectly in order from each sender's point of view.
   *
   * Recording the origins makes that diagnosable in one glance, and lets the app go and stop the
   * stream it did not ask for.
   */
  private val streamSenders = java.util.concurrent.ConcurrentHashMap<String, MutableSet<String>>()

  /**
   * The only machine whose packets a stream will accept, per stream name.
   *
   * Recording the senders (above) makes two-sender interference visible, but it does not make the
   * picture right: the assembler still sees two independent frame-number spaces interleaved, so
   * partial frames from one Ultimate are completed with lines from the other. Measured on the wire
   * with both machines streaming into 239.0.1.64: 20446 and 20436 packets in the same six seconds,
   * which is what a viewer sees as violent flicker between two different screens.
   *
   * Filtering here, before any sequence or frame accounting, is what makes the app show the right
   * frames on its own rather than depending on the other machine being stopped. Empty means accept
   * everything, which is also the state while a host name is still being resolved — failing open
   * for a moment is better than a black screen.
   */
  private val expectedSource = ConcurrentHashMap<String, InetAddress>()

  /** Packets dropped because they came from a machine other than [expectedSource], per stream. */
  private val rejectedPackets = ConcurrentHashMap<String, java.util.concurrent.atomic.AtomicLong>()

  /**
   * The machine whose packets were dropped most recently, per stream.
   *
   * Without it a filter mismatch is indistinguishable from a dead stream: the socket receives at
   * full rate, every packet is dropped, and eight seconds later the card says the stream stopped
   * arriving. Naming the address the packets DID come from is what turns that into a diagnosis the
   * user can act on, so it is reported to JS rather than only logged.
   */
  private val lastRejectedSource = ConcurrentHashMap<String, InetAddress>()
  private val logTag = "StreamUdpPlugin"
  private var multicastLock: WifiManager.MulticastLock? = null

  /** Held for the life of a stream so Wi-Fi stops batching our real-time packets — see [acquireLowLatencyWifi]. */
  private var wifiLock: WifiManager.WifiLock? = null

  /**
   * The native audio path: ring buffer, player thread and speaker track, all in Kotlin (see
   * [AudioPipeline]). JS only opens it, closes it and reads its stats — every PCM byte, whether it
   * came off the UDP socket or out of the on-device SID engine, is paced natively.
   *
   * `@Volatile` rather than lock-guarded on purpose. The receive thread reads this field for every
   * packet, and the previous design had it take the same lock that a JS stats poll held while
   * calling into AudioFlinger — a bridge poll could therefore stall packet reception. Publication of
   * a fully-constructed pipeline is all the receive thread needs, and that is exactly what volatile
   * gives; the pipeline's own internals are thread-safe.
   */
  @Volatile private var audioPipeline: AudioPipeline? = null

  /** Serialises open/close against each other (never against the receive path). */
  private val audioLifecycleLock = Any()

  /** Arrival evenness of the audio stream as this device sees it (see [StreamArrivalMonitor]). */
  private val audioArrivals = StreamArrivalMonitor()

  /** Test seam: monotonic clock (nanoseconds) stamped at socket receive. Default: `System.nanoTime`. */
  internal var clockNanos: () -> Long = { System.nanoTime() }

  /**
   * Test seam: how a received datagram is delivered to JS (default: a `datagram` event).
   *
   * `arrivalMs` is a **monotonic wire-arrival timestamp** (ms, `System.nanoTime`-based) captured
   * the instant the datagram is read off the socket — before the Capacitor bridge hop, base64
   * encoding, frame assembly or decode. The A/V sync analyzer measures the audio↔video offset
   * from these, so the (asymmetric) downstream latency of the two pipelines cannot skew it: both
   * streams are stamped on the same clock at the earliest possible point.
   */
  internal var emitDatagram: (String, String, Double) -> Unit = { name, data, arrivalMs ->
    val event = JSObject()
    event.put("name", name)
    event.put("data", data)
    event.put("t", arrivalMs)
    notifyListeners("datagram", event)
  }

  /**
   * Test seam: how an assembled VIC frame is delivered to JS (default: a `videoframe` event).
   * `data` is base64 of the whole 52224-byte frame, `arrivalMs` the frame-start wire time (earliest
   * packet), `height` the line count (PAL 272 / NTSC 240), `dropped` the cumulative sequence-gap
   * (packet-loss) count, `lost` the cumulative FRAME-loss count (gaps in the frame-number sequence).
   */
  internal var emitFrame: (String, String, Double, Int, Int, Int, Boolean) -> Unit = {
    name,
    data,
    arrivalMs,
    height,
    dropped,
    lost,
    present ->
    val event = JSObject()
    event.put("name", name)
    event.put("data", data)
    event.put("t", arrivalMs)
    event.put("height", height)
    event.put("dropped", dropped)
    event.put("lost", lost)
    event.put("present", present)
    notifyListeners("videoframe", event)
  }

  /**
   * Test seam: how an audio-focus change is delivered to JS (default: an `audiofocus` event).
   *
   * The sink is the only part of the app that knows sound is actually being produced — the A/V
   * mirror and the on-device SID engine both play through it — so focus is requested and released
   * here, and what to do about losing it is decided in JS, where the two sources are told apart.
   */
  internal var emitAudioFocusChange: (String) -> Unit = { change ->
    val event = JSObject()
    event.put("change", change)
    notifyListeners("audiofocus", event)
  }

  // Written from the AudioManager callback on the main Looper and read and written from the
  // Capacitor plugin thread. Without @Volatile the `false` written on AUDIOFOCUS_LOSS need not be
  // visible to the next requestPlaybackAudioFocus(), which would then return early and leave the
  // resumed track playing with focus it no longer holds — the exact no-op the loss handler exists
  // to prevent. The sibling nativeAudioOwnsPlayback and audioPipeline are @Volatile for this.
  @Volatile private var audioFocusRequest: AudioFocusRequest? = null
  @Volatile private var audioFocusHeld = false

  private val audioFocusListener =
    AudioManager.OnAudioFocusChangeListener { focusChange ->
      when (focusChange) {
        AudioManager.AUDIOFOCUS_LOSS -> {
          // The system has taken focus away, so the request this plugin is holding is spent. Not
          // recording that made requestPlaybackAudioFocus a no-op for the rest of the track's life
          // (it returns early while audioFocusHeld is true), so a tune resumed after an interruption
          // played with no focus at all and got no callback for the next one.
          audioFocusHeld = false
          emitAudioFocusChange(FOCUS_LOSS)
        }
        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> emitAudioFocusChange(FOCUS_LOSS_TRANSIENT)
        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
          // Android 8+ ducks an app that has not opted out, and then does not call this at all; on
          // 24/25 nothing ducks unless we do. Attenuating here covers both without a version check.
          audioPipeline?.setDucked(true)
          emitAudioFocusChange(FOCUS_DUCK)
        }
        AudioManager.AUDIOFOCUS_GAIN -> {
          audioPipeline?.setDucked(false)
          emitAudioFocusChange(FOCUS_GAIN)
        }
        else -> Log.d(logTag, "unhandled audio focus change ($focusChange)")
      }
    }

  /**
   * Per-stream keep-rate in permille (0–1000; default 1000 = present every frame). The governor
   * pushes this so the assembler can DECIMATE natively — skipping the ~52 KB Base64 encode + the
   * bridge hop + the JS decode for frames that will not be presented. HIL showed decimating only in
   * JS barely reduced CPU because every frame was still base64'd on both sides; deciding here is what
   * makes the frame-rate governor actually save CPU. Receive, assembly and loss accounting stay
   * complete for EVERY frame (spec §11.4) — only the encode + forward of a skipped frame is elided.
   */
  private val keepPermille = ConcurrentHashMap<String, Int>()

  @PluginMethod
  fun setKeepFraction(call: PluginCall) {
    val name = call.getString("name")
    if (name == null) {
      call.reject("name is required")
      return
    }
    val permille = (call.getInt("permille") ?: 1000).coerceIn(0, 1000)
    keepPermille[name] = permille
    call.resolve(JSObject())
  }

  /**
   * Name the machine a stream should accept packets from. Called again on a device switch, so the
   * filter follows the selection without tearing the socket down.
   *
   * Resolution happens off the caller's thread: a host name that needs DNS/mDNS can take hundreds of
   * milliseconds, and blocking the bridge for that would stall the UI. `null`/blank clears it.
   */
  @PluginMethod
  fun setExpectedSource(call: PluginCall) {
    val name = call.getString("name")
    if (name == null) {
      call.reject("name is required")
      return
    }
    applyExpectedSource(name, call.getString("host"))
    call.resolve(JSObject())
  }

  /**
   * What the sender filter has done to a stream: how much it dropped, and whose packets those were.
   *
   * Read when a live stream goes silent. A filter keyed to the wrong address of a dual-homed
   * Ultimate receives at full rate and drops everything, which looks exactly like a stream that
   * stopped: same silent socket, same watchdog, same message. These two numbers are the only
   * evidence that separates the two, so they have to leave the plugin.
   */
  @PluginMethod
  fun readStreamDiagnostics(call: PluginCall) {
    val name = call.getString("name")
    if (name == null) {
      call.reject("name is required")
      return
    }
    val result = JSObject()
    result.put("rejectedPackets", rejectedPackets[name]?.get() ?: 0L)
    result.put("lastRejectedSource", lastRejectedSource[name]?.hostAddress)
    result.put("expectedSource", expectedSource[name]?.hostAddress)
    val senders = JSArray()
    streamSenders[name]?.forEach { senders.put(it) }
    result.put("senders", senders)
    call.resolve(result)
  }

  private fun applyExpectedSource(name: String, host: String?) {
    // A new filter identity makes the old rejection count a statement about a question nobody is
    // asking any more, so adopting a sender (or rebinding) starts the diagnosis from zero.
    rejectedPackets.remove(name)
    lastRejectedSource.remove(name)
    val trimmed = host?.trim()?.substringBefore(':')?.takeIf { it.isNotEmpty() }
    if (trimmed == null) {
      expectedSource.remove(name)
      return
    }
    executor.execute {
      try {
        val resolved = InetAddress.getByName(trimmed)
        expectedSource[name] = resolved
        Log.i(logTag, "stream $name: accepting packets only from $trimmed (${resolved.hostAddress})")
      } catch (error: Exception) {
        // Leave the filter open rather than dropping every packet for an unresolvable name.
        expectedSource.remove(name)
        Log.w(logTag, "stream $name: could not resolve expected sender $trimmed; accepting all", error)
      }
    }
  }

  /**
   * True when this packet came from a machine the stream was not told to listen to.
   *
   * Called per packet on both hot paths, so the common case — filter unset, or the address object
   * the socket reuses for the same peer — costs a reference compare.
   */
  private fun isForeign(name: String, source: InetAddress?): Boolean {
    val expected = expectedSource[name] ?: return false
    if (source === expected || source == expected) return false
    // Reference compare first: the socket reuses one address object per peer, so the common case of
    // a steady foreign stream costs no map write on a path that runs ~3400 times a second.
    if (source != null && lastRejectedSource[name] !== source) lastRejectedSource[name] = source
    val counter = rejectedPackets.getOrPut(name) { java.util.concurrent.atomic.AtomicLong() }
    val n = counter.incrementAndGet()
    if (n == 1L || n % FOREIGN_LOG_EVERY == 0L) {
      Log.w(logTag, "stream $name: dropped $n packet(s) from ${source?.hostAddress} (expected ${expected.hostAddress})")
    }
    return true
  }

  @PluginMethod
  fun bind(call: PluginCall) {
    val name = call.getString("name")
    if (name == null) {
      call.reject("name is required")
      return
    }
    val port = call.getInt("port")
    if (port == null) {
      call.reject("port is required")
      return
    }
    val group = call.getString("group") // multicast group, e.g. 239.0.1.64; null = plain unicast
    val assemble = call.getBoolean("assemble", false) == true
    try {
      closeSocket(name)
      applyExpectedSource(name, call.getString("source"))
      val socket: DatagramSocket =
        if (group != null) {
          acquireMulticastLock()
          MulticastSocket(null).apply {
            reuseAddress = true
            bind(InetSocketAddress(port))
            val netIf = siteLocalInterface()
            joinGroup(InetSocketAddress(InetAddress.getByName(group), port), netIf)
          }
        } else {
          DatagramSocket(null).apply {
            reuseAddress = true
            bind(InetSocketAddress(port))
          }
        }
      // Enlarge the OS receive buffer so a scheduling gap or GC pause can't silently drop packets:
      // video is ~3400 pkt/s × ~780 B ≈ 2.6 MB/s, so the small default SO_RCVBUF can overflow under
      // load (HIL saw occasional drops even on a clean LAN). The OS may cap the request; harmless.
      try {
        socket.receiveBufferSize = RECV_BUFFER_BYTES
      } catch (error: Exception) {
        Log.d(logTag, "receiveBufferSize hint ignored for $name", error)
      }
      sockets[name] = socket
      if (assemble) {
        executor.execute { assembleLoop(name, socket) }
      } else {
        executor.execute { receiveLoop(name, socket) }
      }
      val result = JSObject()
      result.put("localIp", siteLocalIpv4() ?: "")
      result.put("port", socket.localPort)
      call.resolve(result)
    } catch (error: Exception) {
      // Release the multicast lock if we acquired it above but never got a running socket, so a
      // failed multicast bind cannot leak the Wi-Fi MulticastLock (it is not reference-counted).
      if (sockets.isEmpty()) releaseMulticastLock()
      Log.w(logTag, "bind failed for $name:$port (group=$group, assemble=$assemble)", error)
      call.reject("bind failed: ${error.message}", error)
    }
  }

  @PluginMethod
  fun close(call: PluginCall) {
    val name = call.getString("name")
    if (name == null) {
      call.reject("name is required")
      return
    }
    closeSocket(name)
    streamSenders.remove(name)
    rejectedPackets.remove(name)
    lastRejectedSource.remove(name)
    call.resolve(JSObject())
  }

  @PluginMethod
  fun openAudioTrack(call: PluginCall) {
    val sampleRate = call.getInt("sampleRate") ?: DEFAULT_AUDIO_SAMPLE_RATE
    // Target output latency (ms). The pipeline splits it between its jitter ring and the speaker
    // track's own buffer; absent → its floor.
    val bufferMs = call.getInt("bufferMs") ?: 0
    // How deep the ring may go. On-device playback asks for far more than the mirror does: it is not
    // a live stream, so depth costs nothing anyone can hear, and it is what makes the feed survive a
    // busy JS thread.
    val maxRingMs = call.getInt("maxRingMs") ?: 0
    // How deep the AudioTrack's own buffer is, in HAL bursts. On-device playback asks for more than
    // the mirror: it has no input latency to protect, and a deeper track buffer is what absorbs the
    // player thread being descheduled.
    val trackBursts = call.getInt("trackBursts") ?: 0
    // Depth to reach before the first sound. Kept small on a deep ring so playback starts promptly.
    val primeMs = call.getInt("primeMs") ?: 0
    try {
      synchronized(audioLifecycleLock) {
        audioPipeline?.close()
        val pipeline =
            AudioPipeline(
                sampleRate,
                bufferMs,
                nativeOutputRate(),
                nativeFramesPerBurst(),
                maxRingMs = maxRingMs,
                trackBursts = trackBursts,
                primeMs = primeMs,
            )
        pipeline.start()
        audioPipeline = pipeline
        requestPlaybackAudioFocus()
        nativeAudioOwnsPlayback = true
        audioArrivals.reset()
        val result = JSObject()
        result.put("sampleRate", sampleRate)
        result.put("bufferMs", pipeline.bufferCapacityMs)
        call.resolve(result)
      }
    } catch (error: Exception) {
      Log.w(logTag, "openAudioTrack failed (rate=$sampleRate)", error)
      call.reject("openAudioTrack failed: ${error.message}", error)
    }
  }

  /**
   * Feed PCM from JS — the on-device SID engine's path to the speaker.
   *
   * It lands in the same [AudioPipeline] the A/V mirror feeds, so a rendered tune is paced by the
   * DAC through the same ring and the same blocking writer as a mirrored one. Before this the two
   * sounded different because they *were* different: the mirror had a native sink while the engine
   * scheduled a Web Audio `BufferSource` per chunk from the JS thread.
   */
  @PluginMethod
  fun writeAudioTrack(call: PluginCall) {
    val data = call.getString("data")
    if (data == null) {
      call.reject("data is required")
      return
    }
    val pcm = Base64.decode(data, Base64.NO_WRAP)
    val pipeline = audioPipeline
    pipeline?.offer(pcm, 0, pcm.size)
    call.resolve(audioStatsPayload(pipeline?.stats() ?: AudioPipeline.Stats.ZERO))
  }

  /**
   * Hold the speaker where it is, keeping every queued sample, for a listener's pause.
   *
   * Distinct from [flushAudioTrack], which exists for a seek: a seek invalidates the queued audio,
   * a pause does not.
   */
  @PluginMethod
  fun pauseAudioTrack(call: PluginCall) {
    audioPipeline?.pause()
    call.resolve(JSObject())
  }

  /** Continue a [pauseAudioTrack] from the sample it stopped on. */
  @PluginMethod
  fun resumeAudioTrack(call: PluginCall) {
    audioPipeline?.resume()
    call.resolve(JSObject())
  }

  /** Drop queued-but-unplayed audio, so a pause or a seek takes effect at once. */
  @PluginMethod
  fun flushAudioTrack(call: PluginCall) {
    audioPipeline?.flush()
    call.resolve(JSObject())
  }

  @PluginMethod
  fun readAudioStats(call: PluginCall) {
    // The governor's audio-headroom signal, and the diagnostics read. Plain field reads — no lock the
    // receive path shares, and no AudioFlinger round trip on the caller's thread.
    val stats = audioPipeline?.stats() ?: AudioPipeline.Stats.ZERO
    val result = audioStatsPayload(stats)
    // `reset:true` starts a fresh arrival window. The governor polls without it, so its routine read
    // never clears the maxima a measurement is collecting.
    if (call.getBoolean("reset", false) == true) audioArrivals.reset()
    call.resolve(result)
  }

  /**
   * Everything a caller can learn about the audio path, in one shape for both entry points.
   *
   * It deliberately reports the two failures separately. Audio the pipeline could not accept
   * (`droppedBytes`) and silence it had to invent (`concealedMs`) are opposite faults — arriving too
   * fast versus not arriving at all — and a stream that is breaking up used to be able to show a
   * clean underrun count and look healthy because only one of them was counted.
   */
  private fun audioStatsPayload(stats: AudioPipeline.Stats): JSObject {
    val result = JSObject()
    result.put("bufferedMs", stats.bufferedMs)
    result.put("underruns", stats.underruns)
    result.put("droppedBytes", stats.droppedBytes)
    result.put("concealedMs", stats.concealedMs)
    result.put("jitterBufferMs", stats.jitterBufferMs)
    // The cushion the pipeline decided this link needs, and how hard the converter is working to
    // hold it. Reported because "how deep is the buffer" alone cannot tell a healthy stream from one
    // that is only staying afloat by playing everything fractionally fast.
    result.put("targetJitterMs", stats.targetJitterMs)
    result.put("driftCorrection", stats.driftCorrection)
    // What the track is ACTUALLY doing, not what was requested. A track running at a different rate
    // or channel count than the stream plays it at the wrong speed and pitch while quietly
    // overflowing its buffer, and nothing else in the stats would show it.
    result.put("trackSampleRate", stats.trackSampleRate)
    result.put("trackChannels", stats.trackChannels)
    result.put("trackBufferFrames", stats.trackBufferFrames)
    val arrivals = audioArrivals.snapshot()
    val arrival = JSObject()
    arrival.put("packets", arrivals.packets)
    arrival.put("meanGapMs", arrivals.meanGapMs)
    arrival.put("maxGapMs", arrivals.maxGapMs)
    arrival.put("gapsOver20ms", arrivals.gapsOver20ms)
    arrival.put("gapsOver50ms", arrivals.gapsOver50ms)
    arrival.put("maxClump", arrivals.maxClump)
    arrival.put("lostPackets", arrivals.lostPackets)
    result.put("arrival", arrival)
    val senders = JSArray()
    streamSenders["audio"]?.forEach { senders.put(it) }
    result.put("senders", senders)
    // What the sender filter refused, beside what it let through. A stream can look perfectly dead
    // here while the socket is busy; these two say which of the two it is.
    result.put("rejectedPackets", rejectedPackets["audio"]?.get() ?: 0L)
    result.put("lastRejectedSource", lastRejectedSource["audio"]?.hostAddress)
    return result
  }

  /**
   * The rate the device's mixer actually runs at.
   *
   * An `AudioTrack` opened at any other rate is resampled inside AudioFlinger, and a resampled track
   * is excluded from the fast mixer — so asking for the C64's 47983 Hz cost both the low-latency path
   * and a conversion per frame in the audio server. The pipeline converts to this rate itself.
   */
  private fun nativeOutputRate(): Int = audioProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE, DEFAULT_OUTPUT_SAMPLE_RATE)

  /** The HAL's buffer quantum. A track buffer that is a whole number of these can take the fast path. */
  private fun nativeFramesPerBurst(): Int = audioProperty(AudioManager.PROPERTY_OUTPUT_FRAMES_PER_BUFFER, 0)

  private fun audioProperty(name: String, fallback: Int): Int =
    try {
      val audio = context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      audio?.getProperty(name)?.toIntOrNull()?.takeIf { it > 0 } ?: fallback
    } catch (error: Exception) {
      Log.d(logTag, "audio property $name unavailable", error)
      fallback
    }

  /**
   * Arm a recording of exactly what the pipeline hands the speaker.
   *
   * Diagnostics: it lets an end-to-end probe be graded without a microphone, covering the network,
   * the jitter buffer, the resampler and the concealment — everything the app is responsible for.
   */
  @PluginMethod
  fun startAudioCapture(call: PluginCall) {
    audioPipeline?.startCapture(call.getInt("seconds") ?: 10)
    call.resolve(JSObject())
  }

  /**
   * Write the captured PCM to a WAV in the app's external files directory and return its path.
   *
   * A file rather than a base64 payload: ten seconds of stereo 48 kHz is nearly three megabytes, and
   * handing that back through a single bridge call returns a truncated string that is not valid JSON.
   * The external files directory is chosen because `adb pull` can read it without the app being
   * debuggable, so a diagnostic capture works against a release build.
   */
  @PluginMethod
  fun readAudioCapture(call: PluginCall) {
    val pipeline = audioPipeline
    val pcm = pipeline?.takeCapture() ?: ByteArray(0)
    val rate = pipeline?.stats()?.trackSampleRate ?: 0
    val result = JSObject()
    result.put("bytes", pcm.size)
    result.put("sampleRate", rate)
    if (pcm.isEmpty() || rate <= 0) {
      call.resolve(result)
      return
    }
    try {
      val file = java.io.File(context.getExternalFilesDir(null), "audio-capture.wav")
      java.io.FileOutputStream(file).use { out ->
        out.write(wavHeader(pcm.size, rate))
        out.write(pcm)
      }
      result.put("path", file.absolutePath)
    } catch (error: Exception) {
      Log.w(logTag, "audio capture write failed", error)
      call.reject("audio capture write failed: ${error.message}", error)
      return
    }
    call.resolve(result)
  }

  /** A 44-byte canonical WAV header for interleaved stereo S16LE. */
  private fun wavHeader(dataBytes: Int, rate: Int): ByteArray {
    val header = java.nio.ByteBuffer.allocate(44).order(java.nio.ByteOrder.LITTLE_ENDIAN)
    header.put("RIFF".toByteArray())
    header.putInt(36 + dataBytes)
    header.put("WAVEfmt ".toByteArray())
    header.putInt(16)
    header.putShort(1)
    header.putShort(2)
    header.putInt(rate)
    header.putInt(rate * 4)
    header.putShort(4)
    header.putShort(16)
    header.put("data".toByteArray())
    header.putInt(dataBytes)
    return header.array()
  }

  @PluginMethod
  fun setAudioAnalysis(call: PluginCall) {
    // Turning this on re-enables the per-packet bridge hop for audio (A/V-sync analyser only).
    audioAnalysisEnabled = call.getBoolean("enabled", false) == true
    call.resolve(JSObject())
  }

  /**
   * Set the on-device playback attenuation, 0.0 (silent) to 1.0 (unchanged).
   *
   * Applied on the player thread as samples leave the ring, not where they are produced: the sink
   * keeps up to twenty seconds scheduled ahead, so attenuating at production means the listener
   * hears the change twenty seconds after moving the slider. The device's media volume is never
   * touched — this only scales the samples this app is about to play.
   */
  @PluginMethod
  fun setAudioTrackGain(call: PluginCall) {
    val gain = call.getDouble("gain") ?: 1.0
    synchronized(audioLifecycleLock) {
      audioPipeline?.setGain(gain)
    }
    call.resolve(JSObject())
  }

  /**
   * Ask for audio focus again for a sink that is already open.
   *
   * Focus is normally taken in `openAudioTrack`, but a pause does not close the track: an
   * interruption suspends the JS side and leaves the native pipeline in place. The resume therefore
   * has no `openAudioTrack` to ride on, and this is the call that gives it one.
   */
  @PluginMethod
  fun requestAudioFocus(call: PluginCall) {
    requestPlaybackAudioFocus()
    val result = JSObject()
    result.put("granted", audioFocusHeld)
    call.resolve(result)
  }

  @PluginMethod
  fun closeAudioTrack(call: PluginCall) {
    nativeAudioOwnsPlayback = false
    synchronized(audioLifecycleLock) {
      audioPipeline?.close()
      audioPipeline = null
    }
    abandonPlaybackAudioFocus()
    call.resolve(JSObject())
  }

  /**
   * Take audio focus for as long as this app is producing sound.
   *
   * Focus used to be requested by the background-execution service, which starts for a tune on the
   * Play page and not for the A/V mirror, and abandons on its own lifecycle rather than the
   * speaker's. Requesting it where the samples are actually played covers both sources, tells
   * whatever was playing to stop, and gives the app a loss callback it can act on.
   */
  private fun requestPlaybackAudioFocus() {
    if (audioFocusHeld) return
    val manager = audioManager() ?: return
    try {
      val result =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          val request =
            audioFocusRequest
              ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                  AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
                )
                .setOnAudioFocusChangeListener(audioFocusListener)
                .build()
                .also { audioFocusRequest = it }
          manager.requestAudioFocus(request)
        } else {
          @Suppress("DEPRECATION")
          manager.requestAudioFocus(
            audioFocusListener,
            AudioManager.STREAM_MUSIC,
            AudioManager.AUDIOFOCUS_GAIN,
          )
        }
      audioFocusHeld = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
      if (!audioFocusHeld) Log.w(logTag, "audio focus not granted (result=$result)")
    } catch (error: Exception) {
      Log.w(logTag, "audio focus request failed", error)
    }
  }

  /** Give focus back when the sink closes, so another app is free to play. */
  private fun abandonPlaybackAudioFocus() {
    val manager = audioManager()
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        audioFocusRequest?.let { manager?.abandonAudioFocusRequest(it) }
      } else {
        @Suppress("DEPRECATION")
        manager?.abandonAudioFocus(audioFocusListener)
      }
    } catch (error: Exception) {
      Log.w(logTag, "abandoning audio focus failed", error)
    } finally {
      audioFocusRequest = null
      audioFocusHeld = false
    }
  }

  private fun audioManager(): AudioManager? =
    try {
      context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    } catch (error: Exception) {
      Log.w(logTag, "AudioManager unavailable", error)
      null
    }

  private fun receiveLoop(name: String, socket: DatagramSocket) {
    raiseThreadPriority(name)
    // VIC packets are ~780 bytes and audio ~770; 2048 leaves ample headroom.
    val buffer = ByteArray(2048)
    // Reuse one DatagramPacket across the loop (reset its length each time) to avoid a per-packet
    // allocation on the hot receive thread (~3400/s video) — less GC pressure (spec §1.4).
    val packet = DatagramPacket(buffer, buffer.size)
    val stats = RateLog(name, "raw")
    // Frame/loss accounting only makes sense for the VIC video stream; applying VIC last-line/
    // frame-number parsing to AUDIO packets reads PCM bytes as frame numbers and reports garbage
    // (HIL saw audio "lost" climbing into the thousands). Audio reports packets/s only.
    val countFrames = name == "video"
    var prevCompletedFrame = -1
    var lost = 0
    // Cheap origin tracking: the address object is reused by the socket for the same peer, so a
    // reference compare keeps the common single-sender case free of allocation and set lookups.
    var lastSender: java.net.InetAddress? = null
    val senders = streamSenders.getOrPut(name) { java.util.concurrent.ConcurrentHashMap.newKeySet() }
    while (!socket.isClosed) {
      try {
        packet.setLength(buffer.size)
        socket.receive(packet)
        // Stamp wire-arrival time immediately, before any encoding/bridge latency (see emitDatagram).
        val arrivalNanos = clockNanos()
        val source = packet.address
        if (source !== lastSender) {
          lastSender = source
          val ip = source?.hostAddress
          if (ip != null && senders.size < MAX_TRACKED_SENDERS && senders.add(ip)) {
            Log.i(logTag, "stream $name: sender $ip (distinct senders now ${senders.size})")
          }
        }
        // Before any sequence or loss accounting: a foreign packet must not enter this stream's
        // state at all, or it is counted as our sender's loss and mixed into our playback.
        if (isForeign(name, source)) continue
        // PLAYBACK FIRST, telemetry second — the order matters on this thread.
        //
        // This is the URGENT_AUDIO receive thread and it is the real-time path. The base64 encode +
        // Capacitor bridge hop below is analysis, and it used to run BEFORE the PCM was handed on:
        // every audio packet paid a JSON serialisation and a WebView dispatch before a single sample
        // reached the mixer. Whenever the JS thread was busy — and it often is, painting video or
        // hydrating HVSC — that delay landed directly on playback, which is audible as roughness.
        //
        // The handoff is now a memcpy into the pipeline's ring and nothing else: no AudioTrack call,
        // no AudioFlinger round trip, and no lock a JS stats poll can be holding. Strip the 2-byte
        // seq and keep whole stereo frames; the seq itself goes to the arrival monitor, which is
        // what makes real packet loss distinguishable from this app losing its own audio.
        if (name == "audio") {
          val seq =
            if (packet.length >= AUDIO_SEQ_BYTES) u16(packet.data, packet.offset) else -1
          val lostBefore = audioArrivals.lostPackets
          audioArrivals.record(arrivalNanos, seq)
          audioPipeline?.let { pipeline ->
            val pcmOffset = packet.offset + AUDIO_SEQ_BYTES
            val avail = packet.length - AUDIO_SEQ_BYTES
            val pcmLen = avail - (avail % AUDIO_BYTES_PER_FRAME)
            // Multicast over Wi-Fi is sent once, at the basic rate, with no acknowledgement and no
            // retry, so a percent or two of it simply does not arrive — 183 packets in half a minute
            // on this rig. Splicing the next packet straight on turns each of those into a waveform
            // discontinuity, which is a click. Filling the hole with a fading repeat of what came
            // before keeps the timeline honest and makes the loss much harder to hear.
            val lost = (audioArrivals.lostPackets - lostBefore).toInt()
            if (lost in 1..MAX_CONCEALED_PACKETS && pcmLen > 0) {
              pipeline.concealLostPackets(lost * (pcmLen / AUDIO_BYTES_PER_FRAME))
            }
            if (pcmLen > 0) pipeline.offer(packet.data, pcmOffset, pcmLen)
          }
        }
        // The per-packet bridge hop is the most expensive thing on this thread, and for audio it is
        // usually pure waste: ~250 packets/s each allocating a base64 String, boxing a JSObject and
        // crossing into the WebView, for a stream the NATIVE sink is already playing. JS wants these
        // only for the A/V-sync analyser, which is a developer tool and off by default.
        //
        // Video already avoids this via `assemble:true` (one event per frame instead of 68), and
        // skipping it here is the same idea applied to audio: when the native sink owns playback and
        // nobody asked for analysis, the packet never leaves Kotlin.
        if (!(name == "audio" && nativeAudioOwnsPlayback && !audioAnalysisEnabled)) {
          val encoded = Base64.encodeToString(packet.data, packet.offset, packet.length, Base64.NO_WRAP)
          emitDatagram(name, encoded, arrivalNanos / 1_000_000.0)
        }
        // Count a completed frame when this datagram carries the last-line flag (cheap header peek),
        // and track frame-number gaps, so the per-second measurement log reports frames/s AND frame
        // loss even on the per-packet path (JS still does the authoritative assembly + loss counting).
        var completedFrame = false
        if (countFrames && packet.length >= VIC_HEADER_BYTES && isLastLine(packet.data, packet.offset)) {
          completedFrame = true
          val frameNum = u16(packet.data, packet.offset + 2)
          if (prevCompletedFrame >= 0) {
            val gap = (frameNum - prevCompletedFrame).toShort().toInt()
            if (gap > 1) lost += gap - 1
          }
          prevCompletedFrame = frameNum
        }
        stats.record(arrivalNanos, if (completedFrame) 1 else 0, 0, lost)
      } catch (error: Exception) {
        if (socket.isClosed) break
        // Transient receive error on a still-open socket: log with the stack trace (mandatory
        // exception handling) and keep listening rather than tearing the stream down.
        Log.w(logTag, "Transient receive error on $name socket; continuing", error)
      }
    }
  }

  /**
   * Raise the receive thread's scheduling priority so a busy device can't starve packet reception
   * (packet-loss resilience, spec §10.3). Audio feeds real-time playback → URGENT_AUDIO; video →
   * DISPLAY. Threads default to background priority otherwise.
   */
  private fun raiseThreadPriority(name: String) {
    try {
      Process.setThreadPriority(
        if (name == "audio") Process.THREAD_PRIORITY_URGENT_AUDIO else Process.THREAD_PRIORITY_DISPLAY,
      )
    } catch (error: Exception) {
      Log.d(logTag, "setThreadPriority ignored for $name", error)
    }
  }

  /**
   * Native VIC frame assembler (the Live View fast path). Reassembles the per-line datagrams of a
   * frame into one 52224-byte 4bpp buffer and emits it as a single `videoframe` event, collapsing
   * ~68 bridge hops per frame into one. Format/guard rules mirror the JS `VicStreamAssembler` and
   * c64stream exactly (width 384, 4 lines/packet, 4 bpp). Thread-confined: the buffer and all
   * assembly state live on this receive thread, so no synchronisation is needed.
   */
  private fun assembleLoop(name: String, socket: DatagramSocket) {
    raiseThreadPriority(name)
    val buffer = ByteArray(2048)
    // Reuse one DatagramPacket across the loop (reset length per receive) — no per-packet alloc on
    // the hot video receive thread (~3400/s).
    val packet = DatagramPacket(buffer, buffer.size)
    val frame = ByteArray(VIC_BYTES_PER_FRAME)
    var lastSeq = -1
    var dropped = 0
    var lost = 0
    var prevCompletedFrame = -1
    var curFrameNum = -1
    var frameStartNanos = Long.MAX_VALUE
    var frameHeight = VIC_PAL_HEIGHT
    // Bresenham phase accumulator (permille units) for native cadence decimation; thread-confined.
    var phaseAccum = 0
    // Same cheap origin tracking as the per-packet loop: the socket reuses the address object for
    // the same peer, so the single-sender case stays a reference compare.
    var lastAssemblySender: java.net.InetAddress? = null
    val assemblySenders = streamSenders.getOrPut(name) { java.util.concurrent.ConcurrentHashMap.newKeySet() }
    val stats = RateLog(name, "assembled")
    while (!socket.isClosed) {
      try {
        packet.setLength(buffer.size)
        socket.receive(packet)
        val arrivalNanos = clockNanos()
        // Drop a foreign sender's packet before it reaches the assembler. Two Ultimates on one
        // multicast group carry two independent frame-number spaces, so an unfiltered assembler
        // completes one machine's partial frame with the other machine's lines — which is the
        // violent flicker, and the apparent frame-rate collapse, seen on the rig.
        val source = packet.address
        if (source !== lastAssemblySender) {
          lastAssemblySender = source
          val ip = source?.hostAddress
          if (ip != null && assemblySenders.size < MAX_TRACKED_SENDERS && assemblySenders.add(ip)) {
            Log.i(logTag, "stream $name: sender $ip (distinct senders now ${assemblySenders.size})")
          }
        }
        if (isForeign(name, source)) continue
        val data = packet.data
        val off = packet.offset
        val len = packet.length
        if (len < VIC_HEADER_BYTES) {
          continue
        }

        val seq = u16(data, off + 0)
        val frameNum = u16(data, off + 2)
        val lineRaw = u16(data, off + 4)
        val line = lineRaw and 0x7FFF
        val lastLine = (lineRaw and LAST_LINE_FLAG) != 0
        val width = u16(data, off + 6)
        val linesPerPacket = data[off + 8].toInt() and 0xFF
        val bpp = data[off + 9].toInt() and 0xFF

        // Dropped-packet accounting via 16-bit sequence gaps (mirrors VicStreamAssembler).
        if (lastSeq >= 0) {
          val gap = (seq - lastSeq - 1) and 0xFFFF
          if (gap in 1 until 0x8000) dropped += gap
        }
        lastSeq = seq

        // Frame-start = the earliest wire arrival of any packet of this frame (top of frame == when
        // the av-sync tone gate opens), so the analyzer can cancel the asymmetric assembly latency.
        if (frameNum != curFrameNum) {
          curFrameNum = frameNum
          frameStartNanos = arrivalNanos
        } else if (arrivalNanos < frameStartNanos) {
          frameStartNanos = arrivalNanos
        }

        val valid = width == VIC_FRAME_WIDTH && linesPerPacket == VIC_LINES_PER_PACKET && bpp == VIC_BITS_PER_PIXEL
        if (valid) {
          val writeOffset = line * VIC_BYTES_PER_LINE
          if (writeOffset < VIC_BYTES_PER_FRAME) {
            val available = VIC_BYTES_PER_FRAME - writeOffset
            val payloadLen = len - VIC_HEADER_BYTES
            val count = minOf(payloadLen, linesPerPacket * VIC_BYTES_PER_LINE, available)
            if (count > 0) System.arraycopy(data, off + VIC_HEADER_BYTES, frame, writeOffset, count)
          }
        }

        if (lastLine) {
          // Height derives from the last packet (line + linesPerPacket), clamped to [NTSC, PAL].
          frameHeight = clampFrameHeight(line + (if (linesPerPacket > 0) linesPerPacket else VIC_LINES_PER_PACKET))
          // Frame-loss: a jump of >1 in the frame number between consecutively completed frames means
          // the intervening frame(s) never completed. Wrap-safe (65535→0) via Short truncation.
          // Only advance the baseline on FORWARD progress (gap >= 1): a UDP-reordered late frame
          // (gap <= 0) must not move it backward, or the next forward frame would recompute an
          // inflated gap and double-count a loss that never happened. Mirrors VicStreamAssembler.
          if (prevCompletedFrame < 0) {
            prevCompletedFrame = frameNum
          } else {
            val gap = (frameNum - prevCompletedFrame).toShort().toInt()
            if (gap > 1) lost += gap - 1
            if (gap >= 1) prevCompletedFrame = frameNum
          }
          // Native cadence decision: present this frame only when the accumulator crosses 1000.
          // A skipped frame emits a tiny event (empty data, present=false) so JS still counts it —
          // but its ~52 KB Base64 encode + bridge payload are elided (the CPU win).
          val permille = keepPermille[name] ?: DEFAULT_KEEP_PERMILLE
          phaseAccum += permille
          val present = phaseAccum >= 1000
          if (present) phaseAccum -= 1000
          val encoded =
            if (present) Base64.encodeToString(frame, 0, VIC_BYTES_PER_FRAME, Base64.NO_WRAP) else ""
          emitFrame(name, encoded, frameStartNanos / 1_000_000.0, frameHeight, dropped, lost, present)
          curFrameNum = -1
          frameStartNanos = Long.MAX_VALUE
          stats.record(arrivalNanos, 1, dropped, lost)
        } else {
          stats.record(arrivalNanos, 0, dropped, lost)
        }
      } catch (error: Exception) {
        if (socket.isClosed) break
        Log.w(logTag, "Transient receive error on $name assembler; continuing", error)
      }
    }
  }

  /** Peek a datagram's VIC last-line flag without full parsing (little-endian u16 at offset 4). */
  private fun isLastLine(data: ByteArray, offset: Int): Boolean = (u16(data, offset + 4) and LAST_LINE_FLAG) != 0

  private fun u16(data: ByteArray, index: Int): Int =
    (data[index].toInt() and 0xFF) or ((data[index + 1].toInt() and 0xFF) shl 8)

  private fun clampFrameHeight(height: Int): Int =
    if (height < VIC_NTSC_HEIGHT) VIC_NTSC_HEIGHT else if (height > VIC_PAL_HEIGHT) VIC_PAL_HEIGHT else height

  /**
   * Per-second frame-progression measurement (the c64stream network/obs-CSV analysis, delivered
   * through logcat). One `Log.i` a second reports packets/s, frames/s and cumulative drops so a
   * `adb logcat -s StreamUdpPlugin` capture shows the wire rate and whether the pipeline keeps up.
   */
  private inner class RateLog(private val name: String, private val mode: String) {
    private var windowStartNanos = 0L
    private var packets = 0
    private var frames = 0

    fun record(arrivalNanos: Long, framesCompleted: Int, dropped: Int, lost: Int) {
      if (windowStartNanos == 0L) windowStartNanos = arrivalNanos
      packets += 1
      frames += framesCompleted
      val elapsed = arrivalNanos - windowStartNanos
      if (elapsed >= 1_000_000_000L) {
        val secs = elapsed / 1_000_000_000.0
        Log.i(
          logTag,
          "progression name=$name mode=$mode fps=%.1f pkts/s=%.0f dropped=%d lost=%d".format(
            frames / secs,
            packets / secs,
            dropped,
            lost,
          ),
        )
        windowStartNanos = arrivalNanos
        packets = 0
        frames = 0
      }
    }
  }

  private fun closeSocket(name: String) {
    sockets.remove(name)?.let {
      try {
        it.close()
      } catch (error: Exception) {
        Log.d(logTag, "socket close for $name ignored", error)
      }
    }
    if (sockets.isEmpty()) releaseMulticastLock()
  }

  private fun acquireMulticastLock() {
    val wifi =
      try {
        context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
      } catch (error: Exception) {
        Log.w(logTag, "WifiManager unavailable", error)
        null
      }
    // Independently, both of them: the mirror binds two streams, and guarding the pair behind one
    // "already held" check meant the second lock was silently skipped whenever the first was up.
    if (multicastLock?.isHeld != true) {
      try {
        multicastLock =
          wifi?.createMulticastLock("c64commander-avmirror")?.apply {
            setReferenceCounted(false)
            acquire()
          }
      } catch (error: Exception) {
        Log.w(logTag, "MulticastLock acquire failed", error)
      }
    }
    acquireLowLatencyWifi(wifi)
  }

  /**
   * Ask Wi-Fi to stop batching our packets for the duration of the mirror.
   *
   * A `MulticastLock` only stops the driver *filtering* multicast; it says nothing about when the
   * packets are handed up. In power-save the chip parks multicast at the access point and releases it
   * in a clump after a beacon, and that is precisely what was measured on this rig: a stream that
   * left the Ultimate every 4.00 ms (p99 4.14 ms, no loss, no clumping — sampled on the wire from a
   * host) reached the phone with **119 ms gaps and 29-packet bursts**. No jitter buffer sized for a
   * 4 ms cadence survives that, and the listener hears it as crackling.
   *
   * `WIFI_MODE_FULL_LOW_LATENCY` is the platform's way to say "this is real-time traffic". It only
   * takes effect while the screen is on and the app is in the foreground, which is exactly the window
   * Live View is used in, and it is released the moment the last stream closes so it cannot quietly
   * cost battery afterwards.
   */
  private fun acquireLowLatencyWifi(wifi: WifiManager?) {
    if (wifiLock?.isHeld == true) return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    try {
      wifiLock =
        wifi?.createWifiLock(WifiManager.WIFI_MODE_FULL_LOW_LATENCY, "c64commander-avmirror")?.apply {
          setReferenceCounted(false)
          acquire()
        }
    } catch (error: Exception) {
      Log.w(logTag, "Low-latency Wi-Fi lock unavailable; streams may arrive in bursts", error)
    }
  }

  private fun releaseMulticastLock() {
    try {
      multicastLock?.let { if (it.isHeld) it.release() }
    } catch (error: Exception) {
      Log.d(logTag, "MulticastLock release ignored", error)
    }
    multicastLock = null
    try {
      wifiLock?.let { if (it.isHeld) it.release() }
    } catch (error: Exception) {
      Log.d(logTag, "Wi-Fi lock release ignored", error)
    }
    wifiLock = null
  }

  /** The active site-local IPv4 interface (Wi-Fi), used to join multicast on the right NIC. */
  private fun siteLocalInterface(): NetworkInterface? {
    try {
      for (intf in NetworkInterface.getNetworkInterfaces()) {
        if (!intf.isUp || intf.isLoopback || !intf.supportsMulticast()) continue
        for (addr in intf.inetAddresses) {
          if (!addr.isLoopbackAddress && addr is Inet4Address && addr.isSiteLocalAddress) return intf
        }
      }
    } catch (error: Exception) {
      Log.d(logTag, "multicast interface lookup failed", error)
    }
    return null
  }

  private fun siteLocalIpv4(): String? {
    try {
      for (intf in NetworkInterface.getNetworkInterfaces()) {
        if (!intf.isUp || intf.isLoopback) continue
        for (addr in intf.inetAddresses) {
          if (!addr.isLoopbackAddress && addr is Inet4Address && addr.isSiteLocalAddress) {
            return addr.hostAddress
          }
        }
      }
    } catch (error: Exception) {
      Log.d(logTag, "site-local IPv4 lookup failed", error)
    }
    return null
  }

  /**
   * Android can freeze the WebView before the JS "stop the streams" reaches the device, and the two
   * Wi-Fi locks would then stay held for the whole time the app is away. Public so a test can drive
   * it.
   */
  public override fun handleOnPause() {
    super.handleOnPause()
    releaseMulticastLock()
  }

  /**
   * Required, not an optimisation: a `MulticastLock` released under a live socket makes the driver
   * filter multicast again, so without this the user returns to a bound, running, permanently
   * starved receive loop that reports no error at all.
   */
  public override fun handleOnResume() {
    super.handleOnResume()
    if (sockets.isEmpty()) return
    acquireMulticastLock()
  }

  override fun handleOnDestroy() {
    super.handleOnDestroy()
    sockets.values.forEach {
      try {
        it.close()
      } catch (error: Exception) {
        Log.d(logTag, "socket close on destroy ignored", error)
      }
    }
    sockets.clear()
    synchronized(audioLifecycleLock) {
      audioPipeline?.close()
      audioPipeline = null
    }
    // Paired with the close above, as closeAudioTrack pairs them: focus kept past a destroyed
    // plugin never tells whatever was interrupted that it may resume.
    abandonPlaybackAudioFocus()
    releaseMulticastLock()
    executor.shutdownNow()
  }

  companion object {
    // OS socket receive-buffer request (2 MB) — ~0.8 s of video at the 2.6 MB/s wire rate, ample
    // headroom for a scheduling/GC gap. The kernel may clamp it to net.core.rmem_max.
    private const val RECV_BUFFER_BYTES = 2 * 1024 * 1024

    // C64U PAL audio sample rate (rounded to int for AudioTrack; source of truth: audioStream.ts).
    private const val DEFAULT_AUDIO_SAMPLE_RATE = 47983
    // Used only if the platform will not name its own output rate; 48 kHz is the near-universal
    // Android mixer rate and the one this device reports.
    private const val DEFAULT_OUTPUT_SAMPLE_RATE = 48000
    // Audio wire format: u16 LE seq prefix, then interleaved stereo S16 (4 bytes/frame).
    /** Enough to notice a second (or third) sender without letting a spoofing flood grow the set. */
    private const val MAX_TRACKED_SENDERS = 4

    /** Log the first foreign packet, then one line per this many, so a stuck sender cannot spam. */
    private const val FOREIGN_LOG_EVERY = 5000L

    /** Focus-change names as JS sees them (`StreamUdpAudioFocusEvent.change`). */
    internal const val FOCUS_LOSS = "loss"
    internal const val FOCUS_LOSS_TRANSIENT = "loss-transient"
    internal const val FOCUS_DUCK = "duck"
    internal const val FOCUS_GAIN = "gain"

    private const val AUDIO_SEQ_BYTES = 2
    private const val AUDIO_BYTES_PER_FRAME = 4

    /**
     * How large a gap is still worth filling. Generous on purpose.
     *
     * It was eight packets, on the reasoning that a longer gap is an outage and papering over it
     * would invent audio nobody sent. That was the wrong trade: leaving a gap unfilled does not
     * merely omit it, it pulls everything after it EARLIER, and a probe of fixed-length tones showed
     * exactly that — notes arriving at 78 ms and 132 ms where the C64 held them for 160 ms. Wi-Fi
     * loses multicast in bursts, so gaps of twenty-odd packets are ordinary here. Filling them keeps
     * the timeline honest, and [AudioPipeline.concealLostPackets] fades a long fill towards silence
     * so it cannot turn into a drone.
     */
    private const val MAX_CONCEALED_PACKETS = 50

    // Default native keep-rate: present every assembled frame.
    private const val DEFAULT_KEEP_PERMILLE = 1000

    // VIC wire-format constants (source of truth: src/lib/streams/vicStream.ts + c64stream).
    private const val VIC_HEADER_BYTES = 12
    private const val VIC_FRAME_WIDTH = 384
    private const val VIC_BYTES_PER_LINE = VIC_FRAME_WIDTH / 2 // 192 (4 bits per pixel)
    private const val VIC_PAL_HEIGHT = 272
    private const val VIC_NTSC_HEIGHT = 240
    private const val VIC_BYTES_PER_FRAME = VIC_FRAME_WIDTH * VIC_PAL_HEIGHT / 2 // 52224
    private const val VIC_LINES_PER_PACKET = 4
    private const val VIC_BITS_PER_PIXEL = 4
    private const val LAST_LINE_FLAG = 0x8000
  }
}
