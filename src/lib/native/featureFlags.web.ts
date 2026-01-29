import type { FeatureFlagsPlugin } from './featureFlags';

const FLAG_PREFIX = 'c64u_feature_flag:';

const buildKey = (key: string) => `${FLAG_PREFIX}${key}`;

export class FeatureFlagsWeb implements FeatureFlagsPlugin {
  async getFlag(options: { key: string }): Promise<{ value?: boolean }> {
    const key = buildKey(options.key);
    const stored = localStorage.getItem(key) ?? sessionStorage.getItem(key);
    if (stored === null) return {};
    return { value: stored === '1' };
  }

  async setFlag(options: { key: string; value: boolean }): Promise<void> {
    const key = buildKey(options.key);
    const value = options.value ? '1' : '0';
    localStorage.setItem(key, value);
    sessionStorage.setItem(key, value);
  }

  async getAllFlags(options: { keys: string[] }): Promise<{ flags?: Record<string, boolean> }> {
    const flags: Record<string, boolean> = {};
    options.keys.forEach((key) => {
      const storageKey = buildKey(key);
      const stored = localStorage.getItem(storageKey) ?? sessionStorage.getItem(storageKey);
      if (stored !== null) {
        flags[key] = stored === '1';
      }
    });
    return { flags };
  }
}
