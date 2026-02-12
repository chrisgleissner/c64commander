/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin } from '@capacitor/core';

export type SecureStoragePlugin = {
  setPassword: (options: { value: string }) => Promise<void>;
  getPassword: () => Promise<{ value: string | null }>;
  clearPassword: () => Promise<void>;
};

export const SecureStorage = registerPlugin<SecureStoragePlugin>('SecureStorage', {
  web: () => import('./secureStorage.web').then((module) => new module.SecureStorageWeb()),
});
