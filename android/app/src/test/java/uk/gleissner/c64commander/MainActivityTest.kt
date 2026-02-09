/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import com.getcapacitor.BridgeActivity
import org.junit.Assert.assertTrue
import org.junit.Test
class MainActivityTest {
  @Test
  fun mainActivityIsBridgeActivity() {
    assertTrue(BridgeActivity::class.java.isAssignableFrom(MainActivity::class.java))
  }
}
