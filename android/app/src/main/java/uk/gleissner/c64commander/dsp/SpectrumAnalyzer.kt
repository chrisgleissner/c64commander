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
 * Real-time spectrum of the final output samples.
 *
 * The writer thread calls [feed], which only downmixes into a small ring and keeps level counters, so
 * its cost is a few operations per sample. The FFT runs on whichever thread calls [read], at most once
 * per analysis frame (about 30 a second), and never on the audio thread.
 *
 * Band value: bins of a 4096 point Hann-windowed FFT are converted to amplitude (so a full-scale sine
 * peaks at 1.0), squared, and power-summed over the bins whose centre lies in the band, divided by the
 * window's noise bandwidth (1.5 bins) so that a sine reads its own level wherever it falls between
 * bins. A band narrower than one bin takes the power interpolated between the two bins around its
 * centre. Values are rounded to whole dBFS and floored at [SpectrumBands.FLOOR_DB].
 */
internal class SpectrumAnalyzer(private val nanoTime: () -> Long = System::nanoTime) {
  private val history = FloatArray(FFT_SIZE)

  private class Configuration(val sampleRate: Int, val frameSamples: Int, val plan: BandPlan)
  private class Analysis(
      val sampleRate: Int,
      val sequence: Long,
      val peak: Float,
      val rms: Float,
      val plan: BandPlan,
  )
  private class Metadata(
      val sampleRate: Int,
      val sequence: Long,
      val peak: Float,
      val rms: Float,
  )

  /** Installed while opening a pipeline, never lazily by the real-time writer. */
  @Volatile private var configuration: Configuration? = null
  /** A seqlock: even values describe a stable history and its accompanying metadata. */
  @Volatile private var publication = 0L
  @Volatile private var writeCount = 0L
  @Volatile private var rate = 0
  @Volatile private var frameSeq = 0L
  @Volatile private var framePeak = 0.0f
  @Volatile private var frameRms = 0.0f
  @Volatile private var lastFeedNanos = Long.MIN_VALUE
  @Volatile private var lastClipNanos = Long.MIN_VALUE

  private var accPeak = 0.0f
  private var accPower = 0.0
  private var accSamples = 0
  private val re = FloatArray(FFT_SIZE)
  private val im = FloatArray(FFT_SIZE)
  private val power = FloatArray(FFT_SIZE / 2 + 1)
  private var cached: SpectrumFrame? = null
  private var cachedSeq = -1L

  /**
   * Prepare analysis for a pipeline's output rate. This allocates the band plan on the opening
   * thread, before its writer is started. A rate switch deliberately starts a fresh sequence.
   */
  fun prepare(sampleRate: Int) {
    require(sampleRate > 0) { "sampleRate must be positive" }
    val next = Configuration(sampleRate, maxOf(1, sampleRate / FRAMES_PER_SECOND), BandPlan(sampleRate))
    publication++
    history.fill(0.0f)
    writeCount = 0
    accPeak = 0.0f
    accPower = 0.0
    accSamples = 0
    frameSeq = 0
    framePeak = 0.0f
    frameRms = 0.0f
    lastFeedNanos = Long.MIN_VALUE
    lastClipNanos = Long.MIN_VALUE
    cached = null
    cachedSeq = -1
    rate = sampleRate
    configuration = next
    publication++
  }

  /** Called by the writer with interleaved stereo S16LE frames of the final output. */
  fun feed(data: ByteArray, frames: Int, sampleRate: Int) {
    if (frames <= 0) return
    val config = configuration
    // A pipeline must prepare its rate before it starts. Dropping this diagnostic frame is safer
    // than allocating a BandPlan (and six arrays) on the audio writer.
    if (config == null || config.sampleRate != sampleRate) return
    publication++
    var at = 0
    var count = writeCount
    var peak = accPeak
    var sumSq = accPower
    var clippedNow = false
    for (i in 0 until frames) {
      val l = ((data[at].toInt() and 0xFF) or (data[at + 1].toInt() shl 8)).toShort() * INV_FULL_SCALE
      val r = ((data[at + 2].toInt() and 0xFF) or (data[at + 3].toInt() shl 8)).toShort() * INV_FULL_SCALE
      at += BYTES_PER_FRAME
      history[(count and MASK).toInt()] = (l + r) * 0.5f
      count++
      val al = if (l < 0) -l else l
      val ar = if (r < 0) -r else r
      val a = if (al > ar) al else ar
      if (a > peak) peak = a
      if (a >= CLIP_LEVEL) clippedNow = true
      sumSq += (l * l + r * r) * 0.5
    }
    accPeak = peak
    accPower = sumSq
    accSamples += frames
    writeCount = count
    val now = nanoTime()
    lastFeedNanos = now
    if (clippedNow) lastClipNanos = now
    if (accSamples >= config.frameSamples) publishFrame()
    publication++
  }

