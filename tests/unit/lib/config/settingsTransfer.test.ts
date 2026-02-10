/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportSettingsSnapshot, importSettingsJson } from '@/lib/config/settingsTransfer';
import * as appSettings from '@/lib/config/appSettings';
import * as deviceSafetySettings from '@/lib/config/deviceSafetySettings';

vi.mock('@/lib/config/appSettings', () => ({
    loadDebugLoggingEnabled: vi.fn(),
    loadConfigWriteIntervalMs: vi.fn(),
    loadAutomaticDemoModeEnabled: vi.fn(),
    loadStartupDiscoveryWindowMs: vi.fn(),
    loadBackgroundRediscoveryIntervalMs: vi.fn(),
    loadDiscoveryProbeTimeoutMs: vi.fn(),
    loadDiskAutostartMode: vi.fn(),
    
    saveDebugLoggingEnabled: vi.fn(),
    saveConfigWriteIntervalMs: vi.fn(),
    saveAutomaticDemoModeEnabled: vi.fn(),
    saveStartupDiscoveryWindowMs: vi.fn(),
    saveBackgroundRediscoveryIntervalMs: vi.fn(),
    saveDiscoveryProbeTimeoutMs: vi.fn(),
    saveDiskAutostartMode: vi.fn(),

    clampConfigWriteIntervalMs: (v: number) => v,
    clampStartupDiscoveryWindowMs: (v: number) => v,
    clampBackgroundRediscoveryIntervalMs: (v: number) => v,
    clampDiscoveryProbeTimeoutMs: (v: number) => v,
}));

vi.mock('@/lib/config/deviceSafetySettings', () => ({
    loadDeviceSafetyConfig: vi.fn(),
    
    saveDeviceSafetyMode: vi.fn(),
    saveRestMaxConcurrency: vi.fn(),
    saveFtpMaxConcurrency: vi.fn(),
    saveInfoCacheMs: vi.fn(),
    saveConfigsCacheMs: vi.fn(),
    saveConfigsCooldownMs: vi.fn(),
    saveDrivesCooldownMs: vi.fn(),
    saveFtpListCooldownMs: vi.fn(),
    saveBackoffBaseMs: vi.fn(),
    saveBackoffMaxMs: vi.fn(),
    saveBackoffFactor: vi.fn(),
    saveCircuitBreakerThreshold: vi.fn(),
    saveCircuitBreakerCooldownMs: vi.fn(),
    saveDiscoveryProbeIntervalMs: vi.fn(),
    saveAllowUserOverrideCircuit: vi.fn(),
}));

describe('settingsTransfer', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('exportSettingsSnapshot', () => {
        it('collects all settings', () => {
            vi.mocked(appSettings.loadDebugLoggingEnabled).mockReturnValue(true);
            vi.mocked(deviceSafetySettings.loadDeviceSafetyConfig).mockReturnValue({
                mode: 'RELAXED',
                // other props... spread mock return
            } as any);

            const result = exportSettingsSnapshot();
            expect(result.version).toBe(1);
            expect(result.appSettings.debugLoggingEnabled).toBe(true);
            expect(result.deviceSafety.mode).toBe('RELAXED');
        });
    });

    describe('importSettingsJson', () => {
        const validPayload = {
            version: 1,
            appSettings: {
                debugLoggingEnabled: true,
                configWriteIntervalMs: 1000,
                automaticDemoModeEnabled: false,
                startupDiscoveryWindowMs: 5000,
                backgroundRediscoveryIntervalMs: 60000,
                discoveryProbeTimeoutMs: 2000,
                diskAutostartMode: 'dma'
            },
            deviceSafety: {
                mode: 'BALANCED',
                restMaxConcurrency: 5,
                ftpMaxConcurrency: 2,
                infoCacheMs: 1000,
                configsCacheMs: 1000,
                configsCooldownMs: 100,
                drivesCooldownMs: 100,
                ftpListCooldownMs: 100,
                backoffBaseMs: 100,
                backoffMaxMs: 1000,
                backoffFactor: 2,
                circuitBreakerThreshold: 5,
                circuitBreakerCooldownMs: 5000,
                discoveryProbeIntervalMs: 10000,
                allowUserOverrideCircuit: true
            }
        };

        it('imports valid payload', () => {
            const result = importSettingsJson(JSON.stringify(validPayload));
            expect(result).toEqual({ ok: true });
            
            expect(appSettings.saveDebugLoggingEnabled).toHaveBeenCalledWith(true);
            expect(deviceSafetySettings.saveDeviceSafetyMode).toHaveBeenCalledWith('BALANCED');
        });

        it('rejects invalid JSON', () => {
            expect(importSettingsJson('{ bad')).toEqual({ ok: false, error: expect.stringMatching(/JSON/) });
        });

        it('rejects wrong version', () => {
            const invalid = { ...validPayload, version: 2 };
            expect(importSettingsJson(JSON.stringify(invalid))).toEqual({ ok: false, error: 'Unsupported settings export version.' });
        });

        it('validates appSettings structure', () => {
            const invalid = { ...validPayload, appSettings: { ...validPayload.appSettings, badKey: 1 } };
            expect(importSettingsJson(JSON.stringify(invalid))).toEqual({ ok: false, error: 'appSettings contains unknown or missing keys.' });
        });

        it('validates appSettings types', () => {
             const invalid = { ...validPayload, appSettings: { ...validPayload.appSettings, debugLoggingEnabled: 'true' } };
             expect(importSettingsJson(JSON.stringify(invalid))).toEqual({ ok: false, error: 'debugLoggingEnabled must be boolean.' });
        });
        
        it('validates deviceSafety types', () => {
             const invalid = { ...validPayload, deviceSafety: { ...validPayload.deviceSafety, mode: 'EXTREME' } };
             expect(importSettingsJson(JSON.stringify(invalid))).toEqual({ ok: false, error: 'deviceSafety.mode is invalid.' });
        });
    });
});
