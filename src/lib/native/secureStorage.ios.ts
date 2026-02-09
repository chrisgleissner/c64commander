/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { SecureStoragePlugin } from './secureStorage';

let storedPassword: string | null = null;

export class SecureStorageIOS implements SecureStoragePlugin {
  async setPassword(options: { value: string }): Promise<void> {
    storedPassword = options.value;
  }

  async getPassword(): Promise<{ value: string | null }> {
    return { value: storedPassword };
  }

  async clearPassword(): Promise<void> {
    storedPassword = null;
  }
}