  private fun publishFrame() {
    framePeak = accPeak
    frameRms = sqrt(accPower / accSamples).toFloat()
    accPeak = 0.0f
    accPower = 0.0
    accSamples = 0
    frameSeq += 1
  }

  /** The newest analysis; runs the FFT only if the writer has finished a frame since the last call. */
  fun read(enabled: Boolean): SpectrumFrame {
    val now = nanoTime()
    val metadata = stableMetadata()
    // A busy writer must not turn a bridge call into an unbounded spin. A previously completed
    // frame remains internally coherent and is preferable to copying a live ring.
    if (metadata == null) {
      val previous = cached
      if (enabled && previous != null) {
        val active = now - lastFeedNanos < ACTIVE_WINDOW_NANOS
        val clipped = lastClipNanos != Long.MIN_VALUE && now - lastClipNanos < CLIP_HOLD_NANOS
        return SpectrumFrame(true, active, previous.sequence, previous.sampleRate, previous.bands, previous.peakDb, previous.rmsDb, clipped)
      }
      // `prepare` has already established the rate even when the writer owns the
      // publication seqlock.  Keep the bridge contract coherent during that short
      // interval instead of reporting an impossible zero-rate pipeline.
      return SpectrumFrame(enabled, false, 0L, configuration?.sampleRate ?: 0, floorBands(), SpectrumBands.FLOOR_DB, SpectrumBands.FLOOR_DB, false)
    }
    val sampleRate = metadata.sampleRate
    val seq = metadata.sequence
    val active = enabled && sampleRate > 0 && now - lastFeedNanos < ACTIVE_WINDOW_NANOS
    val clipped = enabled && lastClipNanos != Long.MIN_VALUE && now - lastClipNanos < CLIP_HOLD_NANOS
    if (!enabled || sampleRate == 0 || seq == 0L) {
      return SpectrumFrame(enabled, active, seq, sampleRate, floorBands(), SpectrumBands.FLOOR_DB, SpectrumBands.FLOOR_DB, clipped)
    }
    val previous = cached
    if (previous != null && cachedSeq == seq) {
      return SpectrumFrame(true, active, seq, sampleRate, previous.bands, previous.peakDb, previous.rmsDb, clipped)
    }
    val analysis = analyseStable()
        ?: return if (previous != null) {
          // Do not replace a completed frame with an empty newer sequence merely
          // because the writer advanced during our bounded copy attempts.
          SpectrumFrame(true, active, previous.sequence, previous.sampleRate, previous.bands, previous.peakDb, previous.rmsDb, clipped)
        } else {
          // A sequence is observable only once its matching history has been
          // copied.  Advertising a newer number with floor data would let a
          // later retry appear to regress to the last analysed snapshot.
          SpectrumFrame(enabled, active, 0L, sampleRate, floorBands(), SpectrumBands.FLOOR_DB, SpectrumBands.FLOOR_DB, clipped)
        }
    val bands = analysis.plan.bandsDb(power)
    val frame = SpectrumFrame(true, active, analysis.sequence, analysis.sampleRate, bands, toDb(analysis.peak.toDouble()), toDb(analysis.rms.toDouble()), clipped)
    cached = frame
    // The optimistic metadata read may have become stale while the stable copy was
    // made.  The cache is always keyed to the snapshot that was actually analysed.
    cachedSeq = analysis.sequence
    return frame
  }

  private fun stableMetadata(): Metadata? {
    repeat(MAX_READ_RETRIES) {
      val first = publication
      if ((first and 1L) != 0L) return@repeat
      val sampleRate = rate
      val seq = frameSeq
      val peak = framePeak
      val rms = frameRms
      if (first == publication && (first and 1L) == 0L) return Metadata(sampleRate, seq, peak, rms)
    }
    return null
  }

