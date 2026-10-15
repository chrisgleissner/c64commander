/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.dsp

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

internal class SpectrumChannelLevel(val id: String, val rmsDb: Int, val peakDb: Int, val clipped: Boolean)

/** One analysis result, in the shape `readSpectrum` hands to the web layer. */
internal class SpectrumFrame(
    val enabled: Boolean,
    val active: Boolean,
    val sequence: Long,
    val sampleRate: Int,
    val bands: IntArray,
    val peakDb: Int,
    val rmsDb: Int,
    val clipped: Boolean,
    val channels: Array<SpectrumChannelLevel> = arrayOf(
        SpectrumChannelLevel("left", SpectrumBands.FLOOR_DB, SpectrumBands.FLOOR_DB, false),
        SpectrumChannelLevel("right", SpectrumBands.FLOOR_DB, SpectrumBands.FLOOR_DB, false),
    ),
    /** The monotonic clock when this frame was read, for lining the web layer's clock up with the native one. */
    val timestampNanos: Long = 0L,
    /** How many samples a window wanted beyond the newest one held; the bands lag by that much. */
    val shortfallSamples: Int = 0,
    /** True when the bands follow a speaker position, so a later target time yields later sound. */
    val aligned: Boolean = false,
)

/**
 * The band layout shared with the web layer: 48 log-spaced bands, band i covering [edge(i), edge(i+1))
 * with edge(i) = 31.25 * 2^(i * 9 / 48) Hz, from 31.25 Hz to 16 kHz.
 */
internal object SpectrumBands {
  const val COUNT = 48
  const val FLOOR_DB = -100
  private const val LOWEST_HZ = 31.25
  private const val OCTAVES = 9.0

  fun edge(index: Int): Double = LOWEST_HZ * 2.0.pow(index * OCTAVES / COUNT)
}

/**
 * Real-time spectrum of the sound, lined up with when it is heard.
 *
 * The writer calls [feed], which only downmixes into a history ring, so its cost is a few operations
 * per sample. The FFT runs on whichever thread calls [read], never on the audio thread.
 *
 * Each [read] reports the peak and RMS of every sample heard since the previous analysis, and at
 * least of the last 1/60 s, and latches the clip flag if any of them reached full scale.
 *
 * Which samples a [read] analyses depends on where the pipeline taps the audio:
 *  - A live stream feeds samples as they arrive, before its jitter ring, and never reports a speaker
 *    position. Its window ends at the newest sample, so the bars follow the source machine, whose
 *    own speakers the listener hears in the room.
 *  - On-device playback feeds samples as they enter a deep track buffer and reports, through
 *    [presentAt], how far its writes run ahead of the speaker. A read names the time the frame will
 *    be shown, and each window is centred on the sample the speaker plays then; the track buffer holds
 *    seconds of audio beyond it, so no window length delays the bars. Tapping at the write put the bars
 *    about two seconds ahead of the sound.
 *
 * Band value: bins of a Hann-windowed FFT are converted to amplitude (so a full-scale sine peaks at
 * 1.0), squared, and power-summed over the bins whose centre lies in the band, divided by the
 * window's noise bandwidth (1.5 bins) so that a sine reads its own level wherever it falls between
 * bins. A band narrower than one bin takes the power interpolated between the two bins around its
 * centre. Values are rounded to whole dBFS and floored at [SpectrumBands.FLOOR_DB].
 */
internal class SpectrumAnalyzer(private val nanoTime: () -> Long = System::nanoTime) {
  /** [binFrom]..[binTo] are the only bins of this window that any of its [bands] reads. */
  private class Resolution(val fft: FftPlan, val plan: BandPlan, val bands: IntArray) {
    val binFrom = bands.minOfOrNull { plan.firstBin(it) } ?: 0
    val binTo = bands.maxOfOrNull { plan.lastBin(it) } ?: -1
  }

