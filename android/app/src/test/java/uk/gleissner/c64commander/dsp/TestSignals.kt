/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.dsp

import kotlin.math.PI
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

internal object TestSignals {
  fun dbToLinear(db: Double): Double = 10.0.pow(db / 20.0)

  fun linearToDb(value: Double): Double = 20.0 * log10(maxOf(value, 1e-9))

  /** Interleaved stereo S16LE of a sine whose amplitude is [amplitude] of full scale (1.0 = 32768). */
  fun sine(frames: Int, rate: Int, hz: Double, amplitude: Double, startFrame: Long = 0, rightScale: Double = 1.0): ByteArray {
    val out = ByteArray(frames * 4)
    for (i in 0 until frames) {
      val v = amplitude * 32768.0 * sin(2.0 * PI * hz * (startFrame + i) / rate)
      put(out, i, v, v * rightScale)
    }
    return out
  }

  fun put(out: ByteArray, frame: Int, left: Double, right: Double) {
    val l = Math.round(left).toInt().coerceIn(-32768, 32767)
    val r = Math.round(right).toInt().coerceIn(-32768, 32767)
    out[frame * 4] = (l and 0xFF).toByte()
    out[frame * 4 + 1] = ((l shr 8) and 0xFF).toByte()
    out[frame * 4 + 2] = (r and 0xFF).toByte()
    out[frame * 4 + 3] = ((r shr 8) and 0xFF).toByte()
  }

  fun left(data: ByteArray, frame: Int): Int = ((data[frame * 4].toInt() and 0xFF) or (data[frame * 4 + 1].toInt() shl 8)).toShort().toInt()

  fun right(data: ByteArray, frame: Int): Int = ((data[frame * 4 + 2].toInt() and 0xFF) or (data[frame * 4 + 3].toInt() shl 8)).toShort().toInt()

  fun concat(vararg parts: ByteArray): ByteArray {
    val out = ByteArray(parts.sumOf { it.size })
    var at = 0
    for (part in parts) {
      System.arraycopy(part, 0, out, at, part.size)
      at += part.size
    }
    return out
  }

  /** RMS of the left channel over [from, to) frames, as a fraction of full scale. */
  fun rms(data: ByteArray, from: Int, to: Int): Double {
    var sum = 0.0
    for (i in from until to) {
      val v = left(data, i) / 32768.0
      sum += v * v
    }
    return sqrt(sum / (to - from))
  }

  fun peak(data: ByteArray, from: Int, to: Int): Int {
    var top = 0
    for (i in from until to) top = maxOf(top, Math.abs(left(data, i)), Math.abs(right(data, i)))
    return top
  }

  fun toFloats(data: ByteArray, frames: Int): Pair<FloatArray, FloatArray> =
      Pair(FloatArray(frames) { left(data, it) / 32768.0f }, FloatArray(frames) { right(data, it) / 32768.0f })

  fun rmsOf(samples: FloatArray, from: Int, to: Int): Double {
    var sum = 0.0
    for (i in from until to) sum += samples[i].toDouble() * samples[i]
    return sqrt(sum / (to - from))
  }
}
