/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.sidaudio

import android.os.Build
import android.util.Base64
import android.util.Log
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject
import uk.gleissner.c64commander.AudioPipeline
import uk.gleissner.c64commander.StreamUdpPlugin
import uk.gleissner.c64commander.sidplayez.SidplayEzNative

/**
 * On-device SID playback, native half: the [LocalAudioFeed] every renderer writes through, the
 * [PcmStore] libSidplayEZ renders into, and the libSidplayEZ renderers themselves.
 *
 * Control travels over ordinary Capacitor calls. PCM rendered in JavaScript (the WASM engines)
 * travels over [SidAudioPort], a binary WebMessage channel, when the WebView supports ArrayBuffer
 * messages, and as base64 through [enqueuePcm] otherwise. The two may be delivered out of order
 * with respect to each other, which is why every segment carries its session's sequence number.
 */
@CapacitorPlugin(name = "SidAudio")
class SidAudioPlugin : Plugin() {
  internal val store = PcmStore()
  private val renderers = ConcurrentHashMap<Int, SidplayEzRenderer>()
  private val nextRendererId = AtomicInteger(1)
  internal lateinit var feed: LocalAudioFeed
  private val port = SidAudioPort(this::onPortSegment)
  @Volatile private var portInstalled = false
  @Volatile private var portError: String? = null

  override fun load() {
    feed = LocalAudioFeed(PipelineHost())
    feed.start()
    installPort()
  }

  override fun handleOnDestroy() {
    renderers.values.forEach { it.dispose() }
    renderers.clear()
    feed.stop()
    store.clear()
  }

  private fun streamUdp(): StreamUdpPlugin =
      bridge.getPlugin("StreamUdp")?.instance as? StreamUdpPlugin
          ?: throw IllegalStateException("The StreamUdp plugin, which owns the audio track, is not registered")

  private class PipelineOutput(val pipeline: AudioPipeline) : FeedOutput {
    override fun offer(data: ByteArray, offset: Int, length: Int) = pipeline.offer(data, offset, length)

    override fun flush() = pipeline.flush()

    override fun flushRing(rate: Int): Long = pipeline.flushRing()

    override fun pause() = pipeline.pause()

    override fun resume() = pipeline.resume()

    override fun setGain(gain: Double) = pipeline.setGain(gain)

    override fun bufferedMs(): Double = pipeline.stats().bufferedMs

    override fun ringMs(): Double = pipeline.stats().jitterBufferMs

    override fun underruns(): Int = pipeline.stats().underruns
  }

  private inner class PipelineHost : FeedOutputHost {
    override fun open(settings: FeedTrackSettings): FeedOutput =
        PipelineOutput(
            streamUdp().openPipeline(
                settings.sampleRate,
                settings.bufferMs,
                settings.maxRingMs,
                settings.trackBursts,
                settings.primeMs,
                // The feed paces itself against the ring, on this device's clock: nothing to correct.
                correctDrift = false,
            ),
        )

    override fun isCurrent(output: FeedOutput): Boolean =
        streamUdp().isCurrentPipeline((output as PipelineOutput).pipeline)

    override fun close(output: FeedOutput) = streamUdp().closePipelineIfCurrent((output as PipelineOutput).pipeline)
  }

  // ── the binary port ──────────────────────────────────────────────────────────────────────────

