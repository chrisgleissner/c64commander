/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.os.Build
import android.util.Log
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [Build.VERSION_CODES.TIRAMISU])
class RenderProcessGoneRecoveryTest {
  private val crashed =
    object : RenderProcessGoneDetail() {
      override fun didCrash() = true

      override fun rendererPriorityAtExit() = WebView.RENDERER_PRIORITY_BOUND
    }

  private var nowMs = 1_000L
  private var recreates = 0
  private var finishes = 0
  private lateinit var history: RenderProcessRecoveryHistory

  @Before
  fun setUp() {
    history = RenderProcessRecoveryHistory()
    ShadowLog.clear()
  }

  private fun recovery(discardWebView: (WebView) -> Unit = ::discardDeadWebView) =
    RenderProcessGoneRecovery(
      context = null,
      recreate = { recreates += 1 },
      finish = { finishes += 1 },
      discardWebView = discardWebView,
      history = history,
      nowMs = { nowMs },
    )

  private fun attachedWebView(): WebView {
    val webView = WebView(ApplicationProvider.getApplicationContext())
    FrameLayout(ApplicationProvider.getApplicationContext()).addView(webView)
    return webView
  }

  @Test
  fun claimsTheRendererDeathDiscardsTheDeadWebViewAndRecreatesTheActivity() {
    val webView = attachedWebView()

    val handled = recovery().onRenderProcessGone(webView, crashed)

    assertTrue("Returning false lets Chromium abort the whole app", handled)
    assertNull("The dead WebView must leave the view hierarchy", webView.parent)
    assertTrue("The dead WebView must be destroyed", Shadows.shadowOf(webView).wasDestroyCalled())
    assertEquals(1, recreates)
    assertEquals(0, finishes)
  }

  @Test
  fun logsWhetherTheRendererCrashedAndItsPriorityAtExitAsAnError() {
    recovery().onRenderProcessGone(attachedWebView(), crashed)

    val logged = ShadowLog.getLogsForTag("RenderProcessRecovery").single()
    assertEquals(Log.ERROR, logged.type)
    assertTrue(logged.msg, logged.msg.contains("didCrash=true"))
    assertTrue(logged.msg, logged.msg.contains("rendererPriorityAtExit=${WebView.RENDERER_PRIORITY_BOUND}"))
  }

  @Test
  fun aSecondRendererDeathWithinTheLoopWindowFinishesTheActivityInsteadOfRecreatingIt() {
    recovery().onRenderProcessGone(attachedWebView(), crashed)
    nowMs += RenderProcessGoneRecovery.RECREATE_LOOP_WINDOW_MS - 1

    val handled = recovery().onRenderProcessGone(attachedWebView(), crashed)

    assertTrue(handled)
    assertEquals("A renderer that keeps dying must not recreate the activity again", 1, recreates)
    assertEquals(1, finishes)
  }

  @Test
  fun aRendererDeathAfterTheLoopWindowRecreatesTheActivityAgain() {
    recovery().onRenderProcessGone(attachedWebView(), crashed)
    nowMs += RenderProcessGoneRecovery.RECREATE_LOOP_WINDOW_MS

    recovery().onRenderProcessGone(attachedWebView(), crashed)

    assertEquals(2, recreates)
    assertEquals(0, finishes)
  }

  @Test
  fun aWebViewThatCannotBeDiscardedStillRecreatesTheActivity() {
    val handled =
      recovery(discardWebView = { throw IllegalStateException("already detached") })
        .onRenderProcessGone(attachedWebView(), crashed)

    assertTrue(handled)
    assertEquals(1, recreates)
    assertTrue(
      ShadowLog.getLogsForTag("RenderProcessRecovery").any {
        it.type == Log.WARN && it.throwable is IllegalStateException
      },
    )
  }
}