  private class Configuration(
      val sampleRate: Int,
      /** One window per resolution, longest first; each band is read from the shortest window that resolves it. */
      val resolutions: Array<Resolution>,
      /** Samples per published sequence step: one analysis frame, or finer for a live stream. */
      val stepSamples: Int,
      /** The shortest span the level readout (peak, RMS, clip) covers. */
      val levelSamples: Int,
      /** The longest span one level readout catches up over: as long as a clip stays latched. */
      val clipHoldSamples: Int,
      /** Mono downmix, indexed by sample count modulo its power-of-two size. */
      val history: FloatArray,
      /** Signed stereo samples, retained separately so opposite-phase audio cannot cancel a meter. */
      val left: FloatArray,
      val right: FloatArray,
  ) {
    val mask = (history.size - 1).toLong()
    /** How far behind the newest sample a window can still end with all of its samples held. */
    val reach = (history.size - resolutions[0].fft.size).toLong()
  }

  /** Installed while opening a pipeline, never lazily by the real-time writer. */
  @Volatile private var configuration: Configuration? = null
  @Volatile private var writeCount = 0L
  /**
   * Set by the writer before it stores a chunk: samples below this, less the history size, may be
   * overwritten. A read is invalid only if it used one of those, not merely because a feed overlapped it.
   */
  @Volatile private var writingUpTo = 0L
  @Volatile private var lastFeedNanos = Long.MIN_VALUE
  /** A seqlock around the speaker report, which the writer updates without allocating. 0: no report. */
  @Volatile private var anchorVersion = 0L
  @Volatile private var anchorIndex = 0L
  @Volatile private var anchorNanos = 0L
  private var readerAnchorKnown = false
  private var readerAnchorIndex = 0L
  private var readerAnchorNanos = 0L
  private var lastClipNanos = Long.MIN_VALUE
  private val channelClipNanos = LongArray(2) { Long.MIN_VALUE }
  /** Where the last analysis ended; the next level readout covers every sample heard since. */
  private var levelsReadTo = Long.MAX_VALUE

  private val re = FloatArray(MAX_FFT_SIZE)
  private val im = FloatArray(MAX_FFT_SIZE)
  private val power = FloatArray(MAX_FFT_SIZE / 2 + 1)
  private var cached: SpectrumFrame? = null
  private var cachedSeq = -1L

  /**
   * Prepare analysis for a pipeline's rate. This allocates the band plan and history on the opening
   * thread, before its writer is started. A rate switch deliberately starts a fresh sequence.
   *
   * [fftSize] trades frequency resolution for delay: the window's centre lags its newest sample by
   * half its length, 43 ms at 4096 points and 21 ms at 2048 points at 48 kHz. [stepsPerSecond] is how
   * often the published sequence advances. [speakerLagFrames] is the track buffer a writer feeds
   * ahead of the speaker; the history keeps that much more audio so the speaker stays within it.
   */
  @Synchronized
  fun prepare(sampleRate: Int, fftSize: Int = FFT_SIZE, stepsPerSecond: Int = FRAMES_PER_SECOND, speakerLagFrames: Int = 0) {
    require(sampleRate > 0) { "sampleRate must be positive" }
    require(speakerLagFrames >= 0) { "speakerLagFrames must not be negative" }
    val resolutions = resolutionsFor(sampleRate, fftSize)
    val historySize = historySizeFor(sampleRate, fftSize, speakerLagFrames)
    val previous = configuration
    val history = previous?.history?.takeIf { it.size == historySize }?.also { it.fill(0.0f) } ?: FloatArray(historySize)
    val left = previous?.left?.takeIf { it.size == historySize }?.also { it.fill(0.0f) } ?: FloatArray(historySize)
    val right = previous?.right?.takeIf { it.size == historySize }?.also { it.fill(0.0f) } ?: FloatArray(historySize)
    val next =
        Configuration(
            sampleRate,
            resolutions,
            maxOf(1, sampleRate / stepsPerSecond),
            maxOf(1, sampleRate / LEVEL_SPANS_PER_SECOND),
            (sampleRate * CLIP_HOLD_NANOS / 1_000_000_000L).toInt(),
            history,
            left,
            right,
        )
    writeCount = 0
    writingUpTo = 0
    lastFeedNanos = Long.MIN_VALUE
    lastClipNanos = Long.MIN_VALUE
    channelClipNanos.fill(Long.MIN_VALUE)
    levelsReadTo = Long.MAX_VALUE
    anchorVersion = 0L
    readerAnchorKnown = false
    cached = null
    cachedSeq = -1
    configuration = next
  }

