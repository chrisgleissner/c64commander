/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.gleissner.c64commander.hvsc.extractionMemoryBudget

class HvscExtractionMemoryBudgetTest {
  private val mib = 1024L * 1024L

  /** What the archive's 7-Zip dictionary plus working set needs, as estimated by the extractor. */
  private val hvscRequirement = 468L * mib

  @Test
  fun allowsExtractionWhenTheSystemHasMemoryAlthoughTheJavaHeapClassIsSmall() {
    // Measured on a keypad handset running apps in a compatibility runtime.
    val budget =
            extractionMemoryBudget(
                    availableBytes = 1_836_699_648L,
                    memoryClassBytes = 128L * mib,
                    runtimeBytes = 128L * mib,
            )

    assertEquals(1_836_699_648L / 2L, budget.maxExtractionBytes)
    assertTrue(budget.maxExtractionBytes >= hvscRequirement)
  }

  @Test
  fun keepsHalfOfTheAvailableMemoryFreeWhenTheSystemIsShortOfIt() {
    val budget =
            extractionMemoryBudget(
                    availableBytes = 600L * mib,
                    memoryClassBytes = 512L * mib,
                    runtimeBytes = 512L * mib,
            )

    assertEquals(300L * mib, budget.maxExtractionBytes)
  }

  @Test
  fun fallsBackToTheHeapFiguresWhenTheSystemReportsNoAvailableMemory() {
    val budget =
            extractionMemoryBudget(availableBytes = 0L, memoryClassBytes = 256L * mib, runtimeBytes = 192L * mib)

    assertEquals(512L * mib, budget.maxExtractionBytes)
  }
}
