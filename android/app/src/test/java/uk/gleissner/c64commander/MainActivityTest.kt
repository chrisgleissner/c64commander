/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import com.getcapacitor.Bridge
import com.getcapacitor.BridgeActivity
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog
import java.lang.reflect.Field

@RunWith(RobolectricTestRunner::class)
class MainActivityTest {
  @get:Rule
  val tempFolder = TemporaryFolder()

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
  fun ensureCapacitorPluginAssetPathIsANoOpWhenAlreadyAValidFile() {
    val activity = MainActivity()
    val filesDirectory = tempFolder.newFolder("files1")
    val pluginsDir = File(filesDirectory, "public").apply { mkdirs() }
    val pluginsPath = File(pluginsDir, "plugins").apply { writeText("[]") }
    var cleanupLaunched = false

    activity.ensureCapacitorPluginAssetPath(filesDirectory, launchOrphanCleanup = { cleanupLaunched = true })

    assertTrue(pluginsPath.isFile)
    assertFalse("Happy path must not schedule any repair work", cleanupLaunched)
  }

  @Test
  fun ensureCapacitorPluginAssetPathCreatesFileWhenEntirelyMissing() {
    val activity = MainActivity()
    val filesDirectory = tempFolder.newFolder("files2")
    val pluginsPath = File(File(filesDirectory, "public"), "plugins")

    activity.ensureCapacitorPluginAssetPath(filesDirectory)

    assertTrue(pluginsPath.isFile)
    assertEquals("[]", pluginsPath.readText())
  }

  @Test
  fun ensureCapacitorPluginAssetPathRepairsStrayDirectorySynchronouslyViaRename() {
    // The path being a valid FILE must be true as soon as ensureCapacitorPluginAssetPath
    // returns (HARD9-077) - it must not depend on the background cleanup task ever
    // running. Deliberately never run the captured cleanup task here.
    val activity = MainActivity()
    val filesDirectory = tempFolder.newFolder("files3")
    val strayDir = File(File(filesDirectory, "public"), "plugins").apply { mkdirs() }
    File(strayDir, "leftover.txt").writeText("stray data")
    var capturedCleanupTask: Runnable? = null

    activity.ensureCapacitorPluginAssetPath(filesDirectory, launchOrphanCleanup = { task -> capturedCleanupTask = task })

    val pluginsPath = File(File(filesDirectory, "public"), "plugins")
    assertTrue(
            "Path must already be a valid file immediately after the call returns, " +
                    "without waiting for the background cleanup task",
            pluginsPath.isFile,
    )
    assertEquals("[]", pluginsPath.readText())
    assertTrue("Expected the orphaned directory's cleanup to be scheduled", capturedCleanupTask != null)
    assertTrue("The original stray directory must be gone from the path Bridge reads", !strayDir.isDirectory)
  }

  @Test
  fun ensureCapacitorPluginAssetPathCleansUpOrphanedDirectoryWhenCleanupTaskRuns() {
    val activity = MainActivity()
    val filesDirectory = tempFolder.newFolder("files4")
    val strayDir = File(File(filesDirectory, "public"), "plugins").apply { mkdirs() }
    File(strayDir, "leftover.txt").writeText("stray data")

    activity.ensureCapacitorPluginAssetPath(
            filesDirectory,
            launchOrphanCleanup = { task ->
              // Run inline (synchronously) so the test can assert the outcome directly,
              // instead of racing a real background thread.
              task.run()
            },
    )

    val publicDir = File(filesDirectory, "public")
    val remainingOrphans = publicDir.listFiles()?.filter { it.name.startsWith("plugins-orphan-") } ?: emptyList()
    assertTrue("Orphaned directory should be fully removed once its cleanup task runs", remainingOrphans.isEmpty())
  }

  @Test
  fun ensureCapacitorPluginAssetPathLogsAndContinuesWithoutThrowingWhenParentCannotBeCreated() {
    val activity = MainActivity()
    ShadowLog.clear()
    val filesDirectory = tempFolder.newFolder("files5")
    // Making filesDirectory read-only means "public" can never be mkdirs()'d
    // inside it (parent.exists() is false, so this actually exercises the
    // mkdirs() failure branch, not a downstream write failure) - this used to
    // throw IllegalStateException and crash the launch (HARD9-077).
    assertTrue("Test setup: could not make filesDirectory read-only", filesDirectory.setWritable(false))

    try {
      activity.ensureCapacitorPluginAssetPath(filesDirectory)

      assertTrue(
              ShadowLog.getLogsForTag("MainActivity").any {
                it.msg?.contains("Failed to create Capacitor plugin asset parent directory") == true
              },
      )
    } finally {
      filesDirectory.setWritable(true)
    }
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
  fun clearUnpersistableShareActivityCallReflectiveWrapperReturnsFalseWhenFieldMissing() {
    ShadowLog.clear()
    val activity =
      object : MainActivity() {
        override fun resolvePendingActivityCallField(): Field {
          throw NoSuchFieldException("simulated missing Capacitor field")
        }
      }
    val bridge = mock(Bridge::class.java)

    val didClear = activity.clearUnpersistableShareActivityCall(bridge)

    assertFalse(didClear)
    assertTrue(
      ShadowLog.getLogsForTag("MainActivity").any {
        it.msg?.contains("Unable to inspect pending Capacitor activity call before state save") == true
      },
    )
  }

  @Test
  fun clearUnpersistableShareActivityCallReflectiveWrapperReturnsFalseWhenFieldInaccessible() {
    ShadowLog.clear()
    val inaccessibleField = mock(Field::class.java)
    `when`<Any>(inaccessibleField.get(org.mockito.ArgumentMatchers.any())).thenThrow(
      IllegalAccessException("simulated inaccessible Capacitor field"),
    )
    val activity =
      object : MainActivity() {
        override fun resolvePendingActivityCallField(): Field = inaccessibleField
      }
    val bridge = mock(Bridge::class.java)

    val didClear = activity.clearUnpersistableShareActivityCall(bridge)

    assertFalse(didClear)
    assertTrue(
      ShadowLog.getLogsForTag("MainActivity").any {
        it.msg?.contains("Unable to clear pending Capacitor activity call before state save") == true
      },
    )
  }

  @Test
  fun clearUnpersistableShareActivityCallReflectiveWrapperClearsShareCallThroughResolvedField() {
    val shareCall = PluginCall(null, "Share", "callback-3", "share", JSObject())
    val resolvedField = mock(Field::class.java)
    `when`<Any>(resolvedField.get(org.mockito.ArgumentMatchers.any())).thenReturn(shareCall)
    val bridge = mock(Bridge::class.java)
    val activity =
      object : MainActivity() {
        override fun resolvePendingActivityCallField(): Field = resolvedField
      }

    val didClear = activity.clearUnpersistableShareActivityCall(bridge)

    assertTrue(didClear)
    org.mockito.Mockito.verify(resolvedField).set(bridge, null)
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
