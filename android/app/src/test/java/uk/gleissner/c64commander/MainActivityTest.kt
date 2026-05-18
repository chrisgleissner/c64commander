/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import com.getcapacitor.BridgeActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog

@RunWith(RobolectricTestRunner::class)
class MainActivityTest {
  @Test
  fun mainActivityIsBridgeActivity() {
    assertTrue(BridgeActivity::class.java.isAssignableFrom(MainActivity::class.java))
  }

  @Test
  fun prewarmMimeMapRunsLookupViaProvidedLauncher() {
    val activity = MainActivity()
    var launched = false
    var lookedUpExtension: String? = null

    activity.prewarmMimeMap(
      launcher = { task ->
        launched = true
        task.run()
      },
      lookup = { extension ->
        lookedUpExtension = extension
        "text/html"
      },
    )

    assertTrue(launched)
    assertEquals("html", lookedUpExtension)
  }

  @Test
  fun prewarmMimeMapLogsAndSwallowsLookupFailures() {
    val activity = MainActivity()
    ShadowLog.clear()

    activity.prewarmMimeMap(
      launcher = { task -> task.run() },
      lookup = { throw IllegalStateException("boom") },
    )

    assertTrue(
      ShadowLog.getLogsForTag("MainActivity").any {
        it.msg?.contains("MimeMap prewarm failed; continuing without prewarm") == true
      },
    )
  }
}
