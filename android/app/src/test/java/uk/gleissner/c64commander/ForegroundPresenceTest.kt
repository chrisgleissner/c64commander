/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ForegroundPresenceTest {
  @After fun reset() = ForegroundPresence.reset()

  @Test
  fun anAppThatWasNeverResumedWasNotInFront() {
    assertFalse(ForegroundPresence.wasInFront(nowMs = 10_000))
  }

  @Test
  fun aResumedAppIsInFront() {
    ForegroundPresence.onResumed()
    assertTrue(ForegroundPresence.wasInFront(nowMs = 10_000))
  }

  @Test
  fun anAppPausedWithinTheRecentWindowStillCountsAsInFront() {
    ForegroundPresence.onResumed()
    ForegroundPresence.onPaused(nowMs = 10_000)
    assertTrue(ForegroundPresence.wasInFront(nowMs = 10_000 + ForegroundPresence.RECENT_MS))
  }

  @Test
  fun anAppPausedLongerAgoWasNotInFront() {
    ForegroundPresence.onResumed()
    ForegroundPresence.onPaused(nowMs = 10_000)
    assertFalse(ForegroundPresence.wasInFront(nowMs = 10_001 + ForegroundPresence.RECENT_MS))
  }
}