  private fun analyseStable(): Analysis? {
    repeat(MAX_READ_RETRIES) {
      val first = publication
      if ((first and 1L) != 0L) return@repeat
      val config = configuration ?: return null
      val sampleRate = rate
      val seq = frameSeq
      val peak = framePeak
      val rms = frameRms
      val end = writeCount
      val start = end - FFT_SIZE
      for (n in 0 until FFT_SIZE) {
        val index = start + n
        re[n] = if (index < 0) 0.0f else history[(index and MASK).toInt()] * WINDOW[n]
        im[n] = 0.0f
      }
      val last = publication
      if (first == last && (last and 1L) == 0L) {
        fft(re, im)
        for (k in 0..FFT_SIZE / 2) {
          val amplitude = 2.0f * sqrt(re[k] * re[k] + im[k] * im[k]) * AMPLITUDE_SCALE
          power[k] = amplitude * amplitude
        }
        return Analysis(sampleRate, seq, peak, rms, config.plan)
      }
    }
    return null
  }

  private fun floorBands(): IntArray = IntArray(SpectrumBands.COUNT) { SpectrumBands.FLOOR_DB }

  private class BandPlan(sampleRate: Int) {
    private val first = IntArray(SpectrumBands.COUNT)
    private val last = IntArray(SpectrumBands.COUNT)
    private val interpolated = BooleanArray(SpectrumBands.COUNT)
    private val aboveNyquist = BooleanArray(SpectrumBands.COUNT)
    private val lowBin = IntArray(SpectrumBands.COUNT)
    private val highWeight = FloatArray(SpectrumBands.COUNT)

    init {
      val binHz = sampleRate.toDouble() / FFT_SIZE
      val nyquist = sampleRate / 2.0
      for (i in 0 until SpectrumBands.COUNT) {
        val low = SpectrumBands.edge(i)
        val high = SpectrumBands.edge(i + 1)
        aboveNyquist[i] = low >= nyquist
        interpolated[i] = high - low < binHz
        first[i] = Math.ceil(low / binHz).toInt()
        last[i] = minOf(FFT_SIZE / 2, Math.ceil(high / binHz).toInt() - 1)
        val centre = Math.sqrt(low * high) / binHz
        lowBin[i] = minOf(FFT_SIZE / 2 - 1, centre.toInt())
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
    private const val MASK = (FFT_SIZE - 1).toLong()
    private const val BYTES_PER_FRAME = 4
    private const val FRAMES_PER_SECOND = 30
    private const val MAX_READ_RETRIES = 3
    private const val INV_FULL_SCALE = 1.0f / 32768.0f
    private const val CLIP_LEVEL = 32767.0f / 32768.0f
    private const val NOISE_BANDWIDTH_BINS = 1.5f
    private const val AMPLITUDE_SCALE = 1.0f / (FFT_SIZE * 0.5f)
    private const val ACTIVE_WINDOW_NANOS = 400_000_000L
    private const val CLIP_HOLD_NANOS = 1_000_000_000L

    private val WINDOW =
        FloatArray(FFT_SIZE) { (0.5 - 0.5 * cos(2.0 * PI * it / FFT_SIZE)).toFloat() }
    private val COS_TABLE = FloatArray(FFT_SIZE / 2) { cos(2.0 * PI * it / FFT_SIZE).toFloat() }
    private val SIN_TABLE = FloatArray(FFT_SIZE / 2) { (-sin(2.0 * PI * it / FFT_SIZE)).toFloat() }
    private val BIT_REVERSE =
        IntArray(FFT_SIZE) { Integer.reverse(it) ushr (32 - Integer.numberOfTrailingZeros(FFT_SIZE)) }

    /** Linear power (a full-scale sine is 1.0) to whole dBFS, floored. */
    fun toDb(value: Double, isPower: Boolean = false): Int {
      val power = if (isPower) value else value * value
      if (!(power > 1e-12)) return SpectrumBands.FLOOR_DB
      return Math.round(10.0 * log10(power)).toInt().coerceIn(SpectrumBands.FLOOR_DB, 6)
    }

    private fun fft(re: FloatArray, im: FloatArray) {
      for (i in 0 until FFT_SIZE) {
        val j = BIT_REVERSE[i]
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
      while (half < FFT_SIZE) {
        val step = FFT_SIZE / (half * 2)
        var block = 0
        while (block < FFT_SIZE) {
          for (k in 0 until half) {
            val wr = COS_TABLE[k * step]
            val wi = SIN_TABLE[k * step]
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
  }
}
