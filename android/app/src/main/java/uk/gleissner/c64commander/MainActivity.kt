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
import com.getcapacitor.Bridge
import com.getcapacitor.BridgeActivity
import com.getcapacitor.PluginCall
import java.io.File
import java.lang.reflect.Field
import java.net.CookieHandler

open class MainActivity : BridgeActivity() {
  internal fun ensureCapacitorPluginAssetPath(
    filesDirectory: File = filesDir,
    launchOrphanCleanup: (Runnable) -> Unit = { task -> Thread(task, "PluginAssetOrphanCleanup").start() },
  ) {
    val pluginsPath = File(filesDirectory, "public/plugins")
    // Fast, cheap happy path (a single stat call) stays synchronous on this
    // thread — this is the case on every normal launch, so it must add no
    // measurable overhead. Bridge will read this file once it starts.
    if (pluginsPath.isFile) return
    try {
      if (pluginsPath.isDirectory) {
        // A stray directory here can be arbitrarily large (HARD9-077); a
        // synchronous deleteRecursively() of it can stall this (main) thread
        // toward the ANR threshold. Renaming it out of the way is an O(1)
        // filesystem metadata operation regardless of the directory's size,
        // freeing the required path immediately; the actual bulk delete of
        // the orphaned directory then runs on a background thread with
        // nothing downstream needing to wait for it to finish.
        val orphan = File(filesDirectory, "public/plugins-orphan-${System.currentTimeMillis()}")
        if (pluginsPath.renameTo(orphan)) {
          launchOrphanCleanup(
                  Runnable {
                    try {
                      orphan.deleteRecursively()
                    } catch (error: Exception) {
                      AppLogger.warn(
                              null,
                              "MainActivity",
                              "Failed to clean up orphaned Capacitor plugin asset directory",
                              "MainActivity",
                              error,
                      )
                    }
                  },
          )
        } else if (!pluginsPath.deleteRecursively()) {
          // Rename failed (e.g. cross-filesystem) and the direct delete also
          // failed. Repairable disk hiccup: log and best-effort continue —
          // Capacitor will recreate the file on first plugin call — instead
          // of throwing and turning this into a startup crash loop.
          AppLogger.warn(
                  null,
                  "MainActivity",
                  "Unable to remove stray Capacitor plugin asset directory; continuing without repair",
                  "MainActivity",
          )
          return
        }
      }

      val parent = pluginsPath.parentFile
      if (parent != null && !parent.exists() && !parent.mkdirs()) {
        AppLogger.warn(
                null,
                "MainActivity",
                "Failed to create Capacitor plugin asset parent directory; continuing without repair",
                "MainActivity",
        )
        return
      }

      if (!pluginsPath.exists()) {
        pluginsPath.writeText("[]")
      }
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
    registerPlugin(DeviceDiscoveryPlugin::class.java)
    registerPlugin(DiagnosticsBridgePlugin::class.java)
    registerPlugin(FolderPickerPlugin::class.java)
    registerPlugin(MockC64UPlugin::class.java)
    registerPlugin(FeatureFlagsPlugin::class.java)
    registerPlugin(FtpClientPlugin::class.java)
    registerPlugin(HvscIngestionPlugin::class.java)
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

  internal fun isUnpersistableShareActivityCall(call: PluginCall?): Boolean {
    return call?.pluginId == "Share" && call.methodName == "share"
  }

  internal fun clearUnpersistableShareActivityCall(
    getPendingCall: () -> PluginCall?,
    clearPendingCall: () -> Unit,
  ): Boolean {
    val pendingCall = getPendingCall() ?: return false

    if (!isUnpersistableShareActivityCall(pendingCall)) {
      return false
    }

    clearPendingCall()
    AppLogger.debug(
      null,
      "MainActivity",
      "Cleared unpersistable Share activity call before state save",
      "MainActivity",
    )
    return true
  }

  internal fun clearUnpersistableShareActivityCall(capacitorBridge: Bridge = bridge): Boolean {
    return try {
      val pendingCallField = resolvePendingActivityCallField()
      pendingCallField.isAccessible = true
      clearUnpersistableShareActivityCall(
        getPendingCall = { pendingCallField.get(capacitorBridge) as? PluginCall },
        clearPendingCall = { pendingCallField.set(capacitorBridge, null) },
      )
    } catch (error: NoSuchFieldException) {
      AppLogger.warn(
        null,
        "MainActivity",
        "Unable to inspect pending Capacitor activity call before state save",
        "MainActivity",
        error,
      )
      false
    } catch (error: IllegalAccessException) {
      AppLogger.warn(
        null,
        "MainActivity",
        "Unable to clear pending Capacitor activity call before state save",
        "MainActivity",
        error,
      )
      false
    }
  }

  internal open fun resolvePendingActivityCallField(): Field {
    return Bridge::class.java.getDeclaredField("pluginCallForLastActivity")
  }

  override fun onSaveInstanceState(outState: Bundle) {
    clearUnpersistableShareActivityCall()
    super.onSaveInstanceState(outState)
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

  override fun onStop() {
    super.onStop()
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
