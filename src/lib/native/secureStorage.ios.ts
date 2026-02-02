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
