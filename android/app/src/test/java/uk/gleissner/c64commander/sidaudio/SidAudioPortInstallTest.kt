/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.sidaudio

import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.getcapacitor.Bridge
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyString
import org.mockito.ArgumentMatchers.eq
import org.mockito.Mockito.mock
import org.mockito.Mockito.mockStatic
import org.mockito.Mockito.never
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner

/**
 * How the binary PCM port is registered with the WebView.
 *
 * Posting the registration to the main thread let it run after Capacitor had started loading the
 * page, and on a Pixel 4 with WebView 150 that crashed the WebView, and the app with it, on every
 * launch. It has to happen inside `load()`, as Capacitor registers its own bridge listener, and for
 * the origins Capacitor serves the app from.
 */
@RunWith(RobolectricTestRunner::class)
class SidAudioPortInstallTest {
  private val origins = setOf("https://localhost")

  private fun loadPlugin(supported: Boolean): Pair<SidAudioPlugin, Bridge> {
    val bridge = mock(Bridge::class.java)
    `when`(bridge.webView).thenReturn(mock(WebView::class.java))
    `when`(bridge.allowedOriginRules).thenReturn(origins)
    val plugin = SidAudioPlugin()
    plugin.setBridge(bridge)
    mockStatic(WebViewFeature::class.java).use { feature ->
      feature.`when`<Boolean> { WebViewFeature.isFeatureSupported(anyString()) }.thenReturn(supported)
      mockStatic(WebViewCompat::class.java).use { compat ->
        plugin.load()
        val times = if (supported) org.mockito.Mockito.times(1) else never()
        compat.verify(
            { WebViewCompat.addWebMessageListener(any(), eq(SidAudioPort.JS_OBJECT_NAME), eq(origins), any()) },
            times,
        )
      }
    }
    return plugin to bridge
  }

  @Test
  fun `registers the port during load, for Capacitor's own origins, without posting it`() {
    val (plugin, bridge) = loadPlugin(supported = true)
    verify(bridge, never()).executeOnMainThread(any())
    plugin.feed.stop()
  }

  @Test
  fun `does not register a port the WebView cannot deliver ArrayBuffers to`() {
    val (plugin, _) = loadPlugin(supported = false)
    plugin.feed.stop()
  }
}
