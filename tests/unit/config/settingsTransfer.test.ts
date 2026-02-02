import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadAutomaticDemoModeEnabled,
  loadBackgroundRediscoveryIntervalMs,
  loadConfigWriteIntervalMs,
  loadDebugLoggingEnabled,
  loadDiscoveryProbeTimeoutMs,
  loadDiskAutostartMode,
  loadStartupDiscoveryWindowMs,
} from '@/lib/config/appSettings';
import { loadDeviceSafetyConfig } from '@/lib/config/deviceSafetySettings';
import { exportSettingsSnapshot, importSettingsJson, SETTINGS_EXPORT_VERSION } from '@/lib/config/settingsTransfer';

describe('settingsTransfer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exports a versioned, whitelisted payload', () => {
    const snapshot = exportSettingsSnapshot();
    expect(snapshot.version).toBe(SETTINGS_EXPORT_VERSION);
    expect(snapshot.appSettings).toHaveProperty('debugLoggingEnabled');
    expect(snapshot.deviceSafety).toHaveProperty('mode');
    expect(JSON.stringify(snapshot)).not.toMatch(/password/i);
  });

  it('rejects unknown keys on import', () => {
    const payload = {
      version: SETTINGS_EXPORT_VERSION,
      appSettings: {
        debugLoggingEnabled: true,
        configWriteIntervalMs: 500,
        automaticDemoModeEnabled: true,
        startupDiscoveryWindowMs: 3000,
        backgroundRediscoveryIntervalMs: 5000,
        discoveryProbeTimeoutMs: 2500,
        diskAutostartMode: 'kernal',
        extra: 'nope',
      },
      deviceSafety: {
        mode: 'BALANCED',
        restMaxConcurrency: 1,
        ftpMaxConcurrency: 1,
        infoCacheMs: 600,
        configsCacheMs: 1200,
        configsCooldownMs: 600,
        drivesCooldownMs: 600,
        ftpListCooldownMs: 400,
        backoffBaseMs: 300,
        backoffMaxMs: 3000,
        backoffFactor: 1.8,
        circuitBreakerThreshold: 4,
        circuitBreakerCooldownMs: 3000,
        discoveryProbeIntervalMs: 700,
        allowUserOverrideCircuit: true,
      },
    };

    const result = importSettingsJson(JSON.stringify(payload));
    expect(result.ok).toBe(false);
  });

  it('imports settings and applies values', () => {
    const payload = {
      version: SETTINGS_EXPORT_VERSION,
      appSettings: {
        debugLoggingEnabled: false,
        configWriteIntervalMs: 800,
        automaticDemoModeEnabled: false,
        startupDiscoveryWindowMs: 4200,
        backgroundRediscoveryIntervalMs: 7000,
        discoveryProbeTimeoutMs: 3200,
        diskAutostartMode: 'dma',
      },
      deviceSafety: {
        mode: 'TROUBLESHOOTING',
        restMaxConcurrency: 1,
        ftpMaxConcurrency: 1,
        infoCacheMs: 400,
        configsCacheMs: 800,
        configsCooldownMs: 400,
        drivesCooldownMs: 400,
        ftpListCooldownMs: 300,
        backoffBaseMs: 200,
        backoffMaxMs: 1200,
        backoffFactor: 1.4,
        circuitBreakerThreshold: 2,
        circuitBreakerCooldownMs: 1500,
        discoveryProbeIntervalMs: 500,
        allowUserOverrideCircuit: false,
      },
    };

    const result = importSettingsJson(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    expect(loadDebugLoggingEnabled()).toBe(false);
    expect(loadConfigWriteIntervalMs()).toBe(800);
    expect(loadAutomaticDemoModeEnabled()).toBe(false);
    expect(loadStartupDiscoveryWindowMs()).toBe(4200);
    expect(loadBackgroundRediscoveryIntervalMs()).toBe(7000);
    expect(loadDiscoveryProbeTimeoutMs()).toBe(3200);
    expect(loadDiskAutostartMode()).toBe('dma');

    const safety = loadDeviceSafetyConfig();
    expect(safety.mode).toBe('TROUBLESHOOTING');
    expect(safety.allowUserOverrideCircuit).toBe(false);
  });

  it('rejects invalid JSON payloads', () => {
    const result = importSettingsJson('{bad json');
    expect(result.ok).toBe(false);
  });

  it('rejects unsupported versions', () => {
    const payload = {
      version: 999,
      appSettings: {},
      deviceSafety: {},
    };

    const result = importSettingsJson(JSON.stringify(payload));
    expect(result.ok).toBe(false);
  });

  it('rejects invalid disk autostart mode', () => {
    const payload = {
      version: SETTINGS_EXPORT_VERSION,
      appSettings: {
        debugLoggingEnabled: true,
        configWriteIntervalMs: 500,
        automaticDemoModeEnabled: true,
        startupDiscoveryWindowMs: 3000,
        backgroundRediscoveryIntervalMs: 5000,
        discoveryProbeTimeoutMs: 2500,
        diskAutostartMode: 'never',
      },
      deviceSafety: {
        mode: 'BALANCED',
        restMaxConcurrency: 1,
        ftpMaxConcurrency: 1,
        infoCacheMs: 600,
        configsCacheMs: 1200,
        configsCooldownMs: 600,
        drivesCooldownMs: 600,
        ftpListCooldownMs: 400,
        backoffBaseMs: 300,
        backoffMaxMs: 3000,
        backoffFactor: 1.8,
        circuitBreakerThreshold: 4,
        circuitBreakerCooldownMs: 3000,
        discoveryProbeIntervalMs: 700,
        allowUserOverrideCircuit: true,
      },
    };

    const result = importSettingsJson(JSON.stringify(payload));
    expect(result.ok).toBe(false);
  });
});
