/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { MockC64UPlugin } from './mockC64u';

export class MockC64UWeb implements MockC64UPlugin {
  async startServer(): Promise<{ baseUrl: string; port: number; ftpPort?: number }> {
    const override = (window as Window & { __c64uMockServerBaseUrl?: string; __c64uMockServerFtpPort?: number })
      .__c64uMockServerBaseUrl;
    if (override) {
      const url = new URL(override);
      const port = url.port ? Number(url.port) : 80;
      const ftpPort = (window as Window & { __c64uMockServerFtpPort?: number }).__c64uMockServerFtpPort;
      return { baseUrl: override, port, ftpPort };
    }
    throw new Error('Mock C64U server is only available on native platforms.');
  }

  async stopServer(): Promise<void> {
    return;
  }
}
