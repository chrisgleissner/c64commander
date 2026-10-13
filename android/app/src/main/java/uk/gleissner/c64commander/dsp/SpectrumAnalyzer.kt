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
 * Which samples a [read] analyses depends on where the pipeline taps the audio:
 *  - A live stream feeds samples as they arrive, before its jitter ring, and never reports a speaker
 *    position. Its window ends at the newest sample, so the bars follow the source machine, whose
 *    own speakers the listener hears in the room.
 *  - On-device playback feeds samples as they enter a deep track buffer and reports, through
 *    [presentAt], how far its writes run ahead of the speaker. Its window ends at the sample
 *    leaving the speaker; tapping at the write put the bars about two seconds ahead of the sound.
 *
 * Band value: bins of a Hann-windowed FFT are converted to amplitude (so a full-scale sine peaks at
 * 1.0), squared, and power-summed over the bins whose centre lies in the band, divided by the
 * window's noise bandwidth (1.5 bins) so that a sine reads its own level wherever it falls between
 * bins. A band narrower than one bin takes the power interpolated between the two bins around its
 * centre. Values are rounded to whole dBFS and floored at [SpectrumBands.FLOOR_DB].
 */
internal class SpectrumAnalyzer(private val nanoTime: () -> Long = System::nanoTime) {
  private val history = FloatArray(HISTORY_SIZE)
  private val levels = FloatArray(HISTORY_SIZE)

  private class Configuration(
      val sampleRate: Int,
      val fft: FftPlan,
      val plan: BandPlan,
      /** Samples per published sequence step: one analysis frame, or finer for a live stream. */
      val stepSamples: Int,
      /** Samples the level readout (peak, RMS, clip) is measured over. */
      val levelSamples: Int,
  )

  /** Where the speaker was: the history index it had reached at [nanos]. */
  private class Anchor(val index: Long, val nanos: Long)

  /** Installed while opening a pipeline, never lazily by the real-time writer. */
  @Volatile private var configuration: Configuration? = null
  /** A seqlock around the history: even values describe stable samples. */
  @Volatile private var publication = 0L
  @Volatile private var writeCount = 0L
  @Volatile private var lastFeedNanos = Long.MIN_VALUE
  @Volatile private var anchor: Anchor? = null
  private var lastClipNanos = Long.MIN_VALUE

  private val re = FloatArray(MAX_FFT_SIZE)
  private val im = FloatArray(MAX_FFT_SIZE)
  private val power = FloatArray(MAX_FFT_SIZE / 2 + 1)
  private var cached: SpectrumFrame? = null
  private var cachedSeq = -1L

  /**
   * Prepare analysis for a pipeline's rate. This allocates the band plan on the opening thread,
   * before its writer is started. A rate switch deliberately starts a fresh sequence.
   *
   * [fftSize] trades frequency resolution for delay: the window's centre lags its newest sample by
   * half its length, 43 ms at 4096 points and 21 ms at 2048 points at 48 kHz. [stepsPerSecond] is how
   * often the published sequence advances.
   */
  @Synchronized
  fun prepare(sampleRate: Int, fftSize: Int = FFT_SIZE, stepsPerSecond: Int = FRAMES_PER_SECOND) {
    require(sampleRate > 0) { "sampleRate must be positive" }
    val fft = FftPlan.of(fftSize)
    val next =
        Configuration(
            sampleRate,
            fft,
            BandPlan(sampleRate, fft.size),
            maxOf(1, sampleRate / stepsPerSecond),
            maxOf(1, sampleRate / FRAMES_PER_SECOND),
        )
    publication++
    history.fill(0.0f)
    levels.fill(0.0f)
    writeCount = 0
    lastFeedNanos = Long.MIN_VALUE
    lastClipNanos = Long.MIN_VALUE
    anchor = null
    cached = null
    cachedSeq = -1
    configuration = next
    publication++
  }

