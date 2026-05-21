/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.app.ActivityManager
import android.graphics.Color
import android.os.Bundle
import android.webkit.MimeTypeMap
import androidx.core.view.WindowCompat
import com.getcapacitor.BridgeActivity
import java.io.File
import java.net.CookieHandler

class MainActivity : BridgeActivity() {
  internal fun ensureCapacitorPluginAssetPath(filesDirectory: File = filesDir) {
    val pluginsPath = File(filesDirectory, "public/plugins")
    // Recoverable: file already exists in the expected shape. Bridge will read it.
    if (pluginsPath.isFile) return
    try {
      if (pluginsPath.isDirectory && !pluginsPath.deleteRecursively()) {
        // Unrecoverable: directory exists where a file is required and we
        // cannot replace it. Continuing would leave the bridge in a broken
        // state where plugin invocations behave unpredictably.
        throw IllegalStateException(
                "Capacitor plugin asset path is a directory and cannot be removed: ${pluginsPath.absolutePath}",
        )
      }

      val parent = pluginsPath.parentFile
      if (parent != null && !parent.exists() && !parent.mkdirs()) {
        throw IllegalStateException(
                "Failed to create Capacitor plugin asset parent directory: ${parent.absolutePath}",
        )
      }

      if (!pluginsPath.exists()) {
        pluginsPath.writeText("[]")
      }
    } catch (error: IllegalStateException) {
      // Surface unrecoverable failures so the launch fails fast instead of
      // limping along with a broken plugin path.
      AppLogger.warn(
              this,
              "MainActivity",
              "Unrecoverable Capacitor plugin asset path failure",
              "MainActivity",
              error,
      )
      throw error
    } catch (error: Exception) {
      // Recoverable I/O hiccup (e.g. transient permission denial during a
      // backup restore). Log with context and let onCreate continue —
      // Capacitor will recreate the file on first plugin call.
      AppLogger.warn(
              this,
              "MainActivity",
              "Recoverable Capacitor plugin asset path warning",
              "MainActivity",
              error,
      )
    }
  }

  internal fun prewarmMimeMap(
    launcher: (Runnable) -> Unit = { task -> Thread(task, "MimeMapPrewarm").start() },
    lookup: (String) -> String? = { extension ->
      MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
    },
  ) {
    launcher(
      Runnable {
        try {
          lookup("html")
          AppLogger.debug(null, "MainActivity", "MimeMap prewarm completed off-UI thread", "MainActivity")
        } catch (error: Exception) {
          AppLogger.warn(
            null,
            "MainActivity",
            "MimeMap prewarm failed; continuing without prewarm",
            "MainActivity",
            error,
          )
        }
      },
    )
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    ensureCapacitorPluginAssetPath()
    prewarmMimeMap()
    registerPlugin(BackgroundExecutionPlugin::class.java)
    registerPlugin(DiagnosticsBridgePlugin::class.java)
    registerPlugin(FolderPickerPlugin::class.java)
    registerPlugin(MockC64UPlugin::class.java)
    registerPlugin(FeatureFlagsPlugin::class.java)
    registerPlugin(FtpClientPlugin::class.java)
    registerPlugin(HvscIngestionPlugin::class.java)
    registerPlugin(MdnsResolverPlugin::class.java)
    registerPlugin(SafeAreaPlugin::class.java)
    registerPlugin(SecureStoragePlugin::class.java)
    registerPlugin(TelnetSocketPlugin::class.java)
    super.onCreate(savedInstanceState)
    installLanCookieBypassIfNeeded()
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT

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

  internal fun keepWebViewPlaybackAliveDuringBackgroundExecution(
    resumeWebView: () -> Unit = {
      bridge.webView.onResume()
      bridge.webView.resumeTimers()
    },
  ) {
    if (!BackgroundExecutionService.isRunning) return
    try {
      resumeWebView()
      AppLogger.debug(
        null,
        "MainActivity",
        "Kept WebView timers resumed for background playback",
        "MainActivity",
      )
    } catch (error: Exception) {
      AppLogger.warn(
        null,
        "MainActivity",
        "Failed to keep WebView timers resumed for background playback",
        "MainActivity",
        error,
      )
    }
  }

  override fun onPause() {
    super.onPause()
    keepWebViewPlaybackAliveDuringBackgroundExecution()
  }

  internal fun installLanCookieBypassIfNeeded() {
    val cookiesEnabled = bridge.config.getPluginConfiguration("CapacitorCookies").getBoolean("enabled", false)
    if (cookiesEnabled) {
      return
    }

    val currentHandler = CookieHandler.getDefault() ?: return
    if (currentHandler is C64LanCookieBypassHandler) {
      return
    }

    CookieHandler.setDefault(C64LanCookieBypassHandler(currentHandler))
  }
}
