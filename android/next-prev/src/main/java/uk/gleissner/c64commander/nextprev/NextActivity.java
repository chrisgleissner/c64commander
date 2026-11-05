/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.nextprev;

/** Moves the main app's playlist on to the next item. */
public final class NextActivity extends TransportShortcutActivity {
    @Override
    String command() {
        return "next";
    }
}
