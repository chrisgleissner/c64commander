import { beforeEach, describe, expect, it } from 'vitest';
import type { DeviceSafetyMode } from '@/lib/config/deviceSafetySettings';
import {
    loadDeviceSafetyConfig,
    saveDeviceSafetyMode,
    saveFtpMaxConcurrency,
    saveRestMaxConcurrency,
} from '@/lib/config/deviceSafetySettings';

type ExpectedDefaults = {
    restMaxConcurrency: number;
    ftpMaxConcurrency: number;
    backoffBaseMs: number;
    backoffMaxMs: number;
    backoffFactor: number;
    circuitBreakerThreshold: number;
    circuitBreakerCooldownMs: number;
};

const MODE_EXPECTATIONS: Record<DeviceSafetyMode, ExpectedDefaults> = {
    RELAXED: {
        restMaxConcurrency: 2,
        ftpMaxConcurrency: 2,
        backoffBaseMs: 150,
        backoffMaxMs: 1500,
        backoffFactor: 1.5,
        circuitBreakerThreshold: 6,
        circuitBreakerCooldownMs: 2000,
    },
    BALANCED: {
        restMaxConcurrency: 2,
        ftpMaxConcurrency: 1,
        backoffBaseMs: 300,
        backoffMaxMs: 3000,
        backoffFactor: 1.8,
        circuitBreakerThreshold: 4,
        circuitBreakerCooldownMs: 4000,
    },
    CONSERVATIVE: {
        restMaxConcurrency: 1,
        ftpMaxConcurrency: 1,
        backoffBaseMs: 500,
        backoffMaxMs: 6000,
        backoffFactor: 2,
        circuitBreakerThreshold: 2,
        circuitBreakerCooldownMs: 6000,
    },
    TROUBLESHOOTING: {
        restMaxConcurrency: 1,
        ftpMaxConcurrency: 1,
        backoffBaseMs: 200,
        backoffMaxMs: 1200,
        backoffFactor: 1.4,
        circuitBreakerThreshold: 2,
        circuitBreakerCooldownMs: 2000,
    },
};

describe('deviceSafetySettings defaults', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it.each(Object.entries(MODE_EXPECTATIONS))('loads %s defaults', (mode, expected) => {
        saveDeviceSafetyMode(mode as DeviceSafetyMode);

        const config = loadDeviceSafetyConfig();

        expect(config.restMaxConcurrency).toBe(expected.restMaxConcurrency);
        expect(config.ftpMaxConcurrency).toBe(expected.ftpMaxConcurrency);
        expect(config.backoffBaseMs).toBe(expected.backoffBaseMs);
        expect(config.backoffMaxMs).toBe(expected.backoffMaxMs);
        expect(config.backoffFactor).toBeCloseTo(expected.backoffFactor, 6);
        expect(config.circuitBreakerThreshold).toBe(expected.circuitBreakerThreshold);
        expect(config.circuitBreakerCooldownMs).toBe(expected.circuitBreakerCooldownMs);
    });

    it('keeps REST and FTP concurrency independent', () => {
        saveDeviceSafetyMode('BALANCED');

        saveRestMaxConcurrency(4);
        let config = loadDeviceSafetyConfig();
        expect(config.restMaxConcurrency).toBe(4);
        expect(config.ftpMaxConcurrency).toBe(1);

        saveFtpMaxConcurrency(3);
        config = loadDeviceSafetyConfig();
        expect(config.restMaxConcurrency).toBe(4);
        expect(config.ftpMaxConcurrency).toBe(3);
    });
});
