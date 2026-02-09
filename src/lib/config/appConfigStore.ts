/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { ConfigResponse, buildBaseUrlFromDeviceHost, resolveDeviceHostFromStorage } from '@/lib/c64api';

export type ConfigSnapshot = {
  savedAt: string;
  data: Record<string, ConfigResponse>;
};

export type AppConfigEntry = {
  id: string;
  name: string;
  savedAt: string;
  baseUrl: string;
  data: Record<string, ConfigResponse>;
};

const APP_CONFIGS_KEY = 'c64u_app_configs';
const INITIAL_SNAPSHOT_PREFIX = 'c64u_initial_snapshot:';
const HAS_CHANGES_PREFIX = 'c64u_has_changes:';

const buildInitialSnapshotKey = (baseUrl: string) => `${INITIAL_SNAPSHOT_PREFIX}${baseUrl}`;
const buildHasChangesKey = (baseUrl: string) => `${HAS_CHANGES_PREFIX}${baseUrl}`;

const safeParse = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const getActiveBaseUrl = () => {
  const deviceHost = resolveDeviceHostFromStorage();
  return buildBaseUrlFromDeviceHost(deviceHost);
};

export const loadInitialSnapshot = (baseUrl: string): ConfigSnapshot | null => {
  const raw = localStorage.getItem(buildInitialSnapshotKey(baseUrl));
  return safeParse<ConfigSnapshot | null>(raw, null);
};

export const saveInitialSnapshot = (baseUrl: string, snapshot: ConfigSnapshot) => {
  localStorage.setItem(buildInitialSnapshotKey(baseUrl), JSON.stringify(snapshot));
};

export const loadHasChanges = (baseUrl: string): boolean =>
  localStorage.getItem(buildHasChangesKey(baseUrl)) === '1';

export const updateHasChanges = (baseUrl: string, value: boolean) => {
  localStorage.setItem(buildHasChangesKey(baseUrl), value ? '1' : '0');
  window.dispatchEvent(
    new CustomEvent('c64u-has-changes', { detail: { baseUrl, value } }),
  );
};

export const loadAppConfigs = (): AppConfigEntry[] =>
  safeParse<AppConfigEntry[]>(localStorage.getItem(APP_CONFIGS_KEY), []);

export const saveAppConfigs = (configs: AppConfigEntry[]) => {
  localStorage.setItem(APP_CONFIGS_KEY, JSON.stringify(configs));
};

export const listAppConfigs = (baseUrl: string): AppConfigEntry[] =>
  loadAppConfigs()
    .filter((entry) => entry.baseUrl === baseUrl)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));

export const createAppConfigEntry = (
  baseUrl: string,
  name: string,
  data: Record<string, ConfigResponse>,
): AppConfigEntry => {
  const id =
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto && crypto.randomUUID()) ||
    `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

  return {
    id,
    name,
    savedAt: new Date().toISOString(),
    baseUrl,
    data,
  };
};
