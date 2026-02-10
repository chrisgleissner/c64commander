/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPassword,
  getPassword,
  resetStoredPasswordCache,
  setPassword,
} from '@/lib/secureStorage';
import { SecureStorage } from '@/lib/native/secureStorage';

vi.mock('@/lib/native/secureStorage', () => ({
  SecureStorage: {
    setPassword: vi.fn(async () => undefined),
    getPassword: vi.fn(async () => ({ value: null })),
    clearPassword: vi.fn(async () => undefined),
  },
}));

describe('secureStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStoredPasswordCache();
    vi.mocked(SecureStorage.setPassword).mockClear();
    vi.mocked(SecureStorage.getPassword).mockClear();
    vi.mocked(SecureStorage.clearPassword).mockClear();
  });

  it('never writes password to localStorage when setting', async () => {
    await setPassword('super-secret');

    expect(localStorage.getItem('c64u_password')).toBeNull();
    expect(localStorage.getItem('c64u_has_password')).toBe('1');
    expect(SecureStorage.setPassword).toHaveBeenCalledWith({ value: 'super-secret' });
  });

  it('does not touch secure storage when flag is false', async () => {
    localStorage.removeItem('c64u_has_password');

    const value = await getPassword();

    expect(value).toBeNull();
    expect(SecureStorage.getPassword).not.toHaveBeenCalled();
  });

  it('does not read legacy localStorage for regular lookups', async () => {
    const getItemSpy = vi.spyOn(localStorage, 'getItem');
    localStorage.setItem('c64u_password', 'legacy-secret');
    localStorage.setItem('c64u_has_password', '1');

    vi.mocked(SecureStorage.getPassword).mockResolvedValueOnce({ value: 'secure-secret' });

    const value = await getPassword();

    expect(value).toBe('secure-secret');
    expect(getItemSpy).not.toHaveBeenCalledWith('c64u_password');
  });

  it('clears password and removes presence flag', async () => {
    localStorage.setItem('c64u_has_password', '1');

    await clearPassword();

    expect(localStorage.getItem('c64u_has_password')).toBeNull();
    expect(SecureStorage.clearPassword).toHaveBeenCalled();
  });
});
