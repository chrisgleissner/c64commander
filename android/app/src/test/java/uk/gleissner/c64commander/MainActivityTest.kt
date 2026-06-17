/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import com.getcapacitor.BridgeActivity
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog

@RunWith(RobolectricTestRunner::class)
class MainActivityTest {
  private fun setBackgroundExecutionRunning(value: Boolean) {
    val field = BackgroundExecutionService::class.java.getDeclaredField("isRunning")
    field.isAccessible = true
    field.set(null, value)
  }

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

  @Test
  fun clearUnpersistableShareActivityCallClearsOnlyShareShareCalls() {
    val activity = MainActivity()
    val shareCall = PluginCall(null, "Share", "callback-1", "share", JSObject())
    var cleared = false

    val didClear =
      activity.clearUnpersistableShareActivityCall(
        getPendingCall = { shareCall },
        clearPendingCall = { cleared = true },
      )

    assertTrue(didClear)
    assertTrue(cleared)
  }

  @Test
  fun clearUnpersistableShareActivityCallLeavesOtherActivityCallsIntact() {
    val activity = MainActivity()
    val browserCall = PluginCall(null, "Browser", "callback-2", "open", JSObject())
    var cleared = false

    val didClear =
      activity.clearUnpersistableShareActivityCall(
        getPendingCall = { browserCall },
        clearPendingCall = { cleared = true },
      )

    assertFalse(didClear)
    assertFalse(cleared)
  }

  @Test
  fun keepWebViewPlaybackAliveDuringBackgroundExecutionSkipsWhenServiceInactive() {
    val activity = MainActivity()
    var resumed = false
    setBackgroundExecutionRunning(false)

    activity.keepWebViewPlaybackAliveDuringBackgroundExecution {
      resumed = true
    }

    assertFalse(resumed)
  }

  @Test
  fun keepWebViewPlaybackAliveDuringBackgroundExecutionResumesWhenServiceRunning() {
    val activity = MainActivity()
    var resumed = false
    setBackgroundExecutionRunning(true)

    activity.keepWebViewPlaybackAliveDuringBackgroundExecution {
      resumed = true
    }

    assertTrue(resumed)
  }

  @Test
  fun keepWebViewPlaybackAliveDuringBackgroundExecutionLogsAndSwallowsResumeFailures() {
    val activity = MainActivity()
    ShadowLog.clear()
    setBackgroundExecutionRunning(true)

    activity.keepWebViewPlaybackAliveDuringBackgroundExecution {
      throw IllegalStateException("resume failed")
    }

    assertTrue(
      ShadowLog.getLogsForTag("MainActivity").any {
        it.msg?.contains("Failed to keep WebView timers resumed for background playback") == true
      },
    )
  }
}