  /**
   * Prepare for a pipeline. A live stream is fed at arrival at its source rate, with the short window
   * and fine steps; on-device playback is fed at the output rate as it is written.
   */
  fun prepareFor(live: Boolean, sourceRate: Int, outputRate: Int) {
    if (live) prepare(sourceRate, LIVE_FFT_SIZE, LIVE_STEPS_PER_SECOND) else prepare(outputRate)
  }

  /** Called by the writer with interleaved stereo S16LE frames, starting [offset] bytes into [data]. */
  fun feed(data: ByteArray, frames: Int, sampleRate: Int, offset: Int = 0) {
    if (frames <= 0) return
    val config = configuration
    // A pipeline must prepare its rate before it starts. Dropping this diagnostic frame is safer
    // than allocating a BandPlan on the audio writer.
    if (config == null || config.sampleRate != sampleRate) return
    publication++
    var at = offset
    var count = writeCount
    for (i in 0 until frames) {
      val l = ((data[at].toInt() and 0xFF) or (data[at + 1].toInt() shl 8)).toShort() * INV_FULL_SCALE
      val r = ((data[at + 2].toInt() and 0xFF) or (data[at + 3].toInt() shl 8)).toShort() * INV_FULL_SCALE
      at += BYTES_PER_FRAME
      val slot = (count and HISTORY_MASK).toInt()
      history[slot] = (l + r) * 0.5f
      val al = if (l < 0) -l else l
      val ar = if (r < 0) -r else r
      levels[slot] = if (al > ar) al else ar
      count++
    }
    writeCount = count
    lastFeedNanos = nanoTime()
    publication++
  }

  /**
   * Called by a writer whose samples reach the speaker late: [framesAheadOfSpeaker] of what it has
   * fed had not been heard at [timestampNanos]. Reads then analyse what the speaker is playing.
   */
  fun presentAt(framesAheadOfSpeaker: Long, timestampNanos: Long) {
    anchor = Anchor(writeCount - framesAheadOfSpeaker.coerceAtLeast(0L), timestampNanos)
  }

  /** The analysis of the samples now being heard; runs the FFT only when they have moved on. */
  @Synchronized
  fun read(enabled: Boolean): SpectrumFrame {
    val now = nanoTime()
    val config = configuration
    val newest = writeCount
    if (!enabled || config == null || newest == 0L) {
      val active = enabled && config != null && now - lastFeedNanos < ACTIVE_WINDOW_NANOS
      return SpectrumFrame(enabled, active, 0L, config?.sampleRate ?: 0, floorBands(), SpectrumBands.FLOOR_DB, SpectrumBands.FLOOR_DB, false)
    }
    val end = heardUpTo(config, newest, now)
    val active = now - lastFeedNanos < ACTIVE_WINDOW_NANOS || newest - end >= config.levelSamples
    val seq = end / config.stepSamples
    val previous = cached
    if (previous == null || cachedSeq != seq) {
      val analysed = analyseStable(config, seq * config.stepSamples)
      if (analysed != null) {
        cached = analysed
        cachedSeq = seq
      }
    }
    val frame = cached
    val clipped = lastClipNanos != Long.MIN_VALUE && now - lastClipNanos < CLIP_HOLD_NANOS
    if (frame == null) {
      // A sequence is observable only once its matching history has been copied.
      return SpectrumFrame(true, active, 0L, config.sampleRate, floorBands(), SpectrumBands.FLOOR_DB, SpectrumBands.FLOOR_DB, clipped)
    }
    return SpectrumFrame(true, active, frame.sequence, frame.sampleRate, frame.bands, frame.peakDb, frame.rmsDb, clipped)
  }

  /**
   * The history index the listener has heard up to. Without a speaker position that is the newest
   * sample. With one, the speaker is followed from its last report for at most [MAX_EXTRAPOLATION_NANOS],
   * so a paused track, which stops reporting, freezes the bars rather than running into audio that
   * has not been played.
   */
  private fun heardUpTo(config: Configuration, newest: Long, now: Long): Long {
    val oldestUsable = newest - (HISTORY_SIZE - config.fft.size)
    val at = anchor ?: return newest
    val elapsed = (now - at.nanos).coerceIn(0L, MAX_EXTRAPOLATION_NANOS)
    val heard = at.index + elapsed * config.sampleRate / 1_000_000_000L
    return heard.coerceIn(maxOf(0L, oldestUsable), newest)
  }

