/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FtpReadCancellationRegistryTest {
  @Test
  fun lateCancelsAfterTheFinishedSetOverflowedStayWithinTheBound() {
    val registry = FtpReadCancellationRegistry(maxTrackedReads = 2)
    val ids = (1..10).map { "read-$it" }
    ids.forEach { registry.finish(it) }

    ids.forEach { registry.markCancelled(it) }

    assertEquals(2, ids.count { registry.isCancelled(it) })
  }

  @Test
  fun recentlyFinishedReadsStillIgnoreALateCancelAfterOlderOnesAreForgotten() {
    val registry = FtpReadCancellationRegistry(maxTrackedReads = 2)
    (1..10).forEach { registry.finish("read-$it") }

    assertFalse(registry.markCancelled("read-10"))
    assertFalse(registry.isCancelled("read-10"))
  }

  @Test
  fun aCancelBeforeTheReadStartsIsHonouredAndClearedWhenTheReadFinishes() {
    val registry = FtpReadCancellationRegistry(maxTrackedReads = 2)

    assertTrue(registry.markCancelled("early"))
    assertTrue(registry.isCancelled("early"))
    registry.finish("early")

    assertFalse(registry.isCancelled("early"))
  }
}
