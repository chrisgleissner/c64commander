import { registerPlugin } from '@capacitor/core';

export type FeatureFlagsPlugin = {
  getFlag: (options: { key: string }) => Promise<{ value?: boolean }>;
  setFlag: (options: { key: string; value: boolean }) => Promise<void>;
  getAllFlags: (options: { keys: string[] }) => Promise<{ flags?: Record<string, boolean> }>;
};

export const FeatureFlags = registerPlugin<FeatureFlagsPlugin>('FeatureFlags', {
  web: () => import('./featureFlags.web').then((module) => new module.FeatureFlagsWeb()),
});
