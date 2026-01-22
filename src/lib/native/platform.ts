import { Capacitor } from '@capacitor/core';

type PlatformOverrideWindow = Window & { __c64uPlatformOverride?: string };

export const getPlatform = () => {
  if (typeof window !== 'undefined') {
    const override = (window as PlatformOverrideWindow).__c64uPlatformOverride;
    if (override) return override;
  }
  return Capacitor.getPlatform();
};