  /**
   * Prepare for a pipeline. A live stream is fed at arrival at its source rate, with the short window as its
   * windows end at the newest sample; on-device playback is fed at the output rate as it is written, [speakerLagFrames]
   * ahead of the speaker.
   */
  fun prepareFor(live: Boolean, sourceRate: Int, outputRate: Int, speakerLagFrames: Int = 0) {
    if (live) prepare(sourceRate, LIVE_FFT_SIZE, LIVE_STEPS_PER_SECOND)
    else prepare(outputRate, FFT_SIZE, LIVE_STEPS_PER_SECOND, speakerLagFrames)
  }

  /** Called by the writer with interleaved stereo S16LE frames, starting [offset] bytes into [data]. */
  fun feed(data: ByteArray, frames: Int, sampleRate: Int, offset: Int = 0) {
    if (frames <= 0) return
    val config = configuration
    // A pipeline must prepare its rate before it starts. Dropping this diagnostic frame is safer
    // than allocating a BandPlan on the audio writer.
    if (config == null || config.sampleRate != sampleRate) return
    val history = config.history
    val mask = config.mask
    var at = offset
    var count = writeCount
    writingUpTo = count + frames
    for (i in 0 until frames) {
      val l = ((data[at].toInt() and 0xFF) or (data[at + 1].toInt() shl 8)).toShort() * INV_FULL_SCALE
      val r = ((data[at + 2].toInt() and 0xFF) or (data[at + 3].toInt() shl 8)).toShort() * INV_FULL_SCALE
      at += BYTES_PER_FRAME
      val slot = (count and mask).toInt()
      history[slot] = (l + r) * 0.5f
      config.left[slot] = l
      config.right[slot] = r
      count++
    }
    writeCount = count
    lastFeedNanos = nanoTime()
  }

  /**
   * Called by the writer that feeds, whose samples reach the speaker late: [framesAheadOfSpeaker] of
   * what it has fed had not been heard at [timestampNanos]. Reads then analyse what the speaker is
   * playing. Allocation-free. Returns false when the speaker lags further than the history reaches,
   * in which case reads show the oldest audio still held, which is later than what is heard.
   */
  fun presentAt(framesAheadOfSpeaker: Long, timestampNanos: Long): Boolean {
    val ahead = framesAheadOfSpeaker.coerceAtLeast(0L)
    anchorVersion++
    anchorIndex = writeCount - ahead
    anchorNanos = timestampNanos
    anchorVersion++
    val config = configuration ?: return true
    return ahead <= config.reach
  }

  /** The analysis of the samples now being heard; runs the FFT only when they have moved on. */
  @Synchronized
  fun read(enabled: Boolean, targetNanos: Long = 0L): SpectrumFrame {
    val now = nanoTime()
    val config = configuration
    val newest = writeCount
    if (!enabled || config == null || newest == 0L) {
      val active = enabled && config != null && now - lastFeedNanos < ACTIVE_WINDOW_NANOS
      return SpectrumFrame(enabled, active, 0L, config?.sampleRate ?: 0, floorBands(), SpectrumBands.FLOOR_DB, SpectrumBands.FLOOR_DB, false)
    }
    val end = heardUpTo(config, newest, now, targetNanos)
    val active = now - lastFeedNanos < ACTIVE_WINDOW_NANOS || newest - end >= config.levelSamples
    val seq = end / config.stepSamples
    val previous = cached
    if (previous == null || cachedSeq != seq) {
      val analysed = analyseStable(config, seq * config.stepSamples, newest, now)
      if (analysed != null) {
        cached = analysed
        cachedSeq = seq
      }
    }
    val frame = cached
    val clipped = lastClipNanos != Long.MIN_VALUE && now - lastClipNanos < CLIP_HOLD_NANOS
    if (frame == null) {
      // A sequence is observable only once its matching history has been copied.
      return SpectrumFrame(true, active, 0L, config.sampleRate, floorBands(), SpectrumBands.FLOOR_DB, SpectrumBands.FLOOR_DB, clipped, timestampNanos = now, aligned = readerAnchorKnown)
    }
    return SpectrumFrame(true, active, frame.sequence, frame.sampleRate, frame.bands, frame.peakDb, frame.rmsDb, clipped,
        Array(2) { channel ->
          val level = frame.channels[channel]
          SpectrumChannelLevel(level.id, level.rmsDb, level.peakDb,
              channelClipNanos[channel] != Long.MIN_VALUE && now - channelClipNanos[channel] < CLIP_HOLD_NANOS)
        }, now, frame.shortfallSamples, readerAnchorKnown)
  }

