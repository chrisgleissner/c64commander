import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTO_DEMO_MODE_ENABLED,
  DEFAULT_BACKGROUND_REDISCOVERY_INTERVAL_MS,
  DEFAULT_CONFIG_WRITE_INTERVAL_MS,
  DEFAULT_DISCOVERY_PROBE_TIMEOUT_MS,
  DEFAULT_DISK_AUTOSTART_MODE,
  DEFAULT_STARTUP_DISCOVERY_WINDOW_MS,
  APP_SETTINGS_KEYS,
  loadAutomaticDemoModeEnabled,
  loadBackgroundRediscoveryIntervalMs,
  loadDiscoveryProbeTimeoutMs,
  loadConfigWriteIntervalMs,
  loadDebugLoggingEnabled,
  loadDiskAutostartMode,
  loadStartupDiscoveryWindowMs,
  saveAutomaticDemoModeEnabled,
  saveBackgroundRediscoveryIntervalMs,
  saveDiscoveryProbeTimeoutMs,
  saveConfigWriteIntervalMs,
  saveDebugLoggingEnabled,
  saveDiskAutostartMode,
  saveStartupDiscoveryWindowMs,
} from '@/lib/config/appSettings';

const collectSettingEvents = () => {
  const events: Array<{ key: string; value: unknown }> = [];
  const listener = (event: Event) => {
    const detail = (event as CustomEvent).detail as { key: string; value: unknown };
    events.push(detail);
  };
  window.addEventListener('c64u-app-settings-updated', listener);
  return {
    events,
    dispose: () => window.removeEventListener('c64u-app-settings-updated', listener),
  };
};

describe('appSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads defaults when local storage is empty', () => {
    expect(loadDebugLoggingEnabled()).toBe(false);
    expect(loadConfigWriteIntervalMs()).toBe(DEFAULT_CONFIG_WRITE_INTERVAL_MS);
    expect(loadAutomaticDemoModeEnabled()).toBe(DEFAULT_AUTO_DEMO_MODE_ENABLED);
    expect(loadStartupDiscoveryWindowMs()).toBe(DEFAULT_STARTUP_DISCOVERY_WINDOW_MS);
    expect(loadBackgroundRediscoveryIntervalMs()).toBe(DEFAULT_BACKGROUND_REDISCOVERY_INTERVAL_MS);
    expect(loadDiscoveryProbeTimeoutMs()).toBe(DEFAULT_DISCOVERY_PROBE_TIMEOUT_MS);
    expect(loadDiskAutostartMode()).toBe(DEFAULT_DISK_AUTOSTART_MODE);
  });

  it('saves values and emits setting events', () => {
    const { events, dispose } = collectSettingEvents();

    saveDebugLoggingEnabled(true);
    saveConfigWriteIntervalMs(432);
    saveAutomaticDemoModeEnabled(false);
    saveStartupDiscoveryWindowMs(3499);
    saveBackgroundRediscoveryIntervalMs(800);
    saveDiscoveryProbeTimeoutMs(2780);
    saveDiskAutostartMode('dma');

    dispose();

    expect(localStorage.getItem(APP_SETTINGS_KEYS.DEBUG_LOGGING_KEY)).toBe('1');
    expect(localStorage.getItem(APP_SETTINGS_KEYS.CONFIG_WRITE_INTERVAL_KEY)).toBe('400');
    expect(localStorage.getItem(APP_SETTINGS_KEYS.AUTO_DEMO_MODE_KEY)).toBe('0');
    expect(localStorage.getItem(APP_SETTINGS_KEYS.STARTUP_DISCOVERY_WINDOW_MS_KEY)).toBe('3500');
    expect(localStorage.getItem(APP_SETTINGS_KEYS.BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY)).toBe('1000');
    expect(localStorage.getItem(APP_SETTINGS_KEYS.DISCOVERY_PROBE_TIMEOUT_MS_KEY)).toBe('2800');
    expect(localStorage.getItem(APP_SETTINGS_KEYS.DISK_AUTOSTART_MODE_KEY)).toBe('dma');

    expect(events).toEqual(expect.arrayContaining([
      { key: APP_SETTINGS_KEYS.DEBUG_LOGGING_KEY, value: true },
      { key: APP_SETTINGS_KEYS.CONFIG_WRITE_INTERVAL_KEY, value: 400 },
      { key: APP_SETTINGS_KEYS.AUTO_DEMO_MODE_KEY, value: false },
      { key: APP_SETTINGS_KEYS.STARTUP_DISCOVERY_WINDOW_MS_KEY, value: 3500 },
      { key: APP_SETTINGS_KEYS.BACKGROUND_REDISCOVERY_INTERVAL_MS_KEY, value: 1000 },
      { key: APP_SETTINGS_KEYS.DISCOVERY_PROBE_TIMEOUT_MS_KEY, value: 2800 },
      { key: APP_SETTINGS_KEYS.DISK_AUTOSTART_MODE_KEY, value: 'dma' },
    ]));
  });

  it('normalizes disk autostart mode input', () => {
    localStorage.setItem(APP_SETTINGS_KEYS.DISK_AUTOSTART_MODE_KEY, 'invalid');
    expect(loadDiskAutostartMode()).toBe('kernal');

    saveDiskAutostartMode('kernal');
    expect(loadDiskAutostartMode()).toBe('kernal');
  });
});
