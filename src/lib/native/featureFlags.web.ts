import type { FeatureFlagsPlugin } from './featureFlags';

const FLAG_PREFIX = 'c64u_feature_flag:';

const buildKey = (key: string) => `${FLAG_PREFIX}${key}`;

export class FeatureFlagsWeb implements FeatureFlagsPlugin {
  async getFlag(options: { key: string }): Promise<{ value?: boolean }> {
    const stored = localStorage.getItem(buildKey(options.key));
    if (stored === null) return {};
    return { value: stored === '1' };
  }

  async setFlag(options: { key: string; value: boolean }): Promise<void> {
    localStorage.setItem(buildKey(options.key), options.value ? '1' : '0');
  }

  async getAllFlags(options: { keys: string[] }): Promise<{ flags?: Record<string, boolean> }> {
    const flags: Record<string, boolean> = {};
    options.keys.forEach((key) => {
      const stored = localStorage.getItem(buildKey(key));
      if (stored !== null) {
        flags[key] = stored === '1';
      }
    });
    return { flags };
  }
}
