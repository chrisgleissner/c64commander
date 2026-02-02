import { registerPlugin } from '@capacitor/core';

export type SecureStoragePlugin = {
  setPassword: (options: { value: string }) => Promise<void>;
  getPassword: () => Promise<{ value: string | null }>;
  clearPassword: () => Promise<void>;
};

export const SecureStorage = registerPlugin<SecureStoragePlugin>('SecureStorage', {
  web: () => import('./secureStorage.web').then((module) => new module.SecureStorageWeb()),
  ios: () => import('./secureStorage.ios').then((module) => new module.SecureStorageIOS()),
});