  private fun analyseStable(config: Configuration, end: Long): SpectrumFrame? {
    val size = config.fft.size
    val window = config.fft.window
    repeat(MAX_READ_RETRIES) {
      val first = publication
      if ((first and 1L) != 0L) return@repeat
      for (n in 0 until size) {
        val index = end - size + n
        re[n] = if (index < 0) 0.0f else history[(index and HISTORY_MASK).toInt()] * window[n]
        im[n] = 0.0f
      }
      var peak = 0.0f
      var sumSq = 0.0
      val from = maxOf(0L, end - config.levelSamples)
      for (index in from until end) {
        val slot = (index and HISTORY_MASK).toInt()
        if (levels[slot] > peak) peak = levels[slot]
        sumSq += history[slot] * history[slot]
      }
      if (first == publication) {
        config.fft.transform(re, im)
        val scale = config.fft.amplitudeScale
        for (k in 0..size / 2) {
          val amplitude = 2.0f * sqrt(re[k] * re[k] + im[k] * im[k]) * scale
          power[k] = amplitude * amplitude
        }
        if (peak >= CLIP_LEVEL) lastClipNanos = nanoTime()
        val rms = if (end > from) sqrt(sumSq / (end - from)) else 0.0
        return SpectrumFrame(true, true, end / config.stepSamples, config.sampleRate, config.plan.bandsDb(power), toDb(peak.toDouble()), toDb(rms), false)
      }
    }
    return null
  }

  private fun floorBands(): IntArray = IntArray(SpectrumBands.COUNT) { SpectrumBands.FLOOR_DB }

  /** Window, twiddles and bit reversal for one FFT length; shared, built once per length. */
  private class FftPlan private constructor(val size: Int) {
    val window = FloatArray(size) { (0.5 - 0.5 * cos(2.0 * PI * it / size)).toFloat() }
    val amplitudeScale = 1.0f / (size * 0.5f)
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

    fun bandsDb(power: FloatArray): IntArray {
      val out = IntArray(SpectrumBands.COUNT)
      for (i in 0 until SpectrumBands.COUNT) {
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
      return out
    }
  }

  companion object {
    const val FFT_SIZE = 4096
    /** The live stream's window: half the delay, at half the frequency resolution. */
    const val LIVE_FFT_SIZE = 2048
    /** A live stream publishes a new frame every 8 ms of audio, so a poll never waits on a step. */
    const val LIVE_STEPS_PER_SECOND = 120
    private const val MAX_FFT_SIZE = FFT_SIZE
    private val SUPPORTED_FFT_SIZES = setOf(LIVE_FFT_SIZE, FFT_SIZE)
    /** About 2.7 s at 48 kHz: the deepest track buffer measured (2.2 s to the speaker) plus a window. */
    private const val HISTORY_SIZE = 1 shl 17
    private const val HISTORY_MASK = (HISTORY_SIZE - 1).toLong()
    private const val BYTES_PER_FRAME = 4
    private const val FRAMES_PER_SECOND = 30
    private const val MAX_READ_RETRIES = 3
    private const val INV_FULL_SCALE = 1.0f / 32768.0f
    private const val CLIP_LEVEL = 32767.0f / 32768.0f
    private const val NOISE_BANDWIDTH_BINS = 1.5f
    private const val ACTIVE_WINDOW_NANOS = 400_000_000L
    private const val CLIP_HOLD_NANOS = 1_000_000_000L
    private const val MAX_EXTRAPOLATION_NANOS = 250_000_000L

    /** Linear power (a full-scale sine is 1.0) to whole dBFS, floored. */
    fun toDb(value: Double, isPower: Boolean = false): Int {
      val power = if (isPower) value else value * value
      if (!(power > 1e-12)) return SpectrumBands.FLOOR_DB
      return Math.round(10.0 * log10(power)).toInt().coerceIn(SpectrumBands.FLOOR_DB, 6)
    }
  }
}
