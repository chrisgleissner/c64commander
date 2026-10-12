/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.dsp

import kotlin.math.max

/**
 * Widens a mono-compatible signal by adding a decorrelated copy of the mid signal to the side.
 *
 * With mid = (L + R) / 2 and side = (L - R) / 2, the output is L = mid + side', R = mid - side', where
 * side' is the incoming side plus the mid passed through a chain of four all-pass filters (equal
 * energy, scrambled phase) at a gain of up to [MAX_SIDE_GAIN]. The sum L + R is untouched, so a mono
 * downmix is exactly the input, and each output channel stays within [MAX_SIDE_GAIN] of the mid
 * level. The amount is ramped, and a width of zero that has finished ramping leaves the samples alone.
 */
internal class StereoWidener(sampleRate: Int) {
  private val delays = IntArray(STAGES) { max(1, (DELAYS_MS[it] * sampleRate / 1000.0).toInt()) }
  private val lines = Array(STAGES) { FloatArray(delays[it]) }
  private val feedback = Array(STAGES) { FloatArray(delays[it]) }
  private val positions = IntArray(STAGES)

  private var target = 0.0
  private var current = 0.0

  /** [width] is 0 (off) to 1 (widest). */
  fun setTarget(width: Double) {
    target = width
  }

  val isIdle: Boolean
    get() = current == 0.0 && target == 0.0

  fun process(left: FloatArray, right: FloatArray, frames: Int, seconds: Double) {
    val maxStep = seconds / RAMP_SECONDS
    val start = current
    current = if (Math.abs(target - current) <= maxStep) target else current + Math.copySign(maxStep, target - current)
    if (start == 0.0 && current == 0.0) {
      clear()
      return
    }
    val slope = if (frames > 0) (current - start) / frames else 0.0
    for (i in 0 until frames) {
      val mid = (left[i] + right[i]) * 0.5f
      val side = (left[i] - right[i]) * 0.5f
      var x = mid
      for (stage in 0 until STAGES) x = allPass(stage, x)
      val amount = ((start + slope * (i + 1)) * MAX_SIDE_GAIN).toFloat()
      val wide = side + x * amount
      left[i] = mid + wide
      right[i] = mid - wide
    }
    if (current == 0.0 && target == 0.0) clear()
  }

  fun reset() {
    current = 0.0
    target = 0.0
    clear()
  }

  private fun allPass(stage: Int, input: Float): Float {
    val line = lines[stage]
    val fb = feedback[stage]
    val at = positions[stage]
    val output = -ALL_PASS_GAIN * input + line[at] + ALL_PASS_GAIN * fb[at]
    line[at] = input
    fb[at] = if (output < TINY && output > -TINY) 0.0f else output
    positions[stage] = if (at + 1 == line.size) 0 else at + 1
    return output
  }

  private fun clear() {
    for (stage in 0 until STAGES) {
      lines[stage].fill(0.0f)
      feedback[stage].fill(0.0f)
      positions[stage] = 0
    }
  }

  companion object {
    const val MAX_SIDE_GAIN = 0.6
    private const val STAGES = 4
    private val DELAYS_MS = doubleArrayOf(2.3, 3.1, 4.7, 6.9)
    private const val ALL_PASS_GAIN = 0.5f
    private const val RAMP_SECONDS = 0.05
    private const val TINY = 1e-20f
  }
}
