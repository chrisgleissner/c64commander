/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "SafeArea")
class SafeAreaPlugin : Plugin() {
  @PluginMethod
  fun getInsets(call: PluginCall) {
    val activity = activity
    if (activity == null) {
      call.reject("Activity unavailable")
      return
    }

    val decorView = activity.window?.decorView
    if (decorView == null) {
      call.reject("Window decor view unavailable")
      return
    }

    val insets =
            ViewCompat.getRootWindowInsets(decorView)?.getInsets(
                    WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )

    val payload = JSObject().apply {
      put("top", insets?.top ?: 0)
      put("right", insets?.right ?: 0)
      put("bottom", insets?.bottom ?: 0)
      put("left", insets?.left ?: 0)
    }
    call.resolve(payload)
  }

  /**
   * Show or hide the system status bar and/or navigation bar (full-screen /
   * immersive). The activity is already edge-to-edge, so hiding a bar simply
   * reclaims its space; the existing safe-area sync then reports zero inset for
   * the hidden edge. Hidden bars reappear transiently on an edge swipe and
   * re-hide, the standard immersive behaviour so system gestures stay reachable.
   */
  @PluginMethod
  fun setSystemBarsVisibility(call: PluginCall) {
    val statusBarVisible = call.getBoolean("statusBar", true) ?: true
    val navigationBarVisible = call.getBoolean("navigationBar", true) ?: true

    val activity = activity
    if (activity == null) {
      call.reject("Activity unavailable")
      return
    }
    val window = activity.window
    if (window == null) {
      call.reject("Window unavailable")
      return
    }

    activity.runOnUiThread {
      val controller = WindowCompat.getInsetsController(window, window.decorView)
      controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      val statusBars = WindowInsetsCompat.Type.statusBars()
      val navigationBars = WindowInsetsCompat.Type.navigationBars()
      if (statusBarVisible) controller.show(statusBars) else controller.hide(statusBars)
      if (navigationBarVisible) controller.show(navigationBars) else controller.hide(navigationBars)
      call.resolve()
    }
  }

  /**
   * Set the system-bar icon appearance to match the app's resolved light/dark
   * theme. The activity draws edge-to-edge with transparent status/navigation
   * bars, so the bars have no colour of their own — their icons are only legible
   * if their contrast tracks the app background beneath them. `light = true`
   * (app in LIGHT theme) requests dark icons; `light = false` requests light
   * icons. Without this the icons default to light and vanish against a light
   * app background (Issue 6).
   */
  @PluginMethod
  fun setSystemBarsAppearance(call: PluginCall) {
    val light = call.getBoolean("light", false) ?: false

    val activity = activity
    if (activity == null) {
      call.reject("Activity unavailable")
      return
    }
    val window = activity.window
    if (window == null) {
      call.reject("Window unavailable")
      return
    }

    activity.runOnUiThread {
      val controller = WindowCompat.getInsetsController(window, window.decorView)
      controller.isAppearanceLightStatusBars = light
      controller.isAppearanceLightNavigationBars = light
      call.resolve()
    }
  }
}
