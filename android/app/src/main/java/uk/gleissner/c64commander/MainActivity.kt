/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.app.ActivityManager
import android.os.Bundle
import com.getcapacitor.BridgeActivity
import java.io.File

class MainActivity : BridgeActivity() {
  private fun ensureCapacitorPluginAssetPath() {
    val pluginsPath = File(filesDir, "public/plugins")
    if (pluginsPath.isFile) return
    try {
      if (pluginsPath.isDirectory && !pluginsPath.deleteRecursively()) {
        AppLogger.warn(
          this,
          "MainActivity",
          "Failed to reset Capacitor plugin asset path",
          "MainActivity",
          IllegalStateException("deleteRecursively returned false for ${pluginsPath.absolutePath}"),
        )
        return
      }

      val parent = pluginsPath.parentFile
      if (parent != null && !parent.exists() && !parent.mkdirs()) {
        AppLogger.warn(
          this,
          "MainActivity",
          "Failed to create Capacitor plugin asset parent directory",
          "MainActivity",
          IllegalStateException("mkdirs returned false for ${parent.absolutePath}"),
        )
        return
      }

      if (!pluginsPath.exists()) {
        pluginsPath.writeText("[]")
      }
    } catch (error: Exception) {
      AppLogger.warn(
        this,
        "MainActivity",
        "Failed to prepare Capacitor plugin asset path",
        "MainActivity",
        error,
      )
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    ensureCapacitorPluginAssetPath()
    registerPlugin(BackgroundExecutionPlugin::class.java)
    registerPlugin(DiagnosticsBridgePlugin::class.java)
    registerPlugin(FolderPickerPlugin::class.java)
    registerPlugin(MockC64UPlugin::class.java)
    registerPlugin(FeatureFlagsPlugin::class.java)
    registerPlugin(FtpClientPlugin::class.java)
    registerPlugin(HvscIngestionPlugin::class.java)
    registerPlugin(SecureStoragePlugin::class.java)
    super.onCreate(savedInstanceState)

    val manager = getSystemService(ACTIVITY_SERVICE) as? ActivityManager
    val memoryClass = manager?.memoryClass
    val largeMemoryClass = manager?.largeMemoryClass
    AppLogger.info(
      this,
      "MainActivity",
      "Android memory class detected: memoryClass=$memoryClass, largeMemoryClass=$largeMemoryClass",
      "MainActivity",
    )
  }
}
