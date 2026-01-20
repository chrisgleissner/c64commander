import { FeatureFlags as FeatureFlagsPlugin } from '@/lib/native/featureFlags';
import { addErrorLog } from '@/lib/logging';

export const FEATURE_FLAG_DEFINITIONS = {
  hvsc_enabled: {
    defaultValue: false,
  },
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAG_DEFINITIONS;
export type FeatureFlags = Record<FeatureFlagKey, boolean>;

export type FeatureFlagSnapshot = {
  flags: FeatureFlags;
  isLoaded: boolean;
};

export type FeatureFlagListener = (snapshot: FeatureFlagSnapshot) => void;

export interface FeatureFlagRepository {
  getFlag: (key: FeatureFlagKey) => Promise<boolean | null>;
  getAllFlags: (keys: FeatureFlagKey[]) => Promise<Partial<FeatureFlags>>;
  setFlag: (key: FeatureFlagKey, value: boolean) => Promise<void>;
}

export class PluginFeatureFlagRepository implements FeatureFlagRepository {
  async getFlag(key: FeatureFlagKey): Promise<boolean | null> {
    const result = await FeatureFlagsPlugin.getFlag({ key });
    if (typeof result.value === 'boolean') return result.value;
    return null;
  }

  async getAllFlags(keys: FeatureFlagKey[]): Promise<Partial<FeatureFlags>> {
    const result = await FeatureFlagsPlugin.getAllFlags({ keys });
    return result.flags ?? {};
  }

  async setFlag(key: FeatureFlagKey, value: boolean): Promise<void> {
    await FeatureFlagsPlugin.setFlag({ key, value });
  }
}

export class InMemoryFeatureFlagRepository implements FeatureFlagRepository {
  private store = new Map<FeatureFlagKey, boolean>();

  constructor(initial: Partial<FeatureFlags> = {}) {
    (Object.entries(initial) as Array<[FeatureFlagKey, boolean]>).forEach(([key, value]) => {
      this.store.set(key, value);
    });
  }

  async getFlag(key: FeatureFlagKey): Promise<boolean | null> {
    return this.store.has(key) ? this.store.get(key) ?? null : null;
  }

  async getAllFlags(keys: FeatureFlagKey[]): Promise<Partial<FeatureFlags>> {
    const flags: Partial<FeatureFlags> = {};
    keys.forEach((key) => {
      if (this.store.has(key)) {
        flags[key] = this.store.get(key) ?? false;
      }
    });
    return flags;
  }

  async setFlag(key: FeatureFlagKey, value: boolean): Promise<void> {
    this.store.set(key, value);
  }
}

const buildDefaultFlags = (): FeatureFlags => {
  const defaults: Partial<FeatureFlags> = {};
  (Object.keys(FEATURE_FLAG_DEFINITIONS) as FeatureFlagKey[]).forEach((key) => {
    defaults[key] = FEATURE_FLAG_DEFINITIONS[key].defaultValue;
  });
  return defaults as FeatureFlags;
};

export class FeatureFlagManager {
  private snapshot: FeatureFlagSnapshot;
  private listeners = new Set<FeatureFlagListener>();
  private isLoading = false;

  constructor(private repository: FeatureFlagRepository, private defaults: FeatureFlags) {
    this.snapshot = { flags: { ...defaults }, isLoaded: false };
  }

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: FeatureFlagListener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async load() {
    if (this.isLoading || this.snapshot.isLoaded) return;
    this.isLoading = true;
    try {
      const keys = Object.keys(this.defaults) as FeatureFlagKey[];
      const stored = await this.repository.getAllFlags(keys);
      this.snapshot = {
        flags: { ...this.defaults, ...stored },
        isLoaded: true,
      };
      this.emit();
    } catch (error) {
      addErrorLog('Feature flag load failed', { error: (error as Error).message });
      this.snapshot = { flags: { ...this.defaults }, isLoaded: true };
      this.emit();
    } finally {
      this.isLoading = false;
    }
  }

  async setFlag(key: FeatureFlagKey, value: boolean) {
    try {
      await this.repository.setFlag(key, value);
      this.snapshot = {
        ...this.snapshot,
        flags: { ...this.snapshot.flags, [key]: value },
      };
      this.emit();
    } catch (error) {
      addErrorLog('Feature flag update failed', { key, error: (error as Error).message });
      throw error;
    }
  }

  private emit() {
    this.listeners.forEach((listener) => listener(this.snapshot));
  }
}

export const featureFlagManager = new FeatureFlagManager(
  new PluginFeatureFlagRepository(),
  buildDefaultFlags(),
);

export const isHvscEnabled = (flags: FeatureFlags) => Boolean(flags.hvsc_enabled);
