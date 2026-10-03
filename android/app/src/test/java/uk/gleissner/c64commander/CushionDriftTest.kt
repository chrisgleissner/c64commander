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
import uk.gleissner.c64commander.CushionDrift.CEILING_UNKNOWN
import uk.gleissner.c64commander.CushionDrift.MAX_DRIFT
import uk.gleissner.c64commander.CushionDrift.REBUILD_DRIFT
import uk.gleissner.c64commander.CushionDrift.STARTUP_DRAIN_DRIFT

/** The drift policy without a clock: what [AudioPipelineTest] can only sample against wall time. */
class CushionDriftTest {
  private val floor = 1_200L
  private val recovery = 5_760L
  private val margin = 960L

  @Test
  fun aThinCushionRebuildsAtTheRecoveryRate() {
    assertEquals(REBUILD_DRIFT, CushionDrift.authority(floor - 1, floor, recovery, CEILING_UNKNOWN), 0.0)
  }

  @Test
  fun aCushionUpToTheRecoveryDepthIsOnlyEverWhispered() {
    assertEquals(MAX_DRIFT, CushionDrift.authority(recovery, floor, recovery, recovery), 0.0)
  }

  @Test
  fun depthInTheFirstWindowDrainsAtTheStartUpRateHoweverDeep() {
    assertEquals(STARTUP_DRAIN_DRIFT, CushionDrift.authority(recovery * 4, floor, recovery, CEILING_UNKNOWN), 0.0)
  }

  @Test
  fun theStartUpDepthDrainsGentlyAndABurstAboveItDrainsHard() {
    val ceiling = recovery + 3_000L
    assertEquals(STARTUP_DRAIN_DRIFT, CushionDrift.authority(ceiling, floor, recovery, ceiling), 0.0)
    assertEquals(REBUILD_DRIFT, CushionDrift.authority(ceiling + 1, floor, recovery, ceiling), 0.0)
  }

  @Test
  fun theStartUpCeilingFollowsEachWindowsPeakAndNeverRises() {
    val first = CushionDrift.nextStartupCeiling(CEILING_UNKNOWN, 9_000, margin)
    assertEquals(9_000L + margin, first)
    // Draining or spending the start-up depth lowers the peak and the ceiling with it.
    val lowered = CushionDrift.nextStartupCeiling(first, 7_000, margin)
    assertEquals(7_000L + margin, lowered)
    // A window that held a burst does not raise it: the burst stays a burst.
    assertEquals(lowered, CushionDrift.nextStartupCeiling(lowered, 15_000, margin))
  }

  @Test
  fun aCushionInsideTheDeadbandIsLeftAlone() {
    assertEquals(0.0, CushionDrift.cushionError(1_300, 1_000), 0.0)
    assertEquals(1.0, CushionDrift.cushionError(5_000, 1_000), 0.0)
    assertEquals(-0.5, CushionDrift.cushionError(500, 1_000), 1e-9)
  }
}
