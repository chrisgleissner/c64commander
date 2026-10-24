/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.dsp

import kotlin.math.abs

/** What the listener asked for. All off is the default and means the samples are not touched. */
internal class FxParams(
    val levelling: Boolean,
    val bandsDb: DoubleArray,
    val stereoWidth: Double,
    val reverb: Double,
) {
  val isNeutral: Boolean
    get() = !levelling && bandsDb.all { it == 0.0 } && stereoWidth == 0.0 && reverb == 0.0

  companion object {
    const val EQ_RANGE_DB = 12.0

    val OFF = FxParams(false, DoubleArray(Equalizer.BANDS), 0.0, 0.0)

    /** The old three-band call: bass is 62 and 125 Hz, mid is 500 Hz to 2 kHz, treble is 4 to 16 kHz. */
    fun legacyBands(bassDb: Double, midDb: Double, trebleDb: Double): DoubleArray =
        doubleArrayOf(0.0, bassDb, bassDb, 0.0, midDb, midDb, midDb, trebleDb, trebleDb, trebleDb)

    fun clamped(levelling: Boolean, bandsDb: DoubleArray, stereoWidth: Double, reverb: Double): FxParams =
        FxParams(
            levelling,
            DoubleArray(Equalizer.BANDS) { clamp(bandsDb.getOrElse(it) { 0.0 }, -EQ_RANGE_DB, EQ_RANGE_DB) },
            clamp(stereoWidth, 0.0, 100.0),
            clamp(reverb, 0.0, 100.0),
        )

    private fun clamp(value: Double, low: Double, high: Double): Double =
        if (value.isNaN()) 0.0 else value.coerceIn(low, high)
  }
}

/**
 * The settings and the spectrum tap shared by every pipeline in the process.
 *
 * Pipelines read [params] once per chunk and the spectrum flag once per write, both plain volatile
 * reads. Pipelines opened after a change start with the current values.
 */
internal class AudioFxHub(nanoTime: () -> Long = System::nanoTime) {
  @Volatile var params: FxParams = FxParams.OFF
    private set

  @Volatile var spectrumEnabled: Boolean = false

  val analyzer = SpectrumAnalyzer(nanoTime)

  fun setParams(levelling: Boolean, bandsDb: DoubleArray, stereoWidth: Double, reverb: Double) {
    params = FxParams.clamped(levelling, bandsDb, stereoWidth, reverb)
  }

  fun setParams(
      levelling: Boolean,
      bassDb: Double,
      midDb: Double,
      trebleDb: Double,
      stereoWidth: Double,
      reverb: Double,
  ) = setParams(levelling, FxParams.legacyBands(bassDb, midDb, trebleDb), stereoWidth, reverb)

  fun readSpectrum(targetNanos: Long = 0L): SpectrumFrame = analyzer.read(spectrumEnabled, targetNanos)

  companion object {
    val shared = AudioFxHub()
  }
}

/**
 * The processing chain for one pipeline: leveller, equalizer, stereo widener, reverb, in that order.
 *
 * It works on a chunk of interleaved stereo S16LE already converted to the output rate. While
 * [prepare] reports false the pipeline does not call [process] at all, so with every effect off the
 * samples are bit-identical to what the ring held. Turning an effect off ramps it out first and
 * only then lets the chunk path go back to untouched, so neither direction clicks.
 */
internal class AudioFx(sourceRate: Int, private val outputRate: Int, private val hub: AudioFxHub) {
  private val leveller = Leveller(sourceRate)
  private val equalizer = Equalizer(outputRate)
  private val widener = StereoWidener(outputRate)
  private val reverb = Reverb(outputRate)

  private var left = FloatArray(INITIAL_FRAMES)
  private var right = FloatArray(INITIAL_FRAMES)

  private var levellingOn = false
  private var levellerMix = 0.0
  private var levellerGain = 1.0
  private var limiterGain = 1.0

  /** Reads the settings and reports whether this chunk has to go through [process]. */
  fun prepare(playFrame: Long): Boolean {
    val params = hub.params
    if (params.levelling && !levellingOn) leveller.reset(playFrame)
    levellingOn = params.levelling
    equalizer.setTargets(params.bandsDb)
    widener.setTarget(params.stereoWidth / 100.0)
    reverb.setTarget(params.reverb / 100.0)
    return levellingOn || levellerMix > 0.0 || !equalizer.isIdle || !widener.isIdle || !reverb.isIdle
  }

  /** A flush threw the queued audio away: the next audio is a new passage and is levelled afresh. */
  fun onFlush(playFrame: Long) {
    leveller.reset(playFrame)
    equalizer.reset()
    widener.reset()
    reverb.reset()
    levellerMix = 0.0
    levellerGain = 1.0
    limiterGain = 1.0
  }