  private fun installPort() {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
        !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)) {
      portError = "This WebView cannot deliver ArrayBuffer messages"
      return
    }
    // Registered here, synchronously, as Capacitor registers its own bridge listener: plugins load on
    // the main thread before the page is requested, so the object exists in the first document.
    try {
      WebViewCompat.addWebMessageListener(bridge.webView, SidAudioPort.JS_OBJECT_NAME, bridge.allowedOriginRules, port)
      portInstalled = true
    } catch (error: Exception) {
      portError = error.message ?: error.javaClass.simpleName
      Log.w(TAG, "The binary PCM port could not be installed; PCM falls back to the Capacitor bridge", error)
    }
  }

  private fun onPortSegment(serial: Int, seq: Long, bytes: ByteArray, offset: Int, frames: Int) {
    if (frames <= 0) {
      feed.enqueue(serial, seq, null)
      return
    }
    feed.enqueue(serial, seq, Segment(LocalAudioFeed.bytesSource(bytes, offset), 0, frames.toLong()))
  }

  // ── lifecycle and capability ─────────────────────────────────────────────────────────────────

  /** What this device can do: whether libSidplayEZ runs here, and which PCM transport is usable. */
  @PluginMethod
  fun describe(call: PluginCall) {
    val result = JSObject()
    val reason = SidplayEzNative.unavailableReason
    result.put("sidplayezAvailable", reason == null)
    result.put("sidplayezUnavailableReason", reason)
    result.put("sidplayezRevision", if (reason == null) SidplayEzNative.nativeRevision() else null)
    result.put("abi", if (reason == null) SidplayEzNative.nativeAbi() else Build.SUPPORTED_ABIS.firstOrNull())
    result.put("binaryPortInstalled", portInstalled)
    result.put("binaryPortError", portError)
    result.put("binaryPortProbes", port.probesReceived)
    result.put("binaryPortRejected", port.rejectedMessages)
    call.resolve(result)
  }

  /**
   * Drop everything a previous page lifetime left behind: its sessions, its PCM and its renderers.
   *
   * The web layer calls this once when its playback engine is built, so a WebView reload cannot
   * leave native buffers and threads that no JavaScript holds an id for any more.
   */
  @PluginMethod
  fun attach(call: PluginCall) {
    renderers.values.forEach { it.dispose() }
    renderers.clear()
    store.clear()
    feed.reset()
    call.resolve(JSObject())
  }

  // ── feed ─────────────────────────────────────────────────────────────────────────────────────

  private fun PluginCall.serial(): Int? = getInt("serial").also { if (it == null) reject("serial is required") }

  /**
   * A whole number from the call, whatever width JSON parsing gave it. `PluginCall.getLong` answers
   * only for values parsed as `Long`, and a number JavaScript sends that fits in 32 bits is parsed
   * as an `Integer` — so sequence numbers and buffer ids read as missing.
   */
  private fun PluginCall.wholeNumber(name: String): Long? = (data.opt(name) as? Number)?.toLong()

  /** The command's place in its session's stream; see [LocalAudioFeed]. */
  private fun PluginCall.seq(): Long? = wholeNumber("seq").also { if (it == null) reject("seq is required") }

  @PluginMethod
  fun openSession(call: PluginCall) {
    val serial = call.serial() ?: return
    val sampleRate = call.getInt("sampleRate") ?: return call.reject("sampleRate is required")
    feed.openSession(
        serial,
        FeedTrackSettings(
            sampleRate = sampleRate,
            bufferMs = call.getInt("bufferMs") ?: 0,
            maxRingMs = call.getInt("maxRingMs") ?: 0,
            trackBursts = call.getInt("trackBursts") ?: 0,
            primeMs = call.getInt("primeMs") ?: 0,
        ),
    )
    call.resolve(JSObject())
  }

  /** Enqueue a range of a native buffer — a libSidplayEZ chunk, or a slice of a pre-rendered tune. */
  @PluginMethod
  fun enqueueBuffer(call: PluginCall) {
    val serial = call.serial() ?: return
    val seq = call.wholeNumber("seq") ?: return call.reject("seq is required")
    val bufferId = call.wholeNumber("bufferId") ?: return call.reject("bufferId is required")
    val buffer = store.take(bufferId)
    if (buffer == null) {
      Log.w(TAG, "Enqueued PCM buffer $bufferId no longer exists; the segment is skipped")
      feed.enqueue(serial, seq, null)
      call.resolve(JSObject().put("missing", true))
      return
    }
    val start = (call.wholeNumber("startFrame") ?: 0L).coerceAtLeast(0)
    val frames = (call.wholeNumber("frames") ?: (buffer.frames - start)).coerceIn(0, (buffer.frames - start).coerceAtLeast(0))
    feed.enqueue(serial, seq, Segment(LocalAudioFeed.bufferSource(buffer), start, frames))
    call.resolve(JSObject())
  }

  /** The fallback PCM path, for a WebView that cannot send ArrayBuffer messages. */
  @PluginMethod
  fun enqueuePcm(call: PluginCall) {
    val serial = call.serial() ?: return
    val seq = call.wholeNumber("seq") ?: return call.reject("seq is required")
    val data = call.getString("data") ?: return call.reject("data is required")
    val bytes = Base64.decode(data, Base64.NO_WRAP)
    val frames = bytes.size / LocalAudioFeed.BYTES_PER_FRAME
    feed.enqueue(serial, seq, if (frames > 0) Segment(LocalAudioFeed.bytesSource(bytes), 0, frames.toLong()) else null)
    call.resolve(JSObject())
  }

  @PluginMethod
  fun flush(call: PluginCall) {
    val serial = call.serial() ?: return
    feed.flush(serial, call.seq() ?: return)
    call.resolve(JSObject())
  }

  @PluginMethod
  fun pause(call: PluginCall) {
    feed.pause(call.serial() ?: return)
    call.resolve(JSObject())
  }

  @PluginMethod
  fun resume(call: PluginCall) {
    feed.resume(call.serial() ?: return)
    call.resolve(JSObject())
  }

  @PluginMethod
  fun setGain(call: PluginCall) {
    feed.setGain(call.getDouble("gain") ?: 1.0)
    call.resolve(JSObject())
  }

  @PluginMethod
  fun fade(call: PluginCall) {
    val serial = call.serial() ?: return
    feed.fade(serial, call.seq() ?: return, call.getDouble("target") ?: 1.0, call.getInt("ms") ?: 0)
    call.resolve(JSObject())
  }

  @PluginMethod
  fun fadeIn(call: PluginCall) {
    val serial = call.serial() ?: return
    feed.fadeIn(serial, call.seq() ?: return, call.getInt("ms") ?: 0)
    call.resolve(JSObject())
  }

  @PluginMethod
  fun resetSilence(call: PluginCall) {
    feed.resetSilence(call.serial() ?: return)
    call.resolve(JSObject())
  }

  @PluginMethod
  fun beginTransition(call: PluginCall) {
    val serial = call.serial() ?: return
    feed.beginTransition(serial, call.seq() ?: return, call.getDouble("seconds") ?: 0.0, call.getBoolean("rampOut") ?: false)
    call.resolve(JSObject())
  }

  @PluginMethod
  fun takeTail(call: PluginCall) {
    val serial = call.serial() ?: return
    val seq = call.seq() ?: return
    val tailId = call.getInt("tailId") ?: return call.reject("tailId is required")
    feed.takeTail(serial, seq, tailId, call.getDouble("maxSeconds") ?: 0.0)
    call.resolve(JSObject())
  }

  @PluginMethod
  fun adoptTail(call: PluginCall) {
    val serial = call.serial() ?: return
    val seq = call.seq() ?: return
    val tailId = call.getInt("tailId") ?: return call.reject("tailId is required")
    feed.adoptTail(serial, seq, tailId, call.getDouble("seconds") ?: 0.0)
    call.resolve(JSObject())
  }

  @PluginMethod
  fun release(call: PluginCall) {
    val serial = call.serial() ?: return
    feed.release(serial, call.seq() ?: return)
    call.resolve(JSObject())
  }

  @PluginMethod
  fun close(call: PluginCall) {
    feed.close(call.serial() ?: return)
    call.resolve(JSObject())
  }

  @PluginMethod
  fun stats(call: PluginCall) {
    val serial = call.serial() ?: return
    val stats = feed.stats(serial) ?: return call.resolve(JSObject().put("known", false))
    call.resolve(
        JSObject()
            .put("known", true)
            .put("writtenFrames", stats.writtenFrames)
            .put("playedFrames", stats.playedFrames)
            .put("bufferedMs", stats.bufferedMs)
            .put("queuedFrames", stats.queuedFrames)
            .put("underruns", stats.underruns)
            .put("silentSeconds", stats.silentSeconds)
            .put("silentFault", stats.silentFault)
            .put("reopens", stats.reopens)
            .put("active", stats.active)
            .put("superseded", stats.superseded)
            .put("missingSegments", stats.missingSegments)
            .put("outputOpen", stats.outputOpen)
            .put("openFailures", stats.openFailures),
    )
  }

  @PluginMethod
  fun releaseBuffers(call: PluginCall) {
    val ids = call.getArray("bufferIds")
    if (ids != null) for (i in 0 until ids.length()) store.release(ids.getLong(i))
    call.resolve(JSObject().put("held", store.size))
  }

  // ── libSidplayEZ renderers ───────────────────────────────────────────────────────────────────

  private fun PluginCall.renderer(): SidplayEzRenderer? {
    val id = getInt("renderer")
    val renderer = id?.let { renderers[it] }
    if (renderer == null) reject("Unknown libSidplayEZ renderer $id")
    return renderer
  }

  private fun <T> PluginCall.callbacks(resolve: (T) -> JSObject): EzCallbacks<T> =
      object : EzCallbacks<T> {
        override fun success(value: T) = this@callbacks.resolve(resolve(value))

        override fun failure(error: Exception) {
          Log.w(TAG, "libSidplayEZ ${this@callbacks.methodName} failed", error)
          this@callbacks.reject(error.message ?: error.javaClass.simpleName, error)
        }
      }

  private fun PluginCall.tuneRequest(): EzTuneRequest? {
    val sid = getString("sid")?.let { Base64.decode(it, Base64.NO_WRAP) } ?: return null.also { reject("sid is required") }
    return EzTuneRequest(
        sid = sid,
        songIndex = getInt("songIndex") ?: 0,
        sampleRate = getInt("sampleRate") ?: 48000,
        kernal = getString("kernal")?.let { Base64.decode(it, Base64.NO_WRAP) },
        basic = getString("basic")?.let { Base64.decode(it, Base64.NO_WRAP) },
        fallbackModel = if (getString("sidModel") == "MOS6581") SidplayEzNative.MODEL_6581 else SidplayEzNative.MODEL_8580,
    )
  }

  @PluginMethod
  fun createRenderer(call: PluginCall) {
    SidplayEzNative.unavailableReason?.let { return call.reject("libSidplayEZ is not available here: $it") }
    val id = nextRendererId.getAndIncrement()
    renderers[id] = SidplayEzRenderer(id, store, background = call.getBoolean("background", false) == true)
    call.resolve(JSObject().put("renderer", id))
  }

  @PluginMethod
  fun openTune(call: PluginCall) {
    val renderer = call.renderer() ?: return
    val request = call.tuneRequest() ?: return
    renderer.open(
        request,
        call.callbacks { opened ->
          JSObject()
              .put("sampleRate", opened.sampleRate)
              .put("channels", opened.channels)
              .put("tuneInfo", opened.tuneInfoJson?.takeIf { it != "null" }?.let { JSONObject(it) })
              .put("constructMs", opened.constructMs)
              .put("loadMs", opened.loadMs)
        },
    )
  }

  @PluginMethod
  fun render(call: PluginCall) {
    val renderer = call.renderer() ?: return
    renderer.render(
        call.getDouble("seconds") ?: 0.5,
        call.callbacks { rendered ->
          JSObject().put("bufferId", rendered.bufferId).put("frames", rendered.frames).put("renderMs", rendered.renderMs)
        },
    )
  }

  @PluginMethod
  fun seek(call: PluginCall) {
    val renderer = call.renderer() ?: return
    renderer.seek(call.getDouble("seconds") ?: 0.0, call.callbacks { landed -> JSObject().put("positionSeconds", landed) })
  }

  /** Starts a pre-render and resolves at once; progress arrives as `prerender` events. */
  @PluginMethod
  fun prerender(call: PluginCall) {
    val renderer = call.renderer() ?: return
    val request = call.tuneRequest() ?: return
    val requestId = call.getInt("id") ?: return call.reject("id is required")
    val seconds = call.getDouble("seconds") ?: 0.0
    val rendererId = renderer.id
    renderer.prerender(
        request,
        seconds,
        object : SidplayEzRenderer.PrerenderListener {
          override fun chunk(bufferId: Long, frames: Long, seconds: Double) = emitPrerender(rendererId, requestId, "chunk", bufferId, frames, seconds, null)

          override fun done(bufferId: Long, frames: Long, seconds: Double) = emitPrerender(rendererId, requestId, "done", bufferId, frames, seconds, null)

          override fun cancelled(bufferId: Long, frames: Long, seconds: Double) =
              emitPrerender(rendererId, requestId, "cancelled", bufferId, frames, seconds, null)

          override fun failed(error: Exception) {
            Log.w(TAG, "libSidplayEZ pre-render $requestId failed", error)
            emitPrerender(rendererId, requestId, "error", 0, 0, 0.0, error.message ?: error.javaClass.simpleName)
          }
        },
    )
    call.resolve(JSObject())
  }

  private fun emitPrerender(renderer: Int, id: Int, kind: String, bufferId: Long, frames: Long, seconds: Double, error: String?) {
    notifyListeners(
        "prerender",
        JSObject()
            .put("renderer", renderer)
            .put("id", id)
            .put("kind", kind)
            .put("bufferId", bufferId)
            .put("frames", frames)
            .put("seconds", seconds)
            .put("error", error),
    )
  }

  @PluginMethod
  fun cancelPrerender(call: PluginCall) {
    val renderer = call.renderer() ?: return
    renderer.cancelPrerender()
    call.resolve(JSObject())
  }

  @PluginMethod
  fun closeTune(call: PluginCall) {
    val renderer = call.renderer() ?: return
    renderer.close(call.callbacks { JSObject() })
  }

  @PluginMethod
  fun disposeRenderer(call: PluginCall) {
    val id = call.getInt("renderer") ?: return call.reject("renderer is required")
    renderers.remove(id)?.dispose()
    call.resolve(JSObject())
  }

  companion object {
    private const val TAG = "SidAudioPlugin"
  }
}

