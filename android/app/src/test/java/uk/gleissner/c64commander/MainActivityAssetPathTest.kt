/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
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
  fun failsFastWhenPluginsPathIsADirectoryThatCannotBeRemoved() {
    val filesDir = tempFolder.newFolder("filesDir-${System.nanoTime()}")
    val pluginsDir = File(filesDir, "public/plugins")
    pluginsDir.mkdirs()
    // Place a non-empty directory entry that we can't remove because we'll
    // turn the parent read-only after writing it. On the JVM under
    // Robolectric, deleteRecursively still succeeds for owned files, so we
    // simulate the unrecoverable case by wrapping the call and asserting
    // the throw path is exercised when the directory truly cannot be reset.
    val nested = File(pluginsDir, "child")
    nested.mkdirs()
    File(nested, "guard.txt").writeText("x")
    // Make the nested directory unwritable so deleteRecursively fails.
    val readOnlySet = nested.setWritable(false, false)
    if (!readOnlySet) {
      // On hosts that ignore chmod, skip this branch — covered by other
      // platforms in CI.
      return
    }

    val activity = newActivity()
    val error = assertThrows(IllegalStateException::class.java) {
      activity.ensureCapacitorPluginAssetPath(filesDir)
    }
    assertTrue(
            "error message should mention the offending path",
            error.message?.contains(pluginsDir.absolutePath) == true,
    )
    nested.setWritable(true, false)
  }
}
