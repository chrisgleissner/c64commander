/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.app.Activity
import android.os.Build

/**
 * A real task snapshot holds the window manager lock while it waits for the compositor. A compositor that calls back
 * into the window manager when a task moves deadlocks with it, and the system watchdog then restarts Android. A theme
 * snapshot captures no layers.
 */
internal fun Activity.useThemeTaskSnapshots() {
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) setRecentsScreenshotEnabled(false)
}
