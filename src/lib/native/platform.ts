/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor } from '@capacitor/core';

type PlatformOverrideWindow = Window & { __c64uPlatformOverride?: string };

const allowPlatformOverride = () => {
  const env = (import.meta as ImportMeta).env as { VITE_ENABLE_TEST_PROBES?: string } | undefined;
  if (env?.VITE_ENABLE_TEST_PROBES === '1') return true;
  if (typeof process !== 'undefined' && process.env?.VITE_ENABLE_TEST_PROBES === '1') return true;
  return false;
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
