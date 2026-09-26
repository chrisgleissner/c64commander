/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import androidx.annotation.RequiresApi
import com.getcapacitor.WebViewListener

/** Outlives the activity, because each recovery replaces the activity that recorded it. */
internal class RenderProcessRecoveryHistory {
  @Volatile var lastRecreateAtMs: Long? = null
}

internal fun discardDeadWebView(webView: WebView) {
  (webView.parent as? ViewGroup)?.removeView(webView)
  webView.destroy()
}

/**
 * Chromium aborts the whole app when a WebView renderer dies and no listener claims it. This one
 * claims it, discards the dead WebView, and recreates the activity so a fresh WebView and bridge are
 * built. A renderer that dies again within [RECREATE_LOOP_WINDOW_MS] finishes the activity instead.
 */
internal class RenderProcessGoneRecovery(
  private val context: Context?,
  private val recreate: () -> Unit,
  private val finish: () -> Unit,
  private val discardWebView: (WebView) -> Unit = ::discardDeadWebView,
  private val history: RenderProcessRecoveryHistory = processHistory,
  private val nowMs: () -> Long = SystemClock::elapsedRealtime,
) : WebViewListener() {
  companion object {
    private const val TAG = "RenderProcessRecovery"
    const val RECREATE_LOOP_WINDOW_MS = 30_000L
    val processHistory = RenderProcessRecoveryHistory()
  }

  @RequiresApi(Build.VERSION_CODES.O)
  override fun onRenderProcessGone(webView: WebView, detail: RenderProcessGoneDetail): Boolean {
    val now = nowMs()
    val lastRecreateAtMs = history.lastRecreateAtMs
    val recoveredRecently = lastRecreateAtMs != null && now - lastRecreateAtMs < RECREATE_LOOP_WINDOW_MS
    val outcome = if (recoveredRecently) "died again within ${RECREATE_LOOP_WINDOW_MS}ms; finishing" else "recreating"
    AppLogger.error(
      context,
      TAG,
      "WebView renderer gone (didCrash=${detail.didCrash()}, " +
        "rendererPriorityAtExit=${detail.rendererPriorityAtExit()}); $outcome the activity",
      "MainActivity",
    )
    try {
      discardWebView(webView)
    } catch (error: RuntimeException) {
      AppLogger.warn(context, TAG, "Could not discard the dead WebView; recovering anyway", "MainActivity", error)
    }
    if (recoveredRecently) {
      finish()
    } else {
      history.lastRecreateAtMs = now
      recreate()
    }
    return true
  }
}
