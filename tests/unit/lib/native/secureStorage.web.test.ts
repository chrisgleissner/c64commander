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