  /**
   * The history index the listener has heard up to. Without a speaker position that is the newest
   * sample. With one, the speaker is followed from its last report for at most [MAX_EXTRAPOLATION_NANOS],
   * so a paused track, which stops reporting, freezes the bars rather than running into audio that
   * has not been played.
   */
  private fun heardUpTo(config: Configuration, newest: Long, now: Long, targetNanos: Long): Long {
    if (!refreshSpeakerAnchor()) return newest
    val age = (now - readerAnchorNanos).coerceIn(0L, MAX_EXTRAPOLATION_NANOS)
    val lead = if (targetNanos > 0L) (targetNanos - now).coerceIn(0L, MAX_LEAD_NANOS) else 0L
    val elapsed = age + lead
    val heard = readerAnchorIndex + elapsed * config.sampleRate / 1_000_000_000L
    return heard.coerceIn(maxOf(0L, newest - config.reach), newest)
  }

  /** Copies a stable speaker report for the reader; keeps the previous one while the writer is mid-update. */
  private fun refreshSpeakerAnchor(): Boolean {
    repeat(MAX_READ_RETRIES) {
      val version = anchorVersion
      if (version == 0L) return false
      if ((version and 1L) == 0L) {
        val index = anchorIndex
        val nanos = anchorNanos
        if (version == anchorVersion) {
          readerAnchorIndex = index
          readerAnchorNanos = nanos
          readerAnchorKnown = true
          return true
        }
      }
    }
    return readerAnchorKnown
  }

  /** Analyses samples up to [newest]; null when the writer overwrote any of them meanwhile. */
  private fun analyseStable(config: Configuration, end: Long, newest: Long, now: Long): SpectrumFrame? {
    val history = config.history
    val mask = config.mask
    val bands = IntArray(SpectrumBands.COUNT)
    var oldestRead = Long.MAX_VALUE
    var shortfall = 0L
    for (resolution in config.resolutions) {
      val size = resolution.fft.size
      val window = resolution.fft.window
      val wanted = end + size / 2
      val windowEnd = minOf(wanted, newest)
      shortfall = maxOf(shortfall, wanted - windowEnd)
      val start = windowEnd - size
      oldestRead = minOf(oldestRead, start)
      for (n in 0 until size) {
        val index = start + n
        re[n] = if (index < 0) 0.0f else history[(index and mask).toInt()] * window[n]
        im[n] = 0.0f
      }
      resolution.fft.transform(re, im)
      val powerScale = resolution.fft.powerScale
      for (k in resolution.binFrom..resolution.binTo) power[k] = (re[k] * re[k] + im[k] * im[k]) * powerScale
      resolution.plan.fill(power, resolution.bands, bands)
    }
    // Every sample heard since the last analysis counts, so a clip between two polls is not missed, but only as far
    // back as a clip stays latched, so a pause in reading cannot make the next analysis cover the whole history.
    val levelsEnd = minOf(end + config.levelSamples / 2, newest)
    val sinceLastAnalysis = minOf(levelsEnd - config.levelSamples, levelsReadTo)
    val from = maxOf(0L, sinceLastAnalysis, levelsEnd - config.clipHoldSamples, newest - config.reach)
    oldestRead = minOf(oldestRead, from)
    var sumSq = 0.0
    var leftPeak = 0.0f
    var rightPeak = 0.0f
    var leftSumSq = 0.0
    var rightSumSq = 0.0
    for (index in from until levelsEnd) {
      val slot = (index and mask).toInt()
      val mono = history[slot]
      val l = config.left[slot]
      val r = config.right[slot]
      sumSq += mono * mono
      leftPeak = maxOf(leftPeak, kotlin.math.abs(l))
      rightPeak = maxOf(rightPeak, kotlin.math.abs(r))
      leftSumSq += l * l
      rightSumSq += r * r
    }
    if (writingUpTo - history.size > oldestRead) return null
    val peak = maxOf(leftPeak, rightPeak)
    if (peak >= CLIP_LEVEL) lastClipNanos = now
    if (leftPeak >= CLIP_LEVEL) channelClipNanos[0] = now
    if (rightPeak >= CLIP_LEVEL) channelClipNanos[1] = now
    levelsReadTo = levelsEnd
    val span = levelsEnd - from
    val rms = if (span > 0) sqrt(sumSq / span) else 0.0
    return SpectrumFrame(true, true, end / config.stepSamples, config.sampleRate, bands, toDb(peak.toDouble()), toDb(rms), false,
        arrayOf(
            SpectrumChannelLevel("left", toDb(if (span > 0) sqrt(leftSumSq / span) else 0.0), toDb(leftPeak.toDouble()), leftPeak >= CLIP_LEVEL),
            SpectrumChannelLevel("right", toDb(if (span > 0) sqrt(rightSumSq / span) else 0.0), toDb(rightPeak.toDouble()), rightPeak >= CLIP_LEVEL),
        ), now, shortfall.toInt())
  }

