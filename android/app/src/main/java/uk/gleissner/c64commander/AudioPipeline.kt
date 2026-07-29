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
import android.os.Process
import android.util.Log
import java.util.concurrent.locks.LockSupport

/**
 * The audio path from a PCM producer to the speaker, entirely in Kotlin.
 *
 * ## What was wrong
 *
 * The previous sink wrote each arriving datagram straight into an `AudioTrack` with
 * `WRITE_NON_BLOCKING`, from the thread that had just read it off the socket. Three separate faults
 * fell out of that, and all three are audible as crackling.
 *
 * **1. The AudioTrack's buffer was the only buffer.** A non-blocking writer drives it to one extreme
 * and holds it there: full, so every clump of packets is partly refused, or dry, so the mixer pulls
 * silence. Measured on a Pixel 4 against a c64u: with Live View video running the buffer hit 0 ms
 * repeatedly and the track underran 1.7×/s; with video off it pinned at its 60 ms capacity and
 * discarded 7.4 ms of audio per second.
 *
 * **2. The stream does not arrive evenly, and nothing absorbed that.** Sampled on the wire from a
 * wired host the mirror's audio arrives every 4.00 ms (p99 4.14 ms, zero loss, no clumping). Measured
 * at the phone's own socket it arrives with a mean of 4.05 ms but a **maximum gap of 118.7 ms**, in
 * clumps of up to **29 packets** — Wi-Fi power-save parking multicast at the access point and
 * releasing it in bursts. A cushion of tens of milliseconds cannot survive that.
 *
 * **3. The track ran at the source rate, off the fast path.** 47983 Hz is not any Android device's
 * native output rate, so AudioFlinger inserted its own resampler, which disqualifies the track from
 * the fast mixer — `PERFORMANCE_MODE_LOW_LATENCY` is silently ignored, `getMinBufferSize` jumps (60 ms
 * on this device), and every frame costs a conversion in the audio server. The floor on latency and
 * the CPU cost were both consequences of asking for a rate the hardware does not have.
 *
 * ## The shape
 *
 * Producer → ring buffer → player thread → resampler → `AudioTrack` at the device's native rate.
 *
 *  - **The producer never touches the AudioTrack.** [offer] copies into a ring and returns. It is
 *    safe on the UDP receive thread (the A/V mirror) and on the Capacitor bridge (the on-device SID
 *    engine); one pipeline serves both, so both get identical pacing.
 *  - **The track runs at the device's native rate with a burst-aligned buffer**, which is what puts
 *    it on the fast mixer: no resampling in the audio server, a much smaller minimum buffer, and less
 *    CPU per frame.
 *  - **The player writes with `WRITE_BLOCKING`**, so it is paced by the DAC rather than by packet
 *    arrivals. That is what keeps the track buffer at a stable depth instead of at an extreme.
 *  - **An asynchronous sample-rate converter closes the loop.** It converts the source rate to the
 *    output rate, and it trims that ratio by a fraction of a percent to hold the ring at its target
 *    depth. This is what removes the *steady-state* fault: a stream that runs marginally fast or slow
 *    against the DAC no longer drifts into an overflow or a dry buffer, so nothing has to be
 *    discarded or concealed to correct it.
 *  - **The cushion adapts to the link.** Concealment means the ring was not deep enough for the
 *    bursts this network actually delivers, so the target grows; a long clean spell lets it decay
 *    back, because latency that is not buying anything is just latency.
 */
