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
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class MainActivityAssetPathTest {

  @get:Rule val tempFolder = TemporaryFolder()

  private fun newActivity(): MainActivity {
    val controller = Robolectric.buildActivity(MainActivity::class.java)
    return controller.get()
  }

  @Test
  fun createsMissingPluginsFile() {
    val filesDir = tempFolder.newFolder("filesDir-${System.nanoTime()}")
    val activity = newActivity()
    activity.ensureCapacitorPluginAssetPath(filesDir)

    val pluginsFile = File(filesDir, "public/plugins")
    assertTrue("plugins file should exist", pluginsFile.isFile)
    assertEquals("[]", pluginsFile.readText())
  }

  @Test
  fun leavesExistingPluginsFileAlone() {
    val filesDir = tempFolder.newFolder("filesDir-${System.nanoTime()}")
    val pluginsFile = File(filesDir, "public/plugins")
    pluginsFile.parentFile?.mkdirs()
    pluginsFile.writeText("[\"existing\"]")

    val activity = newActivity()
    activity.ensureCapacitorPluginAssetPath(filesDir)

    assertTrue(pluginsFile.isFile)
    assertEquals("[\"existing\"]", pluginsFile.readText())
  }

  @Test
  fun repairsDirectoryWithUnremovableNestedContentInsteadOfCrashingTheLaunch() {
    // HARD9-077: a repairable disk hiccup (a stray directory sitting where the
    // plugins file belongs) must not throw and crash the launch. This used to
    // assert the opposite - that an unremovable directory threw
    // IllegalStateException - which is the exact "startup crash loop" bug the
    // finding describes; the app must instead log a warning and continue.
    val filesDir = tempFolder.newFolder("filesDir-${System.nanoTime()}")
    val pluginsDir = File(filesDir, "public/plugins")
    pluginsDir.mkdirs()
    val nested = File(pluginsDir, "child")
    nested.mkdirs()
    File(nested, "guard.txt").writeText("x")
    // Make the nested directory unwritable so a direct deleteRecursively() of
    // pluginsDir's contents would fail.
    val readOnlySet = nested.setWritable(false, false)
    if (!readOnlySet) {
      // On hosts that ignore chmod, skip this branch — covered by other
      // platforms in CI.
      return
    }

    try {
      val activity = newActivity()
      // Must not throw. renameTo() only needs write access to the parent
      // directory (not the nested unwritable child), so this repairs cleanly
      // via the O(1) rename-then-background-delete path even though the
      // stray directory's contents can't all be removed synchronously.
      activity.ensureCapacitorPluginAssetPath(filesDir)

      val pluginsFile = File(filesDir, "public/plugins")
      assertTrue("plugins path should be repaired into a valid file", pluginsFile.isFile)
      assertEquals("[]", pluginsFile.readText())
    } finally {
      nested.setWritable(true, false)
    }
  }
}
