/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { BackgroundExecutionPlugin } from './backgroundExecution';

/**
 * No-op web fallback — background execution is only relevant on native platforms.
 */
export class BackgroundExecutionWeb implements BackgroundExecutionPlugin {
    async start(): Promise<void> {
        /* no-op on web */
    }

    async stop(): Promise<void> {
        /* no-op on web */
    }
}
