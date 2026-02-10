/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin } from '@capacitor/core';
import type { MockConfigPayload } from '@/lib/mock/mockConfig';

export type MockC64UPlugin = {
  startServer: (options: { config: MockConfigPayload; preferredPort?: number }) => Promise<{
    baseUrl: string;
    port: number;
    ftpPort?: number;
  }>;
  stopServer: () => Promise<void>;
};

export const MockC64U = registerPlugin<MockC64UPlugin>('MockC64U', {
  web: () => import('./mockC64u.web').then((module) => new module.MockC64UWeb()),
});
