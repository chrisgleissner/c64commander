/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

/**
 * The lines of a presented VIC frame that differ from the previously presented one.
 *
 * Every presented frame used to cross the bridge whole, as 70 KB of Base64, even when the C64 was showing a still
 * screen. Only the changed span is sent now, and JS patches it into its copy of the previous frame. The first frame,
 * a frame whose height changed, and one frame in every [KEYFRAME_INTERVAL_FRAMES] are sent whole, so the two copies
 * start from the same bytes and a span JS missed is repaired within seconds.
 */
internal class VicFrameDelta(
  private val bytesPerLine: Int,
  capacityBytes: Int,
  private val keyframeInterval: Int = KEYFRAME_INTERVAL_FRAMES,
) {
  private val presented = ByteArray(capacityBytes)
  private var presentedHeight = NO_FRAME
  private var framesSinceWhole = 0

  /** First changed line and line count; [lineCount] is [WHOLE_FRAME] when the frame must be sent in full. */
  data class Span(val firstLine: Int, val lineCount: Int) {
    /** The frame bytes this span covers. */
    fun bytes(bytesPerLine: Int, frameBytes: Int): IntRange =
      if (lineCount == WHOLE_FRAME) 0 until frameBytes
      else firstLine * bytesPerLine until (firstLine + lineCount) * bytesPerLine
  }

  fun next(frame: ByteArray, height: Int): Span {
    val bytes = height * bytesPerLine
    if (height != presentedHeight || ++framesSinceWhole >= keyframeInterval) {
      System.arraycopy(frame, 0, presented, 0, bytes)
      presentedHeight = height
      framesSinceWhole = 0
      return Span(0, WHOLE_FRAME)
    }
    var first = -1
    var last = -1
    for (line in 0 until height) {
      if (!lineEquals(frame, line)) {
        if (first < 0) first = line
        last = line
      }
    }
    if (first < 0) return Span(0, 0)
    val offset = first * bytesPerLine
    System.arraycopy(frame, offset, presented, offset, (last - first + 1) * bytesPerLine)
    return Span(first, last - first + 1)
  }

  private fun lineEquals(frame: ByteArray, line: Int): Boolean {
    val start = line * bytesPerLine
    for (index in start until start + bytesPerLine) {
      if (frame[index] != presented[index]) return false
    }
    return true
  }

  companion object {
    const val WHOLE_FRAME = -1
    private const val NO_FRAME = -1

    /** About five seconds of PAL frames: a span JS could not apply is repaired by the next whole frame. */
    const val KEYFRAME_INTERVAL_FRAMES = 250
  }
}
