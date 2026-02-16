/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.shadows.ShadowLog

@RunWith(RobolectricTestRunner::class)
class AppLoggerTest {

    @Test
    fun emitsAllLevelsWithThrowableAndTraceFields() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val trace = AppLogger.TraceFields(
            correlationId = "corr-1",
            trackInstanceId = "77",
            playlistItemId = "p-3",
            sourceKind = "hvsc",
            localAccessMode = "ftp",
            lifecycleState = "playing",
        )

        val throwable = IllegalStateException("boom")
        AppLogger.debug(context, "AppLoggerTest", "debug message", "AppLoggerTest", trace)
        AppLogger.info(context, "AppLoggerTest", "info message", "AppLoggerTest", trace)
        AppLogger.warn(context, "AppLoggerTest", "warn message", "AppLoggerTest", throwable, trace)
        AppLogger.error(context, "AppLoggerTest", "error message", "AppLoggerTest", throwable, trace)

        val logs = ShadowLog.getLogsForTag("AppLoggerTest")
        assertTrue(logs.any { it.msg == "debug message" })
        assertTrue(logs.any { it.msg == "info message" })
        assertTrue(logs.any { it.msg == "warn message" })
        assertTrue(logs.any { it.msg == "error message" })

        val broadcasts = Shadows.shadowOf(context as android.app.Application).broadcastIntents
        val diagnostics = broadcasts.filter { it.action == AppLogger.ACTION_DIAGNOSTICS_LOG }
        assertEquals(4, diagnostics.size)

        val withError = diagnostics.last()
        assertEquals("error", withError.getStringExtra(AppLogger.EXTRA_LEVEL))
        assertEquals("error message", withError.getStringExtra(AppLogger.EXTRA_MESSAGE))
        assertEquals("AppLoggerTest", withError.getStringExtra(AppLogger.EXTRA_COMPONENT))
        assertEquals("corr-1", withError.getStringExtra(AppLogger.EXTRA_CORRELATION_ID))
        assertEquals("77", withError.getStringExtra(AppLogger.EXTRA_TRACK_INSTANCE_ID))
        assertEquals("p-3", withError.getStringExtra(AppLogger.EXTRA_PLAYLIST_ITEM_ID))
        assertEquals("hvsc", withError.getStringExtra(AppLogger.EXTRA_SOURCE_KIND))
        assertEquals("ftp", withError.getStringExtra(AppLogger.EXTRA_LOCAL_ACCESS_MODE))
        assertEquals("playing", withError.getStringExtra(AppLogger.EXTRA_LIFECYCLE_STATE))
        assertEquals("IllegalStateException", withError.getStringExtra(AppLogger.EXTRA_ERROR_NAME))
    }

    @Test
    fun emitsNothingWhenContextIsNull() {
        ShadowLog.clear()

        AppLogger.debug(null, "AppLoggerTest", "debug", "AppLoggerTest")
        AppLogger.info(null, "AppLoggerTest", "info", "AppLoggerTest")
        AppLogger.warn(null, "AppLoggerTest", "warn", "AppLoggerTest")
        AppLogger.error(null, "AppLoggerTest", "error", "AppLoggerTest")

        val logs = ShadowLog.getLogsForTag("AppLoggerTest")
        assertTrue(logs.isNotEmpty())
    }
}