  /**
   * Windows of [longest], half of it and a quarter of it. A band is read from the shortest window whose
   * bins are at most half as wide as the band, so the treble, where a beat shows first, trails the sound by a
   * quarter of the bass window's delay while the bass keeps its resolution.
   */
  private fun resolutionsFor(sampleRate: Int, longest: Int): Array<Resolution> {
    val sizes = listOf(longest, longest / 2, longest / 4).filter { it in SUPPORTED_FFT_SIZES }
    val owners = IntArray(SpectrumBands.COUNT) { band ->
      val width = SpectrumBands.edge(band + 1) - SpectrumBands.edge(band)
      sizes.indices.last { index -> index == 0 || width >= MIN_BINS_PER_BAND * sampleRate / sizes[index] }
    }
    return Array(sizes.size) { index ->
      val bands = (0 until SpectrumBands.COUNT).filter { owners[it] == index }.toIntArray()
      Resolution(FftPlan.of(sizes[index]), BandPlan(sampleRate, sizes[index]), bands)
    }
  }

  internal fun writeCountForTest(): Long = writeCount

  private fun floorBands(): IntArray = IntArray(SpectrumBands.COUNT) { SpectrumBands.FLOOR_DB }

  /** Window, twiddles and bit reversal for one FFT length; shared, built once per length. */
  private class FftPlan private constructor(val size: Int) {
    val window = FloatArray(size) { (0.5 - 0.5 * cos(2.0 * PI * it / size)).toFloat() }
    /** A bin's squared magnitude times this is the power of the sine it holds, whose full-scale value is 1.0. */
    val powerScale = 16.0f / (size.toFloat() * size)
    private val cosTable = FloatArray(size / 2) { cos(2.0 * PI * it / size).toFloat() }
    private val sinTable = FloatArray(size / 2) { (-sin(2.0 * PI * it / size)).toFloat() }
    private val bitReverse = IntArray(size) { Integer.reverse(it) ushr (32 - Integer.numberOfTrailingZeros(size)) }

    fun transform(re: FloatArray, im: FloatArray) {
      for (i in 0 until size) {
        val j = bitReverse[i]
        if (j > i) {
          val tr = re[i]
          re[i] = re[j]
          re[j] = tr
          val ti = im[i]
          im[i] = im[j]
          im[j] = ti
        }
      }
      var half = 1
      while (half < size) {
        val step = size / (half * 2)
        var block = 0
        while (block < size) {
          for (k in 0 until half) {
            val wr = cosTable[k * step]
            val wi = sinTable[k * step]
            val a = block + k
            val b = a + half
            val xr = re[b] * wr - im[b] * wi
            val xi = re[b] * wi + im[b] * wr
            re[b] = re[a] - xr
            im[b] = im[a] - xi
            re[a] += xr
            im[a] += xi
          }
          block += half * 2
        }
        half *= 2
      }
    }

    companion object {
      private val plans = mutableMapOf<Int, FftPlan>()

      @Synchronized
      fun of(size: Int): FftPlan {
        require(size in SUPPORTED_FFT_SIZES) { "Unsupported FFT size $size" }
        return plans.getOrPut(size) { FftPlan(size) }
      }
    }
  }

  private class BandPlan(sampleRate: Int, private val fftSize: Int) {
    private val first = IntArray(SpectrumBands.COUNT)
    private val last = IntArray(SpectrumBands.COUNT)
    private val interpolated = BooleanArray(SpectrumBands.COUNT)
    private val aboveNyquist = BooleanArray(SpectrumBands.COUNT)
    private val lowBin = IntArray(SpectrumBands.COUNT)
    private val highWeight = FloatArray(SpectrumBands.COUNT)

