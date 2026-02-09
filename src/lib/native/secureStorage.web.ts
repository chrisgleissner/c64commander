/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { SecureStoragePlugin } from './secureStorage';

type SecureStorageOverrideWindow = Window & { __c64uSecureStorageOverride?: { password?: string | null } };

let storedPassword: string | null = null;

const allowTestOverride = () => import.meta.env.VITE_ENABLE_TEST_PROBES === '1';

const readOverride = () => {
  if (typeof window === 'undefined' || !allowTestOverride()) {
    return { hasOverride: false, value: null };
  }
  const override = (window as SecureStorageOverrideWindow).__c64uSecureStorageOverride;
  if (!override || !('password' in override)) {
    return { hasOverride: false, value: null };
  }
  return { hasOverride: true, value: override.password ?? null };
};

export class SecureStorageWeb implements SecureStoragePlugin {
  async setPassword(options: { value: string }): Promise<void> {
    storedPassword = options.value;
  }

  async getPassword(): Promise<{ value: string | null }> {
    const override = readOverride();
    if (override.hasOverride) {
      return { value: override.value };
    }
    return { value: storedPassword };
  }

  async clearPassword(): Promise<void> {
    storedPassword = null;
  }
}
