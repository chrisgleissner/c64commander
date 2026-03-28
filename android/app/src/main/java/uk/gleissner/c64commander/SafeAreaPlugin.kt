/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
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
}