internal class AudioPipeline(
    private val sourceRate: Int,
    targetLatencyMs: Int,
    /** The device's native output rate. Matching it is what keeps the track on the fast mixer. */
    private val outputRate: Int = sourceRate,
    /** The HAL's burst size in frames; the track buffer is a whole number of these. */
    framesPerBurst: Int = 0,
    /** Test seam: builds the real `AudioTrack` (mocked in unit tests). */
    trackFactory: (Int, Int) -> AudioTrack = ::buildAudioTrack,
) {
  data class Stats(
      /** PCM queued ahead of the speaker (ring + track), i.e. the current output latency. */
      val bufferedMs: Double,
      /** Times the `AudioTrack` itself ran dry — the mixer pulled silence. */
      val underruns: Int,
      /** PCM the pipeline could not play: refused by a full ring, or trimmed to hold latency down. */
      val droppedBytes: Long,
      /** Silence written because the ring was empty when the speaker needed audio. */
      val concealedMs: Double,
      val trackSampleRate: Int,
      val trackChannels: Int,
      val trackBufferFrames: Int,
      /** Ring depth alone (ms) — the jitter cushion, separately from the track's own buffer. */
      val jitterBufferMs: Double,
      /** The cushion the pipeline is currently aiming to hold (ms); grows to fit a bursty link. */
      val targetJitterMs: Double,
      /** Current resampling ratio as a fraction of nominal — the drift correction being applied. */
      val driftCorrection: Double,
  ) {
    companion object {
      val ZERO = Stats(0.0, 0, 0L, 0.0, 0, 0, 0, 0.0, 0.0, 1.0)
    }
  }

  private val track: AudioTrack
  private val trackBufferFrames: Int

  /** What `setBufferSizeInBytes` asked for; only a fallback if the framework will not say. */
  private val requestedBufferFrames: Int

  /** How much is handed to the track per write — one HAL burst, so the writer tracks the drain. */
  private val writeFramesPerChunk: Int

  /** Steady-state ring depth, in SOURCE frames. Adapts to how bursty this link turns out to be. */
  @Volatile private var targetFrames: Int
  private val minTargetFrames: Int
  private val maxTargetFrames: Int

  /** Safety net only: with the converter holding the cushion, this should never fire. */
  private val hardMaxFrames: Int

  private val ring: ByteArray
  private val ringFrames: Int

  /**
   * Held only for the ring memcpy. The mirror feeds from the receive thread and the on-device engine
   * from the bridge, and a device switch can briefly overlap them; a few hundred nanoseconds of
   * mutual exclusion is the cheap way to keep the ring sound. Nothing slow is ever done under it —
   * that was the old design's mistake.
   */
  private val producerLock = Any()

  // Monotonic frame counts, not indices: the difference is the depth, and neither can be misread as
  // the other when they wrap around the array.
  @Volatile private var writeFrames: Long = 0
  @Volatile private var readFrames: Long = 0

  @Volatile private var refusedBytes: Long = 0
  @Volatile private var discardedBytes: Long = 0
  @Volatile private var concealedFrames: Long = 0
  @Volatile private var trackUnderruns: Int = 0
  @Volatile private var trackQueuedFrames: Long = 0
  @Volatile private var appliedRatio: Double = 1.0
  @Volatile private var running = true
  @Volatile private var started = false

  private var totalFramesWritten: Long = 0
  private var player: Thread? = null

  init {
    val burst = if (framesPerBurst > 0) framesPerBurst else defaultBurstFrames(outputRate)
    val minBytes = AudioTrack.getMinBufferSize(outputRate, CHANNEL_CONFIG, ENCODING)
    val minBufferBytes = if (minBytes > 0) minBytes else FALLBACK_BUFFER_BYTES
    // A whole number of HAL bursts, at or above the platform minimum. Both conditions matter: the
    // fast mixer wants burst alignment, and a buffer under the minimum is refused outright.
    val burstBytes = burst * BYTES_PER_FRAME
    val wantBytes = maxOf(minBufferBytes, burstBytes * TRACK_BURSTS)
    val trackBytes = ((wantBytes + burstBytes - 1) / burstBytes) * burstBytes
    requestedBufferFrames = trackBytes / BYTES_PER_FRAME
    track = trackFactory(outputRate, trackBytes)
    // The buffer the framework ACTUALLY gave us, which is not always the one asked for: a track that
    // wins the fast path can come back far smaller than `setBufferSizeInBytes` requested. Believing
    // the request instead of the answer is how a 62 ms plan turns into a track that dries out several
    // times a second — both the write cadence and the latency budget below are derived from this
    // number, so it has to be the real one.
    trackBufferFrames =
        try {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            track.bufferSizeInFrames.takeIf { it > 0 } ?: requestedBufferFrames
          } else {
            requestedBufferFrames
          }
        } catch (error: Exception) {
          Log.d(TAG, "bufferSizeInFrames unavailable", error)
          requestedBufferFrames
        }
    // Top up in HAL bursts rather than on a wall-clock interval. The track drains a burst at a time,
    // so writing a burst at a time is what keeps the player thread in step with it; a fixed 10 ms
    // chunk is either wastefully coarse or, against a small fast-path buffer, too late every time.
    writeFramesPerChunk = burst.coerceAtMost(maxOf(1, trackBufferFrames / 2))

    // The caller's budget is total output latency; the track's own buffer is already spending part of
    // it, so the ring targets the remainder. The ring is what has to survive a stalled producer,
    // which is the failure actually measured, so it is never left trivially shallow.
    val trackMs = trackBufferFrames * 1000 / outputRate
    minTargetFrames =
        msToFrames(sourceRate, (targetLatencyMs - trackMs).coerceAtLeast(MIN_RING_MS))
    maxTargetFrames = msToFrames(sourceRate, MAX_RING_MS)
    targetFrames = minTargetFrames
    hardMaxFrames = maxTargetFrames * 2
    ringFrames = hardMaxFrames * 2
    ring = ByteArray(ringFrames * BYTES_PER_FRAME)
  }

  /** Output latency this pipeline targets once primed (ms) — ring target plus the track's buffer. */
  val bufferCapacityMs: Double
    get() = targetFrames * 1000.0 / sourceRate + trackBufferFrames * 1000.0 / outputRate

  fun start() {
    if (player != null) return
    player =
        Thread({ playLoop() }, "c64u-audio-player").apply {
          isDaemon = true
          start()
        }
  }

  /**
   * Hand PCM to the pipeline: interleaved stereo S16LE, whole frames, at the source rate.
   *
   * Allocation-free and safe on the UDP receive thread. A full ring means the player is not draining
   * (a long stall, or no speaker at all), so the audio is counted and discarded rather than blocking
   * the producer: for a live stream, being late is worse than being short.
   */
  fun offer(data: ByteArray, offset: Int, length: Int) {
    if (length <= 0 || !running) return
    val frames = length / BYTES_PER_FRAME
    if (frames <= 0) return
    synchronized(producerLock) {
      val free = ringFrames - (writeFrames - readFrames).toInt()
      if (frames > free) {
        refusedBytes += length.toLong()
        return
      }
      val start = (writeFrames % ringFrames).toInt() * BYTES_PER_FRAME
      val bytes = frames * BYTES_PER_FRAME
      val tail = ring.size - start
      if (bytes <= tail) {
        System.arraycopy(data, offset, ring, start, bytes)
      } else {
        System.arraycopy(data, offset, ring, start, tail)
        System.arraycopy(data, offset + tail, ring, 0, bytes - tail)
      }
      writeFrames += frames.toLong()
      blendIntoConcealment(frames)
    }
  }

  /**
   * Cross-fade the first real audio after a concealment into the invented audio it replaces.
   *
   * The hole itself is filled with a repeat, but the moment the stream comes back is a second seam,
   * and a hard splice there is exactly the short tick a listener reports as "occasional very brief
   * disruptions". Rewinding a couple of milliseconds and mixing the two together across that overlap
   * removes the edge; the cost is a few milliseconds where the repeat and the real audio are both
   * present at partial gain, which is inaudible.
   */
  private fun blendIntoConcealment(frames: Int) {
    val blend = minOf(blendFrames, frames)
    blendFrames = 0
    if (blend <= 0) return
    val realStart = writeFrames - frames
    for (i in 0 until blend) {
      // Equal-power rather than linear: two signals at different phases partially cancel through a
      // linear fade, which is heard as a dip right where the audio comes back.
      val t = (i + 1).toDouble() / (blend + 1)
      val gainFresh = Math.sin(t * Math.PI / 2)
      val gainTail = Math.cos(t * Math.PI / 2)
      val idx = ((realStart + i) % ringFrames).toInt() * BYTES_PER_FRAME
      val tail = i * BYTES_PER_FRAME
      for (c in 0 until CHANNELS) {
        val o = c * 2
        val fresh = ((ring[idx + o].toInt() and 0xFF) or (ring[idx + o + 1].toInt() shl 8)).toShort()
        val prior = ((blendTail[tail + o].toInt() and 0xFF) or (blendTail[tail + o + 1].toInt() shl 8)).toShort()
        val mixed = (fresh * gainFresh + prior * gainTail).toInt().coerceIn(-32768, 32767)
        ring[idx + o] = (mixed and 0xFF).toByte()
        ring[idx + o + 1] = ((mixed shr 8) and 0xFF).toByte()
      }
    }
  }

  /** The concealment's continuation past the hole, held for the cross-fade back into real audio. */
  private val blendTail = ByteArray(msToFrames(sourceRate, CONCEAL_BLEND_MS) * BYTES_PER_FRAME)

  /** Frames of the next real packet still owed a cross-fade against the concealment before it. */
  private var blendFrames = 0

  /**
   * The length of one repetition of the audio just before a hole, in frames.
   *
   * Found by autocorrelation over the recent past: the lag at which the signal most resembles itself
   * is its pitch period, and repeating exactly that keeps the waveform continuous across the join.
   * The search runs on a decimated, mono-summed copy so it costs tens of microseconds rather than
   * milliseconds — it happens on the receive thread, and nothing there may be slow.
   */
  private fun estimatePeriod(available: Int): Int {
    val minLag = msToFrames(sourceRate, 1)
    val maxLag = minOf(msToFrames(sourceRate, 12), available / 2)
    if (maxLag <= minLag) return maxOf(1, minOf(available, msToFrames(sourceRate, 4)))
    val window = minOf(available, maxLag * 2)
    val stride = 4
    val n = window / stride
    if (n < 8) return maxOf(1, minOf(available, msToFrames(sourceRate, 4)))
    val base = writeFrames - window
    val history = DoubleArray(n)
    for (i in 0 until n) {
      val idx = ((base + i.toLong() * stride) % ringFrames).toInt() * BYTES_PER_FRAME
      val l = ((ring[idx].toInt() and 0xFF) or (ring[idx + 1].toInt() shl 8)).toShort().toInt()
      val r = ((ring[idx + 2].toInt() and 0xFF) or (ring[idx + 3].toInt() shl 8)).toShort().toInt()
      history[i] = (l + r).toDouble()
    }
    var bestLag = msToFrames(sourceRate, 4)
    var bestScore = -1.0
    var lag = minLag / stride
    val maxLagDecimated = maxLag / stride
    while (lag <= maxLagDecimated) {
      var num = 0.0
      var energy = 0.0
      var i = lag
      while (i < n) {
        num += history[i] * history[i - lag]
        energy += history[i - lag] * history[i - lag]
        i++
      }
      var current = 0.0
      var j = lag
      while (j < n) {
        current += history[j] * history[j]
        j++
      }
      // Normalise by BOTH windows. Dividing by the lagged window alone makes the score shrink as the
      // lag grows and the overlap shortens, which quietly biases every estimate towards short lags.
      val denom = Math.sqrt(energy * current)
      val score = if (denom > 0) num / denom else 0.0
      if (score > bestScore) {
        bestScore = score
        bestLag = lag * stride
      }
      lag++
    }
    return bestLag.coerceIn(1, available)
  }

  /**
   * Fill the hole a lost packet left, using what came just before it.
   *
   * Wi-Fi multicast has no retransmission, so a dropped packet is gone; the only question is what the
   * listener hears in its place. Splicing the next packet straight on shifts the waveform abruptly,
   * which is a click. Repeating the preceding audio at falling gain keeps the timeline correct — so
   * the tune neither speeds up nor drifts against the picture — and turns a click into a brief
   * smudge. Deliberately naive: for the 4 ms a single packet carries, a fading repeat is
   * indistinguishable from proper interpolation and costs a memcpy.
   */
  fun concealLostPackets(frames: Int) {
    if (frames <= 0 || !running) return
    synchronized(producerLock) {
      val available = (writeFrames - readFrames).toInt()
      val source = minOf(frames, available)
      if (source <= 0) return
      val free = ringFrames - available
      val fill = minOf(frames, free)
      if (fill <= 0) {
        refusedBytes += frames.toLong() * BYTES_PER_FRAME
        return
      }
      // Repeat a whole number of PITCH PERIODS, not an arbitrary slice. Repeating the last 4 ms of a
      // 440 Hz tone restarts it 1.76 periods back, so the waveform steps at the join — measured at 24x
      // the signal's own steepest slope, which is precisely the short tick left after the gap itself
      // was filled. Repeating one period lands the waveform exactly where it left off.
      // Search over everything the ring still holds, not just the size of the hole. Passing the hole
      // size capped the search at 96 frames, and a 440 Hz tone repeats every 109 — so the true period
      // was outside the range the estimator could ever return, and it settled on a fraction of it.
      val period = estimatePeriod(available)
      val from = writeFrames - period
      for (i in 0 until fill) {
        val src = ((from + (i % period)) % ringFrames).toInt() * BYTES_PER_FRAME
        val dst = ((writeFrames + i) % ringFrames).toInt() * BYTES_PER_FRAME
        // Held at full level, deliberately. Fading the repeat out and then splicing the next real
        // packet in at full level trades one discontinuity for two, and the second one — arriving
        // exactly when the audio comes back — is the more audible of the pair. The seam at the far
        // end is handled properly by [blendInto], as a cross-fade.
        for (c in 0 until CHANNELS) {
          val o = c * 2
          ring[dst + o] = ring[src + o]
          ring[dst + o + 1] = ring[src + o + 1]
        }
      }
      writeFrames += fill.toLong()
      concealedFrames += fill.toLong()

      // Carry the repeat on a little PAST the hole, into a scratch buffer. The cross-fade that
      // rejoins the real stream has to mix it against what the concealment WOULD have played next,
      // and that continuation does not exist in the ring — the real audio occupies those frames. An
      // earlier attempt faded against the ring itself and so mixed in concealment from a hundred
      // frames back, which put a step in the middle of the very fade meant to remove one.
      blendFrames = minOf(msToFrames(sourceRate, CONCEAL_BLEND_MS), blendTail.size / BYTES_PER_FRAME)
      for (i in 0 until blendFrames) {
        val src = ((from + ((fill + i) % period)) % ringFrames).toInt() * BYTES_PER_FRAME
        val dst = i * BYTES_PER_FRAME
        for (c in 0 until CHANNELS) {
          blendTail[dst + c * 2] = ring[src + c * 2]
          blendTail[dst + c * 2 + 1] = ring[src + c * 2 + 1]
        }
      }
    }
  }

  fun stats(): Stats {
    val ringDepth = (writeFrames - readFrames).coerceAtLeast(0)
    val jitterMs = ringDepth * 1000.0 / sourceRate
    val trackMs = trackQueuedFrames.coerceAtLeast(0) * 1000.0 / outputRate
    return Stats(
        bufferedMs = jitterMs + trackMs,
        underruns = trackUnderruns,
        droppedBytes = refusedBytes + discardedBytes,
        concealedMs = concealedFrames * 1000.0 / outputRate,
        trackSampleRate = track.sampleRate,
        trackChannels = track.channelCount,
        trackBufferFrames = trackBufferFrames,
        jitterBufferMs = jitterMs,
        targetJitterMs = targetFrames * 1000.0 / sourceRate,
        driftCorrection = appliedRatio,
    )
  }

  fun close() {
    running = false
    player?.interrupt()
    player = null
    try {
      if (started) track.pause()
      track.flush()
      track.release()
    } catch (error: Exception) {
      Log.d(TAG, "AudioPipeline close ignored", error)
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Player thread
  // ---------------------------------------------------------------------------------------------

  /** Ring depth to reach before playback starts: the cushion plus what the speaker's buffer will take. */
  private val primeFrames: Int
    get() = targetFrames + (trackBufferFrames.toLong() * sourceRate / outputRate).toInt()

  /** Fractional read position within the ring, in source frames past [readFrames]. */
  private var fraction = 0.0

  /** Scratch: source frames pulled out of the ring, linearised so the converter can index them. */
  private lateinit var srcScratch: ShortArray

  /** Scratch: converted output frames, handed to the track. */
  private lateinit var outScratch: ByteArray

  /** Low-water mark of the ring within the current adaptation window (source frames). */
  private var windowMinDepth = Long.MAX_VALUE
  private var windowStartNanos = System.nanoTime()

  private fun playLoop() {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    val outFrames = maxOf(1, writeFramesPerChunk)
    outScratch = ByteArray(outFrames * BYTES_PER_FRAME)
    // Worst case source frames for one output chunk, plus one for the interpolator's right-hand
    // sample and a little slack for the ratio's excursion.
    srcScratch = ShortArray(((outFrames * nominalRatio() * (1 + MAX_DRIFT) + 2).toInt() + 2) * CHANNELS)
    while (running) {
      try {
        if (!started) {
          // Prime for BOTH buffers, not just the cushion. The first writes fill the speaker track,
          // and every frame of that comes out of the ring — so priming to the cushion target alone
          // leaves the ring starved the moment playback begins, and it never recovers: the converter
          // sees a thin cushion from the very first chunk and spends the whole session easing off to
          // rebuild something that was never there.
          if ((writeFrames - readFrames) < primeFrames) {
            LockSupport.parkNanos(POLL_NANOS)
            continue
          }
          track.play()
          started = true
        }
        val depth = (writeFrames - readFrames).coerceAtLeast(0)
        if (depth > hardMaxFrames) {
          // Safety net. The converter should have prevented this; if it did not, playing the backlog
          // out would be permanent added latency, so drop it and say so.
          val excess = depth - targetFrames
          readFrames += excess
          discardedBytes += excess * BYTES_PER_FRAME
          fraction = 0.0
          continue
        }
        renderChunk(outFrames)
      } catch (error: Exception) {
        if (!running) break
        Log.w(TAG, "Audio player loop error; continuing", error)
        LockSupport.parkNanos(POLL_NANOS)
      }
    }
  }

  /**
   * Convert one output chunk out of the ring and write it.
   *
   * The ratio is nominal (source rate over output rate) nudged by how far the cushion is from its
   * target. That nudge is the whole drift-correction mechanism: capped at a fraction of a percent, it
   * is far below audibility, and it means a source clock that does not exactly match the DAC's is
   * absorbed continuously instead of accumulating until something has to be dropped or concealed.
   */
  private fun renderChunk(outFrames: Int) {
    val depth = (writeFrames - readFrames).coerceAtLeast(0)
    adaptCushion(depth)
    val ratio = nominalRatio() * (1.0 + driftAuthority(depth) * cushionError(depth))
    appliedRatio = ratio

    // How many output frames the ring can actually support, leaving the one extra source frame the
    // interpolator reads ahead. Producing a SHORT chunk is the right answer to a shallow ring: the
    // blocking write still paces us, and coming back for the rest a moment later is inaudible.
    // Concealing a whole chunk because the ring was one frame short is not — that quantises every
    // near-miss into 10 ms of silence, which is most of what the listener was hearing as crackle.
    val usable = ((depth - 1) - fraction) / ratio
    val renderFrames = minOf(outFrames.toLong(), Math.floor(usable).toLong()).toInt()
    if (renderFrames <= 0) {
      // Genuinely nothing to play. Wait briefly first — the track's own buffer covers a short wait —
      // and conceal only once the wait exceeds what the track can cover.
      if (waitForFrames(2)) return
      concealSilence(outFrames)
      return
    }

    copyFromRing(Math.ceil(fraction + renderFrames * ratio).toInt() + 1)
    var pos = fraction
    var o = 0
    for (i in 0 until renderFrames) {
      val idx = pos.toInt()
      val t = pos - idx
      val a = idx * CHANNELS
      val b = a + CHANNELS
      val left = srcScratch[a] + (srcScratch[b] - srcScratch[a]) * t
      val right = srcScratch[a + 1] + (srcScratch[b + 1] - srcScratch[a + 1]) * t
      putFrame(outScratch, o, left, right)
      o += BYTES_PER_FRAME
      pos += ratio
    }
    val consumed = pos.toInt()
    readFrames += consumed.toLong()
    fraction = pos - consumed
    writeBlocking(outScratch, renderFrames * BYTES_PER_FRAME)
  }

  /**
   * How far the cushion is from target, as -1..+1, with a deadband around the target.
   *
   * The deadband matters more than the gain. A loop that corrects continuously sits at its limit
   * whenever the depth is anywhere but exactly on target, and since the correction IS a change of
   * playback rate, that is a permanent detune — measurably 997.75 Hz for a 1000 Hz tone before the
   * deadband existed, which is the "sometimes it speeds up" the listener hears. Inside the band the
   * pipeline plays at exactly the right rate and lets the buffer absorb the difference, which is what
   * a buffer is for.
   */
  private fun cushionError(depth: Long): Double {
    val target = targetFrames.toDouble()
    if (target <= 0) return 0.0
    val error = (depth - target) / target
    if (Math.abs(error) < CUSHION_DEADBAND) return 0.0
    return error.coerceIn(-1.0, 1.0)
  }

  /**
   * How far the rate may be moved right now.
   *
   * Normally a whisper — well under the threshold of a noticeable pitch change — because the buffer,
   * not the rate, is what absorbs jitter. But a whisper cannot move the cushion far, and it needs to
   * move far in both directions:
   *
   *  - **Too thin** and the next gap is a hole. At 0.1% it would take two minutes to gain a tenth of
   *    a second, so the target would climb while the ring stayed empty and the holes kept coming.
   *  - **Too deep** and the latency is permanent. Absorbing one 148 ms burst left the mirror 241 ms
   *    behind the picture, and at 0.1% it would have taken twenty-five minutes to hand that back.
   *
   * So when the cushion is far from where it should be, in either direction, the pipeline may ease
   * on or off harder until it is close again. Half a percent is about eight cents, it lasts tens of
   * seconds rather than permanently, and it is far cheaper than either a gap or a lip-sync error.
   */
  private fun driftAuthority(depth: Long): Double {
    val floor = msToFrames(sourceRate, CUSHION_FLOOR_MS)
    val far = targetFrames + msToFrames(sourceRate, MAX_RING_MS) / 4
    return if (depth < floor || depth > far) REBUILD_DRIFT else MAX_DRIFT
  }

  /**
   * Steer the cushion from its own low-water mark.
   *
   * The question a jitter buffer has to answer is "how close to empty did I come", not "how deep am I
   * now" — depth right after a burst says nothing about whether the next gap will be survivable. So
   * the target tracks the minimum depth seen over a window: brushing empty means the link needs more
   * cushion than it has, and a comfortable margin every time means latency is being held that is not
   * buying anything.
   */
  private fun adaptCushion(depth: Long) {
    if (depth < windowMinDepth) windowMinDepth = depth
    val now = System.nanoTime()
    if (now - windowStartNanos < ADAPT_WINDOW_NANOS) return
    val floor = msToFrames(sourceRate, CUSHION_FLOOR_MS).toLong()
    targetFrames =
        when {
          windowMinDepth < floor ->
            minOf(maxTargetFrames, targetFrames + msToFrames(sourceRate, CUSHION_GROW_MS))
          windowMinDepth > floor + msToFrames(sourceRate, CUSHION_SLACK_MS) ->
            maxOf(minTargetFrames, targetFrames - msToFrames(sourceRate, CUSHION_DECAY_MS))
          else -> targetFrames
        }
    windowMinDepth = Long.MAX_VALUE
    windowStartNanos = now
  }

  private fun nominalRatio(): Double = sourceRate.toDouble() / outputRate.toDouble()

  /** Spin briefly for a late packet. Returns true if it arrived and the caller should retry. */
  private fun waitForFrames(needed: Int): Boolean {
    var waited = 0L
    while (waited < STARVE_LIMIT_NANOS && running) {
      LockSupport.parkNanos(POLL_NANOS)
      waited += POLL_NANOS
      if ((writeFrames - readFrames) >= needed) return true
    }
    return false
  }

  /**
   * Write silence, and take it as evidence that the cushion is too small for this link.
   *
   * Concealment is not a recovery: the listener has already heard a hole. Growing the target here is
   * what stops the *next* burst producing another one, and it is why the pipeline settles on a link
   * whose burstiness it was never told about in advance.
   */
  private fun concealSilence(outFrames: Int) {
    java.util.Arrays.fill(outScratch, 0)
    concealedFrames += outFrames.toLong()
    // Running dry is the strongest possible evidence that the cushion is too small, so act on it at
    // once rather than waiting for the window to close.
    windowMinDepth = 0
    if (targetFrames < maxTargetFrames) {
      targetFrames = minOf(maxTargetFrames, targetFrames + msToFrames(sourceRate, CUSHION_GROW_MS))
    }
    writeBlocking(outScratch, outScratch.size)
  }

  /** Linearise [count] source frames starting at the current read position into [srcScratch]. */
  private fun copyFromRing(count: Int) {
    var index = (readFrames % ringFrames).toInt()
    var out = 0
    for (i in 0 until count) {
      val base = index * BYTES_PER_FRAME
      srcScratch[out] = ((ring[base].toInt() and 0xFF) or (ring[base + 1].toInt() shl 8)).toShort()
      srcScratch[out + 1] = ((ring[base + 2].toInt() and 0xFF) or (ring[base + 3].toInt() shl 8)).toShort()
      out += CHANNELS
      index++
      if (index == ringFrames) index = 0
    }
  }

  private fun putFrame(dst: ByteArray, offset: Int, left: Double, right: Double) {
    val l = left.toInt().coerceIn(-32768, 32767)
    val r = right.toInt().coerceIn(-32768, 32767)
    dst[offset] = (l and 0xFF).toByte()
    dst[offset + 1] = ((l shr 8) and 0xFF).toByte()
    dst[offset + 2] = (r and 0xFF).toByte()
    dst[offset + 3] = ((r shr 8) and 0xFF).toByte()
  }

  /**
   * One blocking write plus the stats refresh.
   *
   * The track counters are read here, on the player thread, rather than wherever a caller happens to
   * ask: `playbackHeadPosition` and `underrunCount` are round trips to AudioFlinger, and reading them
   * from the bridge under the same lock the receive path held is what used to let a stats poll stall
   * packet reception.
   */
  private fun writeBlocking(data: ByteArray, length: Int) {
    val written = track.write(data, 0, length, AudioTrack.WRITE_BLOCKING)
    if (written > 0) totalFramesWritten += (written / BYTES_PER_FRAME).toLong()
    if (written < length) {
      discardedBytes += (length - maxOf(written, 0)).toLong()
      if (written <= 0) LockSupport.parkNanos(POLL_NANOS)
    }
    refreshTrackStatsOccasionally()
  }

  /**
   * Read the track's counters every so often, not on every write.
   *
   * `underrunCount` and `playbackHeadPosition` are binder round trips to AudioFlinger. Writing one
   * HAL burst at a time means ~200 writes a second, and asking both questions on each of them put
   * ~400 IPCs a second on the realtime thread — enough that the thread was sometimes still waiting on
   * the audio server when the DAC wanted its next burst, which is an underrun caused purely by
   * measuring. Diagnostics must not be able to cause the fault they are there to report.
   */
  private fun refreshTrackStatsOccasionally() {
    val now = System.nanoTime()
    if (now - lastStatsReadNanos < STATS_READ_INTERVAL_NANOS) return
    lastStatsReadNanos = now
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      try {
        trackUnderruns = track.underrunCount
      } catch (error: Exception) {
        Log.d(TAG, "underrunCount unavailable", error)
      }
    }
    try {
      trackQueuedFrames = (totalFramesWritten - track.playbackHeadPosition.toLong()).coerceAtLeast(0)
    } catch (error: Exception) {
      Log.d(TAG, "playbackHeadPosition unavailable", error)
    }
  }

  private var lastStatsReadNanos = 0L

  internal companion object {
    private const val TAG = "AudioPipeline"
    const val BYTES_PER_FRAME = 4 // stereo * S16
    private const val CHANNELS = 2
    private const val CHANNEL_CONFIG = AudioFormat.CHANNEL_OUT_STEREO
    private const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
    private const val FALLBACK_BUFFER_BYTES = 8192

    /**
     * Track buffer size in HAL bursts. Two is the documented low-latency floor and leaves no margin
     * for the player thread being descheduled; four is still around 15–20 ms on a modern device and
     * survives an ordinary scheduling hiccup without the DAC drying out.
     */
    private const val TRACK_BURSTS = 4

    /** Never leave the ring so shallow that a single late packet empties it. */
    private const val MIN_RING_MS = 30

    /**
     * The deepest cushion the pipeline will grow to. Sized from measurement: this rig's Wi-Fi
     * delivered 118.7 ms gaps, and a cushion has to cover the gap with room to refill afterwards.
     */
    private const val MAX_RING_MS = 320

    /** Added on every concealment — big enough to make progress against a burst pattern quickly. */
    private const val CUSHION_GROW_MS = 24

    /** Given back in smaller steps than it was taken, so the cushion cannot oscillate. */
    private const val CUSHION_DECAY_MS = 8

    /** How close to empty the ring is allowed to come before the cushion is grown. */
    private const val CUSHION_FLOOR_MS = 25

    /** Spare margin above the floor that has to persist before any latency is handed back. */
    private const val CUSHION_SLACK_MS = 40

    /** Long enough to contain several of this link's bursts, short enough to settle in seconds. */
    private const val ADAPT_WINDOW_NANOS = 2_000_000_000L

    /**
     * How far the resampling ratio may be pushed from nominal to hold the cushion.
     *
     * 0.1% is under two cents — below the threshold at which a pitch change is noticeable even on a
     * sustained tone — and still three times the 0.035% clock difference between the C64's 47983 Hz
     * and the phone's DAC that it exists to absorb. It was ten times this at first, and a tone test
     * showed the result: a steady 1000 Hz came out at 997.75 Hz, which is audible as the tune
     * wandering in speed.
     */
    private const val MAX_DRIFT = 0.001

    /** The wider authority allowed only while the cushion is below its floor — see [driftAuthority]. */
    private const val REBUILD_DRIFT = 0.005

    /** Overlap used to rejoin real audio after a concealment — long enough to hide the seam. */
    private const val CONCEAL_BLEND_MS = 2

    /**
     * How far the cushion may sit from target before the rate is touched at all. Without a deadband
     * the loop corrects permanently, so the correction stops being a correction and becomes a detune.
     */
    private const val CUSHION_DEADBAND = 0.35


    private const val POLL_NANOS = 500_000L // 0.5 ms

    /** How often the track's own counters are worth a binder round trip. */
    private const val STATS_READ_INTERVAL_NANOS = 100_000_000L // 100 ms

    /** How long to wait for a late packet before concealing (shorter than the track's own buffer). */
    private const val STARVE_LIMIT_NANOS = 8_000_000L // 8 ms

    fun msToFrames(sampleRate: Int, ms: Int): Int = (sampleRate.toLong() * ms / 1000).toInt()

    /** Fallback when the platform will not name its burst size: 5 ms, the usual order of magnitude. */
    private fun defaultBurstFrames(outputRate: Int): Int = maxOf(64, outputRate / 200)

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
    fun buildAudioTrack(outputRate: Int, bufferBytes: Int): AudioTrack {
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
                      .setEncoding(ENCODING)
                      .setSampleRate(outputRate)
                      .setChannelMask(CHANNEL_CONFIG)
                      .build(),
              )
              .setBufferSizeInBytes(bufferBytes)
              .setTransferMode(AudioTrack.MODE_STREAM)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        builder.setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
      }
      return builder.build()
    }
  }
}
