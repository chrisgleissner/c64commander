/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin } from '@capacitor/core';

export type BackgroundExecutionPlugin = {
    start: () => Promise<void>;
    stop: () => Promise<void>;
};

export const BackgroundExecution = registerPlugin<BackgroundExecutionPlugin>('BackgroundExecution', {
    web: () => import('./backgroundExecution.web').then((m) => new m.BackgroundExecutionWeb()),
});
