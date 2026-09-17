/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.view.View
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.WebViewListener
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.Locale
import kotlin.math.ceil

/**
 * The page's safe-area insets in CSS pixels, and the bottom padding the WebView's parent needs.
 *
 * The activity draws edge-to-edge, so the page must keep its own content clear of the bars. While
 * the keyboard is up, the parent is padded by its height and the page's bottom inset is zero.
 */
internal data class SafeAreaLayout(val top: Int, val right: Int, val bottom: Int, val left: Int, val hostPaddingBottom: Int)

internal fun safeAreaLayout(
        top: Int,
        right: Int,
        bottom: Int,
        left: Int,
        imeBottom: Int,
        imeVisible: Boolean,
        density: Float,
): SafeAreaLayout {
  // Rounded up: a fraction of a pixel short would leave the page's top row under the status bar.
  fun css(px: Int) = ceil(px / density).toInt()
  return SafeAreaLayout(
          top = css(top),
          right = css(right),
          bottom = if (imeVisible) 0 else css(bottom),
          left = css(left),
          hostPaddingBottom = if (imeVisible) imeBottom else 0,
  )
}

internal fun safeAreaScript(layout: SafeAreaLayout): String {
  val style = "document.documentElement.style"
  return listOf("top" to layout.top, "right" to layout.right, "bottom" to layout.bottom, "left" to layout.left)
          .joinToString("") { (edge, value) ->
            String.format(Locale.US, "%s.setProperty(\"--safe-area-inset-%s\", \"%dpx\");", style, edge, value)
          }
}

@CapacitorPlugin(name = "SafeArea")
class SafeAreaPlugin : Plugin() {
  /**
   * The only writer of `--safe-area-inset-*` on Android. Capacitor's SystemBars plugin is disabled
   * in capacitor.config.ts: it reports zero insets on Android 14 and older unless the WebView is
   * version 140 or newer, which put the page under the status bar there.
   */
  override fun load() {
    val host = bridge?.webView?.parent as? View ?: return
    ViewCompat.setOnApplyWindowInsetsListener(host) { view, insets -> publishInsets(view, insets) }
    // The page may load after the last insets pass, and a page load discards the inline properties.
    bridge.addWebViewListener(
            object : WebViewListener() {
              override fun onPageLoaded(webView: WebView) {
                ViewCompat.requestApplyInsets(host)
              }
            }
    )
  }

  private fun publishInsets(view: View, insets: WindowInsetsCompat): WindowInsetsCompat {
    val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
    val ime = WindowInsetsCompat.Type.ime()
    val layout =
            safeAreaLayout(
                    bars.top,
                    bars.right,
                    bars.bottom,
                    bars.left,
                    insets.getInsets(ime).bottom,
                    insets.isVisible(ime),
                    view.resources.displayMetrics.density,
            )
    view.setPadding(0, 0, 0, layout.hostPaddingBottom)
    bridge?.webView?.evaluateJavascript(safeAreaScript(layout), null)
    return insets
  }

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