/**
 * Receives PCM from JavaScript as ArrayBuffers through `window.c64SidAudioPort.postMessage`.
 *
 * The payload is a 24-byte little-endian header — magic, kind, session serial, sequence number,
 * frame count, reserved — followed by interleaved stereo S16LE. One copy happens on the way in
 * (WebView hands over a fresh `ByteArray`); the feed reads straight out of that array.
 */
internal class SidAudioPort(private val sink: (serial: Int, seq: Long, bytes: ByteArray, offset: Int, frames: Int) -> Unit) :
    WebViewCompat.WebMessageListener {
  @Volatile var probesReceived = 0
  @Volatile var rejectedMessages = 0

  override fun onPostMessage(
      view: android.webkit.WebView,
      message: WebMessageCompat,
      sourceOrigin: android.net.Uri,
      isMainFrame: Boolean,
      replyProxy: androidx.webkit.JavaScriptReplyProxy,
  ) {
    if (message.type != WebMessageCompat.TYPE_ARRAY_BUFFER) {
      rejectedMessages += 1
      return
    }
    handle(message.arrayBuffer)
  }

  internal fun handle(bytes: ByteArray) {
    val header = parseHeader(bytes)
    if (header == null) {
      rejectedMessages += 1
      return
    }
    when (header.kind) {
      KIND_PROBE -> probesReceived += 1
      KIND_PCM -> sink(header.serial, header.seq, bytes, HEADER_BYTES, header.frames)
      else -> rejectedMessages += 1
    }
  }

  internal data class Header(val kind: Int, val serial: Int, val seq: Long, val frames: Int)

  companion object {
    const val JS_OBJECT_NAME = "c64SidAudioPort"
    const val HEADER_BYTES = 24
    const val MAGIC = 0x50343643 // "C64P", little-endian
    const val KIND_PROBE = 0
    const val KIND_PCM = 1

    private fun u32(bytes: ByteArray, at: Int): Long =
        (bytes[at].toLong() and 0xFF) or
            ((bytes[at + 1].toLong() and 0xFF) shl 8) or
            ((bytes[at + 2].toLong() and 0xFF) shl 16) or
            ((bytes[at + 3].toLong() and 0xFF) shl 24)

    internal fun parseHeader(bytes: ByteArray): Header? {
      if (bytes.size < HEADER_BYTES || u32(bytes, 0) != MAGIC.toLong()) return null
      val frames = u32(bytes, 16)
      val payloadFrames = (bytes.size - HEADER_BYTES) / LocalAudioFeed.BYTES_PER_FRAME
      if (frames > payloadFrames) return null
      return Header(u32(bytes, 4).toInt(), u32(bytes, 8).toInt(), u32(bytes, 12), frames.toInt())
    }
  }
}