    init {
      val binHz = sampleRate.toDouble() / fftSize
      val nyquist = sampleRate / 2.0
      for (i in 0 until SpectrumBands.COUNT) {
        val low = SpectrumBands.edge(i)
        val high = SpectrumBands.edge(i + 1)
        aboveNyquist[i] = low >= nyquist
        interpolated[i] = high - low < binHz
        first[i] = Math.ceil(low / binHz).toInt()
        last[i] = minOf(fftSize / 2, Math.ceil(high / binHz).toInt() - 1)
        val centre = Math.sqrt(low * high) / binHz
        lowBin[i] = minOf(fftSize / 2 - 1, centre.toInt())
        highWeight[i] = (centre - lowBin[i]).toFloat()
      }
    }

    fun firstBin(band: Int): Int = if (aboveNyquist[band]) Int.MAX_VALUE else if (interpolated[band]) lowBin[band] else first[band]

    fun lastBin(band: Int): Int = if (aboveNyquist[band]) -1 else if (interpolated[band]) lowBin[band] + 1 else last[band]

    fun fill(power: FloatArray, owned: IntArray, out: IntArray) {
      for (i in owned) {
        if (aboveNyquist[i]) {
          out[i] = SpectrumBands.FLOOR_DB
          continue
        }
        val value =
            if (interpolated[i]) {
              power[lowBin[i]] * (1.0f - highWeight[i]) + power[lowBin[i] + 1] * highWeight[i]
            } else {
              var sum = 0.0f
              for (k in first[i]..last[i]) sum += power[k]
              sum / NOISE_BANDWIDTH_BINS
            }
        out[i] = toDb(value.toDouble(), true)
      }
    }
  }

  companion object {
    const val FFT_SIZE = 4096
    /** The longest display window, which reads the bass; shorter windows read the bands above it. */
    const val LIVE_FFT_SIZE = 2048
    /** A new frame is published every 4 ms of audio, so a poll never waits on a step. */
    const val LIVE_STEPS_PER_SECOND = 240
    private const val MAX_FFT_SIZE = FFT_SIZE
    private val SUPPORTED_FFT_SIZES = setOf(512, 1024, LIVE_FFT_SIZE, FFT_SIZE)
    /** About 2.7 s at 48 kHz, which holds the deepest track buffer measured (2.2 s to the speaker). */
    private const val MIN_HISTORY_SIZE = 1 shl 17
    /** Output latency below the app, which the track reports only once it plays; 235 ms was measured. */
    private const val BELOW_APP_ALLOWANCE_MS = 500
    private const val BYTES_PER_FRAME = 4
    private const val FRAMES_PER_SECOND = 30
    private const val LEVEL_SPANS_PER_SECOND = 60
    private const val MAX_READ_RETRIES = 3
    private const val INV_FULL_SCALE = 1.0f / 32768.0f
    private const val CLIP_LEVEL = 32767.0f / 32768.0f
    private const val NOISE_BANDWIDTH_BINS = 1.5f
    private const val MIN_BINS_PER_BAND = 2.0
    private const val ACTIVE_WINDOW_NANOS = 400_000_000L
    private const val CLIP_HOLD_NANOS = 1_000_000_000L
    private const val MAX_EXTRAPOLATION_NANOS = 250_000_000L
    private const val MAX_LEAD_NANOS = 500_000_000L

    private fun historySizeFor(sampleRate: Int, fftSize: Int, speakerLagFrames: Int): Int {
      val needed = speakerLagFrames + sampleRate * BELOW_APP_ALLOWANCE_MS / 1000 + fftSize
      return maxOf(MIN_HISTORY_SIZE, Integer.highestOneBit(needed - 1) shl 1)
    }

    /** Linear power (a full-scale sine is 1.0) to whole dBFS, floored. */
    fun toDb(value: Double, isPower: Boolean = false): Int {
      val power = if (isPower) value else value * value
      if (!(power > 1e-12)) return SpectrumBands.FLOOR_DB
      return Math.round(10.0 * log10(power)).toInt().coerceIn(SpectrumBands.FLOOR_DB, 6)
    }
  }
}