  val wantsLookahead: Boolean
    get() = levellingOn || levellerMix > 0.0

  fun analyseAhead(ring: ByteArray, ringFrames: Int, playFrame: Long, writeFrame: Long) {
    if (wantsLookahead) leveller.analyse(ring, ringFrames, playFrame, writeFrame)
  }

  /** Allocate once while the pipeline is opened; the audio writer never grows these arrays. */
  fun ensureCapacity(maxFrames: Int) {
    if (maxFrames > left.size) {
      left = FloatArray(maxFrames)
      right = FloatArray(maxFrames)
    }
  }

  fun process(data: ByteArray, frames: Int, playFrame: Long, masterStart: Double = 1.0, masterEnd: Double = 1.0) {
    check(frames <= left.size) { "AudioFx capacity ${left.size} is smaller than chunk $frames" }
    val seconds = frames.toDouble() / outputRate
    unpack(data, frames)
    if (wantsLookahead) level(frames, playFrame, seconds)
    if (!equalizer.isIdle) equalizer.process(left, right, frames, seconds)
    if (!widener.isIdle) widener.process(left, right, frames, seconds)
    if (!reverb.isIdle) reverb.process(left, right, frames, seconds)
    pack(data, frames, masterStart, masterEnd)
  }

  private fun level(frames: Int, playFrame: Long, seconds: Double) {
    val step = seconds / RAMP_SECONDS
    val limiterMixStart = levellerMix
    levellerMix = if (levellingOn) minOf(1.0, levellerMix + step) else maxOf(0.0, levellerMix - step)
    val wanted = leveller.nextGain(playFrame, seconds)
    val effective = 1.0 + (wanted - 1.0) * levellerMix
    val start = levellerGain
    val slope = (effective - start) / frames
    var limit = limiterGain
    val release = 1.0 - Math.exp(-1.0 / (LIMITER_RELEASE_SECONDS * outputRate))
    for (i in 0 until frames) {
      val gain = start + slope * (i + 1)
      val l = left[i] * gain
      val r = right[i] * gain
      val peak = maxOf(abs(l), abs(r)) * limit
      if (peak > Leveller.PEAK_CEILING) {
        limit = Leveller.PEAK_CEILING / (peak / limit)
      } else if (limit < 1.0) {
        limit += (1.0 - limit) * release
        if (1.0 - limit < LIMITER_SETTLE_EPSILON) limit = 1.0
      }
      // The limiter is part of levelling, not a permanent post-effect.  Its detector may still be
      // recovering when the listener turns levelling off; fade that contribution to unity with the
      // leveller mix so the next bit-exact bypass chunk cannot jump.
      val limiterMix = limiterMixStart + (levellerMix - limiterMixStart) * (i + 1) / frames
      val limiterContribution = 1.0 + (limit - 1.0) * limiterMix
      left[i] = (l * limiterContribution).toFloat()
      right[i] = (r * limiterContribution).toFloat()
    }
    limiterGain = limit
    levellerGain = effective
  }

  private fun unpack(data: ByteArray, frames: Int) {
    var at = 0
    for (i in 0 until frames) {
      left[i] = ((data[at].toInt() and 0xFF) or (data[at + 1].toInt() shl 8)).toShort() * INV_FULL_SCALE
      right[i] = ((data[at + 2].toInt() and 0xFF) or (data[at + 3].toInt() shl 8)).toShort() * INV_FULL_SCALE
      at += BYTES_PER_FRAME
    }
  }

  private fun pack(data: ByteArray, frames: Int, masterStart: Double, masterEnd: Double) {
    var at = 0
    for (i in 0 until frames) {
      val gain = masterStart + (masterEnd - masterStart) * (i + 1) / frames
      val l = Math.round(left[i] * gain * FULL_SCALE).coerceIn(-32768, 32767)
      val r = Math.round(right[i] * gain * FULL_SCALE).coerceIn(-32768, 32767)
      data[at] = (l and 0xFF).toByte()
      data[at + 1] = ((l shr 8) and 0xFF).toByte()
      data[at + 2] = (r and 0xFF).toByte()
      data[at + 3] = ((r shr 8) and 0xFF).toByte()
      at += BYTES_PER_FRAME
    }
  }

  private companion object {
    const val INITIAL_FRAMES = 2048
    const val BYTES_PER_FRAME = 4
    const val FULL_SCALE = 32768.0f
    const val INV_FULL_SCALE = 1.0f / 32768.0f
    const val RAMP_SECONDS = 0.05
    const val LIMITER_RELEASE_SECONDS = 0.1
    const val LIMITER_SETTLE_EPSILON = 1e-6
  }
}
