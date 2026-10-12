/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class OutputCaptureTest {
  @Test
  fun recordsNothingUntilArmed() {
    val capture = OutputCapture()
    capture.record(ByteArray(64) { 1 }, 64)
    assertEquals(0, capture.take().size)
  }

  @Test
  fun keepsOnlyTheBytesTheTrackAcceptedInOrder() {
    val capture = OutputCapture()
    capture.arm(1, 48000)
    capture.record(byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8), 4)
    capture.record(byteArrayOf(9, 10, 11, 12), 4)
    capture.record(byteArrayOf(99, 99, 99, 99), -3)
    assertArrayEquals(byteArrayOf(1, 2, 3, 4, 9, 10, 11, 12), capture.take())
    assertEquals(48000, capture.sampleRate)
  }

  @Test
  fun stopsAtTheLengthItWasArmedFor() {
    val capture = OutputCapture()
    capture.arm(1, 100)
    repeat(3) { capture.record(ByteArray(300) { 7 }, 300) }
    assertEquals(400, capture.take().size)
  }

  @Test
  fun rearmingStartsAFreshCapture() {
    val capture = OutputCapture()
    capture.arm(1, 100)
    capture.record(ByteArray(40) { 1 }, 40)
    capture.arm(1, 100)
    capture.record(ByteArray(8) { 2 }, 8)
    assertArrayEquals(ByteArray(8) { 2 }, capture.take())
  }
}
