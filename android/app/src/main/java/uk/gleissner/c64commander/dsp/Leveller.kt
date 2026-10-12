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
import kotlin.math.exp
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.sin

/**
 * Slow loudness levelling with look-ahead.
 *
 * The pipeline's ring already holds audio that has not been played yet, so the loudness of the
 * passage about to arrive is known before it is heard. [analyse] measures that audio in 20 ms blocks
 * (a mild high-pass first, so rumble does not count), each block's short-term loudness being the mean
 * power of the last 400 ms. [nextGain] then takes the lowest gain any block in the next second asks
 * for, so a loud passage is met with the gain already down. Gain rises back slowly (3 s time
 * constant) and falls quickly, a block's peak also caps the gain so that boosting cannot clip, and
 * blocks below the gate ask for nothing, so silence never pumps the gain up.
 */
internal class Leveller(private val sampleRate: Int) {
  private val blockFrames = maxOf(1, sampleRate / BLOCKS_PER_SECOND)
  private val meanSquare = FloatArray(HISTORY_BLOCKS)
  private val peak = FloatArray(HISTORY_BLOCKS)
  private val loudnessRequestDb = FloatArray(HISTORY_BLOCKS)
  private val peakCapDb = FloatArray(HISTORY_BLOCKS)

  private var baseFrame = 0L
  private var nextBlock = 0L
  private var firstValidBlock = 0L
  private var started = false

  private var gainDb = 0.0
  private var hpX1 = 0.0
  private var hpX2 = 0.0
  private var hpY1 = 0.0
  private var hpY2 = 0.0
  private val hpB0: Double
  private val hpB1: Double
  private val hpB2: Double
  private val hpA1: Double
  private val hpA2: Double

  init {
    val omega = 2.0 * PI * HIGH_PASS_HZ / sampleRate
    val alpha = sin(omega) / (2.0 * 0.7071)
    val a0 = 1.0 + alpha
    hpB0 = (1.0 + cos(omega)) / 2.0 / a0
    hpB1 = -(1.0 + cos(omega)) / a0
    hpB2 = hpB0
    hpA1 = -2.0 * cos(omega) / a0
    hpA2 = (1.0 - alpha) / a0
  }

  /** Forget everything measured: a new tune is levelled from its first block, not from the last tune's gain. */
  fun reset(playFrame: Long) {
    baseFrame = playFrame
    nextBlock = 0
    firstValidBlock = 0
    started = false
    hpX1 = 0.0
    hpX2 = 0.0
    hpY1 = 0.0
    hpY2 = 0.0
  }

  /** Measure the not-yet-played blocks the look-ahead needs. [ring] holds interleaved stereo S16LE. */
  fun analyse(ring: ByteArray, ringFrames: Int, playFrame: Long, writeFrame: Long) {
    val playBlock = blockOf(playFrame)
    if (nextBlock < playBlock) {
      nextBlock = playBlock
      firstValidBlock = playBlock
    }
    val limit = playBlock + LOOKAHEAD_BLOCKS
    while (nextBlock <= limit && baseFrame + (nextBlock + 1) * blockFrames <= writeFrame) {
      measureBlock(ring, ringFrames, nextBlock)
      nextBlock++
    }
  }

  private fun blockOf(frame: Long): Long = Math.floorDiv(frame - baseFrame, blockFrames.toLong())

