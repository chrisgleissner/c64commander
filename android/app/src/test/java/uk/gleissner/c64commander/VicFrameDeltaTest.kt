/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import org.junit.Assert.assertEquals
import org.junit.Test

class VicFrameDeltaTest {
  private val bytesPerLine = 4
  private val lines = 6

  private fun frame(vararg changedLines: Int, value: Byte = 7): ByteArray {
    val frame = ByteArray(bytesPerLine * lines)
    for (line in changedLines) frame.fill(value, line * bytesPerLine, (line + 1) * bytesPerLine)
    return frame
  }

  @Test
  fun theFirstFrameIsSentWhole() {
    val delta = VicFrameDelta(bytesPerLine, bytesPerLine * lines)
    assertEquals(VicFrameDelta.Span(0, VicFrameDelta.WHOLE_FRAME), delta.next(frame(), lines))
  }

  @Test
  fun anIdenticalFrameSendsNoLines() {
    val delta = VicFrameDelta(bytesPerLine, bytesPerLine * lines)
    delta.next(frame(2), lines)
    assertEquals(VicFrameDelta.Span(0, 0), delta.next(frame(2), lines))
  }

  @Test
  fun theSpanRunsFromTheFirstToTheLastChangedLine() {
    val delta = VicFrameDelta(bytesPerLine, bytesPerLine * lines)
    delta.next(frame(), lines)
    assertEquals(VicFrameDelta.Span(1, 4), delta.next(frame(1, 4), lines))
  }

  @Test
  fun aSingleChangedByteAtTheEndOfALineCountsAsThatLine() {
    val delta = VicFrameDelta(bytesPerLine, bytesPerLine * lines)
    delta.next(frame(), lines)
    val next = frame()
    next[(3 + 1) * bytesPerLine - 1] = 1
    assertEquals(VicFrameDelta.Span(3, 1), delta.next(next, lines))
  }

  @Test
  fun eachSpanIsMeasuredAgainstTheFrameSentBeforeIt() {
    val delta = VicFrameDelta(bytesPerLine, bytesPerLine * lines)
    delta.next(frame(), lines)
    delta.next(frame(5), lines)
    assertEquals(VicFrameDelta.Span(0, 0), delta.next(frame(5), lines))
    assertEquals(VicFrameDelta.Span(5, 1), delta.next(frame(), lines))
  }

  @Test
  fun aHeightChangeSendsTheWholeFrameAgain() {
    val delta = VicFrameDelta(bytesPerLine, bytesPerLine * lines)
    delta.next(frame(), lines)
    assertEquals(VicFrameDelta.Span(0, VicFrameDelta.WHOLE_FRAME), delta.next(frame(), lines - 1))
    assertEquals(VicFrameDelta.Span(0, 0), delta.next(frame(), lines - 1))
  }

  @Test
  fun linesBeyondTheFrameHeightAreIgnored() {
    val delta = VicFrameDelta(bytesPerLine, bytesPerLine * lines)
    delta.next(frame(), lines - 1)
    assertEquals(VicFrameDelta.Span(0, 0), delta.next(frame(lines - 1), lines - 1))
  }

  @Test
  fun aSpanCoversTheBytesOfItsLines() {
    assertEquals(0 until 24, VicFrameDelta.Span(0, VicFrameDelta.WHOLE_FRAME).bytes(bytesPerLine, 24))
    assertEquals(8 until 16, VicFrameDelta.Span(2, 2).bytes(bytesPerLine, 24))
    assertEquals(true, VicFrameDelta.Span(0, 0).bytes(bytesPerLine, 24).isEmpty())
  }
}
