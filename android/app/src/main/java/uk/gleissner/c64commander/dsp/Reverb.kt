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
 * A small stereo room reverb: four damped feedback combs feeding two all-pass diffusers per channel.
 *
 * Memory is fixed at construction (about 70 ms of delay per channel). The feedback gain is below 0.9
 * and the comb damping filters absorb treble first, so the tail always decays; values that fall below
 * 1e-20 are set to zero so they cannot become denormals, and a chunk that produces a non-finite
 * value clears the whole network. The amount is ramped, and a finished ramp at zero clears the
 * network and leaves the samples alone.
 */
internal class Reverb(sampleRate: Int) {
  private class Comb(size: Int) {
    val buffer = FloatArray(size)
    var position = 0
    var damped = 0.0f
  }

  private class DiffuserStage(size: Int) {
    val buffer = FloatArray(size)
    var position = 0
  }

  private val combsLeft = Array(COMB_MS.size) { Comb(frames(sampleRate, COMB_MS[it])) }
  private val combsRight = Array(COMB_MS.size) { Comb(frames(sampleRate, COMB_MS[it] + SPREAD_MS)) }
  private val diffusersLeft = Array(DIFFUSER_MS.size) { DiffuserStage(frames(sampleRate, DIFFUSER_MS[it])) }
  private val diffusersRight = Array(DIFFUSER_MS.size) { DiffuserStage(frames(sampleRate, DIFFUSER_MS[it] + SPREAD_MS)) }

  private var target = 0.0
  private var current = 0.0

  /** [amount] is 0 (off) to 1 (most). */
  fun setTarget(amount: Double) {
    target = amount
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
    var finite = true
    for (i in 0 until frames) {
      val input = (left[i] + right[i]) * 0.5f
      var wetLeft = 0.0f
      var wetRight = 0.0f
      for (c in combsLeft.indices) {
        wetLeft += comb(combsLeft[c], input)
        wetRight += comb(combsRight[c], input)
      }
      wetLeft *= COMB_NORMALISE
      wetRight *= COMB_NORMALISE
      for (d in diffusersLeft.indices) {
        wetLeft = diffuse(diffusersLeft[d], wetLeft)
        wetRight = diffuse(diffusersRight[d], wetRight)
      }
      val amount = (start + slope * (i + 1)).toFloat()
      val mixedLeft = left[i] * (1.0f - DRY_REDUCTION * amount) + wetLeft * WET_GAIN * amount
      val mixedRight = right[i] * (1.0f - DRY_REDUCTION * amount) + wetRight * WET_GAIN * amount
      left[i] = if (mixedLeft - mixedLeft == 0.0f) mixedLeft else 0.0f
      right[i] = if (mixedRight - mixedRight == 0.0f) mixedRight else 0.0f
      if (mixedLeft - mixedLeft != 0.0f || mixedRight - mixedRight != 0.0f) finite = false
    }
    if (!finite || (current == 0.0 && target == 0.0)) clear()
  }

  fun reset() {
    current = 0.0
    target = 0.0
    clear()
  }

  private fun comb(comb: Comb, input: Float): Float {
    val out = comb.buffer[comb.position]
    var damped = out * (1.0f - DAMPING) + comb.damped * DAMPING
    if (damped < TINY && damped > -TINY) damped = 0.0f
    comb.damped = damped
    val stored = input + damped * FEEDBACK
    comb.buffer[comb.position] = if (stored < TINY && stored > -TINY) 0.0f else stored
    comb.position = if (comb.position + 1 == comb.buffer.size) 0 else comb.position + 1
    return out
  }

  private fun diffuse(stage: DiffuserStage, input: Float): Float {
    val delayed = stage.buffer[stage.position]
    val stored = input + delayed * DIFFUSER_GAIN
    stage.buffer[stage.position] = if (stored < TINY && stored > -TINY) 0.0f else stored
    stage.position = if (stage.position + 1 == stage.buffer.size) 0 else stage.position + 1
    return delayed - stored * DIFFUSER_GAIN
  }

  private fun clear() {
    for (comb in combsLeft) clearComb(comb)
    for (comb in combsRight) clearComb(comb)
    for (stage in diffusersLeft) clearStage(stage)
    for (stage in diffusersRight) clearStage(stage)
  }

  private fun clearComb(comb: Comb) {
    comb.buffer.fill(0.0f)
    comb.position = 0
    comb.damped = 0.0f
  }

  private fun clearStage(stage: DiffuserStage) {
    stage.buffer.fill(0.0f)
    stage.position = 0
  }

  companion object {
    private val COMB_MS = doubleArrayOf(25.3, 26.9, 28.9, 30.7)
    private val DIFFUSER_MS = doubleArrayOf(12.6, 10.0)
    private const val SPREAD_MS = 0.52
    private const val FEEDBACK = 0.86f
    private const val DAMPING = 0.4f
    private const val DIFFUSER_GAIN = 0.5f
    private const val COMB_NORMALISE = 0.25f
    private const val WET_GAIN = 0.55f
    private const val DRY_REDUCTION = 0.25f
    private const val RAMP_SECONDS = 0.05
    private const val TINY = 1e-20f

    private fun frames(sampleRate: Int, ms: Double): Int = max(2, (ms * sampleRate / 1000.0).toInt())
  }
}