  private fun measureBlock(ring: ByteArray, ringFrames: Int, block: Long) {
    val start = baseFrame + block * blockFrames
    var sum = 0.0
    var top = 0.0f
    var index = Math.floorMod(start, ringFrames.toLong()).toInt()
    for (i in 0 until blockFrames) {
      val at = index * BYTES_PER_FRAME
      val l = ((ring[at].toInt() and 0xFF) or (ring[at + 1].toInt() shl 8)).toShort() * INV_FULL_SCALE
      val r = ((ring[at + 2].toInt() and 0xFF) or (ring[at + 3].toInt() shl 8)).toShort() * INV_FULL_SCALE
      val al = if (l < 0) -l else l
      val ar = if (r < 0) -r else r
      val a = if (al > ar) al else ar
      if (a > top) top = a
      val x = (l + r) * 0.5
      val y = hpB0 * x + hpB1 * hpX1 + hpB2 * hpX2 - hpA1 * hpY1 - hpA2 * hpY2
      hpX2 = hpX1
      hpX1 = x
      hpY2 = hpY1
      hpY1 = y
      if (hpY1 < TINY && hpY1 > -TINY) hpY1 = 0.0
      if (hpY2 < TINY && hpY2 > -TINY) hpY2 = 0.0
      sum += y * y
      if (++index == ringFrames) index = 0
    }
    val slot = slotOf(block)
    meanSquare[slot] = (sum / blockFrames).toFloat()
    peak[slot] = top
    loudnessRequestDb[slot] = if (sum / blockFrames < GATE_POWER) NO_REQUEST else loudnessRequestFor(block)
    peakCapDb[slot] = if (top > 1e-6f) (20.0 * log10(PEAK_CEILING / top)).toFloat() else NO_REQUEST
  }

  private fun loudnessRequestFor(block: Long): Float {
    val from = maxOf(firstValidBlock, block - WINDOW_BLOCKS + 1)
    var total = 0.0
    for (b in from..block) total += meanSquare[slotOf(b)]
    val mean = total / (block - from + 1)
    val loudness = 10.0 * log10(maxOf(mean, 1e-12))
    if (loudness < GATE_DB) return NO_REQUEST
    return (TARGET_DB - loudness).coerceIn(-MAX_CUT_DB, MAX_BOOST_DB).toFloat()
  }

  private fun slotOf(block: Long): Int = Math.floorMod(block, HISTORY_BLOCKS.toLong()).toInt()

  /** Linear gain to aim at for the chunk starting at [playFrame], advancing the smoothing by [seconds]. */
  fun nextGain(playFrame: Long, seconds: Double): Double {
    val playBlock = blockOf(playFrame)
    val last = minOf(playBlock + LOOKAHEAD_BLOCKS, nextBlock - 1)
    var wanted = NO_REQUEST
    var cap = NO_REQUEST
    var block = maxOf(playBlock, firstValidBlock)
    while (block <= last) {
      val slot = slotOf(block)
      if (loudnessRequestDb[slot] < wanted) wanted = loudnessRequestDb[slot]
      if (block <= playBlock + PEAK_LOOKAHEAD_BLOCKS && peakCapDb[slot] < cap) cap = peakCapDb[slot]
      block++
    }
    if (wanted != NO_REQUEST) {
      wanted = minOf(wanted, cap)
      if (!started) {
        gainDb = wanted.toDouble()
        started = true
      } else if (wanted < gainDb) {
        gainDb += (wanted - gainDb) * (1.0 - exp(-seconds / ATTACK_SECONDS))
      } else {
        gainDb += (wanted - gainDb) * (1.0 - exp(-seconds / RELEASE_SECONDS))
      }
    }
    return 10.0.pow(gainDb / 20.0)
  }

  companion object {
    const val TARGET_DB = -20.0
    const val GATE_DB = -60.0
    private val GATE_POWER = 10.0.pow(GATE_DB / 10.0)
    const val MAX_BOOST_DB = 12.0
    const val MAX_CUT_DB = 24.0
    const val PEAK_CEILING = 0.97
    const val RELEASE_SECONDS = 3.0
    const val ATTACK_SECONDS = 0.06
    private const val NO_REQUEST = Float.MAX_VALUE
    private const val BLOCKS_PER_SECOND = 50
    private const val WINDOW_BLOCKS = 20
    private const val LOOKAHEAD_BLOCKS = 50L
    private const val PEAK_LOOKAHEAD_BLOCKS = 10L
    private const val HISTORY_BLOCKS = 128
    private const val HIGH_PASS_HZ = 100.0
    private const val BYTES_PER_FRAME = 4
    private const val INV_FULL_SCALE = 1.0f / 32768.0f
    private const val TINY = 1e-20
  }
}
