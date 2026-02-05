import { Capacitor } from '@capacitor/core';

type PlatformOverrideWindow = Window & { __c64uPlatformOverride?: string };

const allowPlatformOverride = () => {
  const env = (import.meta as ImportMeta).env as { VITE_ENABLE_TEST_PROBES?: string } | undefined;
  return env?.VITE_ENABLE_TEST_PROBES === '1';
};

export const getPlatform = () => {
  if (typeof window !== 'undefined' && allowPlatformOverride()) {
    const override = (window as PlatformOverrideWindow).__c64uPlatformOverride;
    if (override) return override;
    return 'web';
  }
  if (typeof (Capacitor as { getPlatform?: () => string }).getPlatform === 'function') {
    return Capacitor.getPlatform();
  }
  return 'web';
};

export const isNativePlatform = () => {
  if (typeof window === 'undefined') return false;
  try {
    if (allowPlatformOverride()) {
      const override = (window as PlatformOverrideWindow).__c64uPlatformOverride;
      if (override) return override !== 'web';
      return false;
    }
    if (typeof (Capacitor as { isNativePlatform?: () => boolean }).isNativePlatform === 'function') {
      return Capacitor.isNativePlatform();
    }
    const capacitor = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (typeof capacitor?.isNativePlatform === 'function') {
      return capacitor.isNativePlatform();
    }
  } catch {
    return false;
  }
  return false;
};
