/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecureStorageWeb } from '@/lib/native/secureStorage.web';

describe('SecureStorageWeb', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    delete (window as Window & { __c64uSecureStorageOverride?: { password?: string | null } }).__c64uSecureStorageOverride;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    delete (window as Window & { __c64uSecureStorageOverride?: { password?: string | null } }).__c64uSecureStorageOverride;
  });

  it('stores and clears passwords in memory', async () => {
    const storage = new SecureStorageWeb();

    await storage.setPassword({ value: 'secret' });
    await expect(storage.getPassword()).resolves.toEqual({ value: 'secret' });

    await storage.clearPassword();
    await expect(storage.getPassword()).resolves.toEqual({ value: null });
  });

  it('uses backend API in web platform mode', async () => {
    vi.stubEnv('VITE_WEB_PLATFORM', '1');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ value: 'server-secret' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    const storage = new SecureStorageWeb();

    await storage.setPassword({ value: 'server-secret' });
    await expect(storage.getPassword()).resolves.toEqual({ value: 'server-secret' });
    await storage.clearPassword();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/secure-storage/password',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ value: 'server-secret' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/secure-storage/password',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/secure-storage/password',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('returns test override password when probes are enabled', async () => {
    vi.stubEnv('VITE_ENABLE_TEST_PROBES', '1');
    vi.stubEnv('VITE_WEB_PLATFORM', '1');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    (window as Window & { __c64uSecureStorageOverride?: { password?: string | null } }).__c64uSecureStorageOverride = {
      password: 'override-secret',
    };

    const storage = new SecureStorageWeb();

    await expect(storage.getPassword()).resolves.toEqual({ value: 'override-secret' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null override when probes are enabled and override password is nullish', async () => {
    vi.stubEnv('VITE_ENABLE_TEST_PROBES', '1');
    vi.stubEnv('VITE_WEB_PLATFORM', '1');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    (window as Window & { __c64uSecureStorageOverride?: { password?: string | null } }).__c64uSecureStorageOverride = {
      password: undefined,
    };

    const storage = new SecureStorageWeb();

    await expect(storage.getPassword()).resolves.toEqual({ value: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws backend error payload when secure storage request fails', async () => {
    vi.stubEnv('VITE_WEB_PLATFORM', '1');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'backend failed' }),
      }),
    );

    const storage = new SecureStorageWeb();

    await expect(storage.setPassword({ value: 'x' })).rejects.toThrow('backend failed');
  });

  it('falls back to HTTP status message when backend error payload is not JSON', async () => {
    vi.stubEnv('VITE_WEB_PLATFORM', '1');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error('invalid json');
        },
      }),
    );

    const storage = new SecureStorageWeb();

    await expect(storage.clearPassword()).rejects.toThrow('Secure storage request failed: HTTP 503');
  });
});
