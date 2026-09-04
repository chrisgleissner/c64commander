/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Puts the app in the state a keypad user is already in when a page mounts.
 *
 * HARD27-039: the focus discovery engine no longer runs for pointer users, so a
 * test that reaches into the ring before pressing a key would find it empty. A
 * keypad user navigated to the page with keys, so modality is already
 * `key-navigation` by the time the page mounts, and the engine starts with it.
 * Call this before `render` and {@link leaveKeyNavigationModality} in teardown,
 * because modality is a module-level singleton shared by every test in a file.
 */

import { resetInputModality, setInputModality } from "@/lib/input";

export const enterKeyNavigationModality = (): void => setInputModality("key-navigation");

export const leaveKeyNavigationModality = (): void => resetInputModality();
