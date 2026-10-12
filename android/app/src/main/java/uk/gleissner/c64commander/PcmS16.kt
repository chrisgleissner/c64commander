/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

/** Little-endian signed 16-bit PCM sample access on a byte buffer. */
internal object PcmS16 {
  fun read(buf: ByteArray, at: Int): Int =
      ((buf[at].toInt() and 0xFF) or (buf[at + 1].toInt() shl 8)).toShort().toInt()

  fun write(buf: ByteArray, at: Int, value: Double) {
    val v = value.toInt().coerceIn(-32768, 32767)
    buf[at] = (v and 0xFF).toByte()
    buf[at + 1] = ((v shr 8) and 0xFF).toByte()
  }
}
