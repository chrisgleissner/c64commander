/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  buildBaseUrlFromDeviceHost,
  getC64APIConfigSnapshot,
  normalizeDeviceHost,
  updateC64APIConfig,
} from '@/lib/c64api';
import type { DiscoveryTrigger } from '@/lib/connection/connectionManager';
import {
  discoverConnection,
  dismissDemoInterstitial,
} from '@/lib/connection/connectionManager';
import { addLog } from '@/lib/logging';

export const normalizeConfiguredHost = (input: string, fallbackHost: string) =>
  normalizeDeviceHost(input.trim() || fallbackHost);
export const getConfiguredHost = () => {
  if (typeof window === 'undefined') return 'c64u';
  try {
    return localStorage.getItem('c64u_device_host') || 'c64u';
  } catch (error) {
    const resolvedError =
      error instanceof Error ? error : new Error(String(error));
    addLog('warn', 'Failed to read configured host from storage', {
      error: resolvedError.message,
      stack: resolvedError.stack,
    });
    return 'c64u';
  }
};

export const saveConfiguredHostAndRetry = (
  input: string,
  fallbackHost: string,
  options: { dismissInterstitial?: boolean; trigger?: DiscoveryTrigger } = {},
) => {
  const host = normalizeConfiguredHost(input, fallbackHost);
  const currentPassword = getC64APIConfigSnapshot().password;
  updateC64APIConfig(buildBaseUrlFromDeviceHost(host), currentPassword, host);
  if (options.dismissInterstitial) {
    dismissDemoInterstitial();
  }
  void discoverConnection(options.trigger ?? 'settings');
  return host;
};
