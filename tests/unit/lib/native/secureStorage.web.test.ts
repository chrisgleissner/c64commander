/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { SecureStorageWeb } from '@/lib/native/secureStorage.web';

describe('SecureStorageWeb', () => {
  it('stores and clears passwords in memory', async () => {
    const storage = new SecureStorageWeb();

    await storage.setPassword({ value: 'secret' });
    await expect(storage.getPassword()).resolves.toEqual({ value: 'secret' });

    await storage.clearPassword();
    await expect(storage.getPassword()).resolves.toEqual({ value: null });
  });
});
