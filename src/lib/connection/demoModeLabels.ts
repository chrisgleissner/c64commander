/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * What the app calls the device it talks to in Demo Mode. The simulated device answers with the
 * saved device's host name, so a label taken from its answers named the user's real C64U while
 * nothing was connected to it.
 */
export const DEMO_MODE_DEVICE_LABEL = "Demo Mode";
export const DEMO_MODE_CONNECTION_LABEL = "Demo Mode · simulated device";
