/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { usePageActivityState } from "@/hooks/useScreenActivity";

/**
 * Whether this page is the tab on screen, whether or not the app itself is in the background.
 *
 * A visited page is kept mounted. It used to be unmounted when its tab was left, and only then: sending the app to the
 * background never unmounted it. Work that lived exactly as long as the page follows this, not `useScreenActivity`,
 * which also turns false whenever the app is hidden. While the app is hidden the answer from before stands.
 */
export const usePageActivity = (): boolean => usePageActivityState();
