import { Capacitor } from '@capacitor/core';

type PlatformOverrideWindow = Window & { __c64uPlatformOverride?: string };

const allowPlatformOverride = () => import.meta.env.VITE_ENABLE_TEST_PROBES === '1';

export const getPlatform = () => {
  if (typeof window !== 'undefined' && allowPlatformOverride()) {
    const override = (window as PlatformOverrideWindow).__c64uPlatformOverride;
    if (override) return override;
  }
  return Capacitor.getPlatform();
};
