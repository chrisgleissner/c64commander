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
const isWebPlatformServerMode = () => import.meta.env.VITE_WEB_PLATFORM === '1';

const fetchJson = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `Secure storage request failed: HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
};

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
    if (isWebPlatformServerMode()) {
      await fetchJson<{ ok: boolean }>('/api/secure-storage/password', {
        method: 'PUT',
        body: JSON.stringify({ value: options.value }),
      });
      storedPassword = options.value;
      return;
    }
    storedPassword = options.value;
  }

  async getPassword(): Promise<{ value: string | null }> {
    const override = readOverride();
    if (override.hasOverride) {
      return { value: override.value };
    }
    if (isWebPlatformServerMode()) {
      const payload = await fetchJson<{ value: string | null }>('/api/secure-storage/password', {
        method: 'GET',
      });
      storedPassword = payload.value ?? null;
      return { value: storedPassword };
    }
    return { value: storedPassword };
  }

  async clearPassword(): Promise<void> {
    if (isWebPlatformServerMode()) {
      await fetchJson<{ ok: boolean }>('/api/secure-storage/password', {
        method: 'DELETE',
      });
      storedPassword = null;
      return;
    }
    storedPassword = null;
  }
}
