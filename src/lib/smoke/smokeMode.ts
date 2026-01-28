import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { addLog } from '@/lib/logging';
import { saveDebugLoggingEnabled } from '@/lib/config/appSettings';
import { normalizeDeviceHost } from '@/lib/c64api';

const SMOKE_CONFIG_STORAGE_KEY = 'c64u_smoke_config';
const SMOKE_MODE_STORAGE_KEY = 'c64u_smoke_mode_enabled';
const SMOKE_CONFIG_FILENAME = 'c64u-smoke.json';
const SMOKE_STATUS_FILENAME = 'c64u-smoke-status.json';

export type SmokeTarget = 'mock' | 'real';
export type SmokeConfig = {
  target: SmokeTarget;
  host?: string;
  readOnly?: boolean;
  debugLogging?: boolean;
};

let cachedSmokeConfig: SmokeConfig | null = null;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parseSmokeConfig = (raw: unknown): SmokeConfig | null => {
  if (!isObject(raw)) return null;
  const target = raw.target === 'real' ? 'real' : raw.target === 'mock' ? 'mock' : null;
  if (!target) return null;
  const host = typeof raw.host === 'string' && raw.host.trim().length > 0 ? normalizeDeviceHost(raw.host) : undefined;
  const readOnly = typeof raw.readOnly === 'boolean' ? raw.readOnly : true;
  const debugLogging = typeof raw.debugLogging === 'boolean' ? raw.debugLogging : true;
  return { target, host, readOnly, debugLogging };
};

const readSmokeConfigFromStorage = (): SmokeConfig | null => {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(SMOKE_CONFIG_STORAGE_KEY);
  if (!raw) return null;
  try {
    return parseSmokeConfig(JSON.parse(raw));
  } catch {
    return null;
  }
};

const writeSmokeConfigToStorage = (config: SmokeConfig) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SMOKE_CONFIG_STORAGE_KEY, JSON.stringify(config));
  localStorage.setItem(SMOKE_MODE_STORAGE_KEY, '1');
};

export const isSmokeModeEnabled = () => Boolean(cachedSmokeConfig);

export const getSmokeConfig = () => cachedSmokeConfig;

export const isSmokeReadOnlyEnabled = () => cachedSmokeConfig?.readOnly !== false;

export const initializeSmokeMode = async (): Promise<SmokeConfig | null> => {
  cachedSmokeConfig = null;

  let config = readSmokeConfigFromStorage();

  if (!config && Capacitor.isNativePlatform()) {
    try {
      const result = await Filesystem.readFile({
        path: SMOKE_CONFIG_FILENAME,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      config = parseSmokeConfig(JSON.parse(result.data));
    } catch {
      config = null;
    }
  }

  if (!config) return null;

  cachedSmokeConfig = config;
  writeSmokeConfigToStorage(config);

  if (config.debugLogging) {
    saveDebugLoggingEnabled(true);
  }

  if (config.host && typeof localStorage !== 'undefined') {
    localStorage.setItem('c64u_device_host', config.host);
  }

  addLog('info', 'Smoke mode enabled', { target: config.target, host: config.host, readOnly: config.readOnly });
  console.info('C64U_SMOKE_ENABLED', JSON.stringify({ target: config.target, host: config.host, readOnly: config.readOnly }));

  return config;
};

export const recordSmokeStatus = async (status: { state: string; mode?: string; baseUrl?: string }) => {
  if (!cachedSmokeConfig || !Capacitor.isNativePlatform()) return;
  try {
    await Filesystem.writeFile({
      path: SMOKE_STATUS_FILENAME,
      directory: Directory.Data,
      data: JSON.stringify({
        ...status,
        updatedAt: new Date().toISOString(),
      }),
      encoding: Encoding.UTF8,
    });
  } catch {
    // ignore
  }
};
