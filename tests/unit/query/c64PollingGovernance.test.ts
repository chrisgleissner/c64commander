import { describe, expect, it, vi } from 'vitest';
import {
    getBackgroundRediscoveryDelayMs,
    getInfoRefreshMinIntervalMs,
    getNextBackgroundFailureCount,
    shouldRunRateLimited,
} from '@/lib/query/c64PollingGovernance';

vi.mock('@/lib/config/deviceSafetySettings', () => ({
    loadDeviceSafetyConfig: () => ({
        mode: 'BALANCED',
        restMaxConcurrency: 2,
        ftpMaxConcurrency: 1,
        infoCacheMs: 600,
        configsCacheMs: 1000,
        configsCooldownMs: 500,
        drivesCooldownMs: 500,
        ftpListCooldownMs: 300,
        backoffBaseMs: 300,
        backoffMaxMs: 3000,
        backoffFactor: 1.8,
        circuitBreakerThreshold: 4,
        circuitBreakerCooldownMs: 4000,
        discoveryProbeIntervalMs: 700,
        allowUserOverrideCircuit: true,
    }),
}));

describe('c64PollingGovernance', () => {
    it('derives a bounded info refresh interval from device safety config', () => {
        expect(getInfoRefreshMinIntervalMs()).toBe(1500);
    });

    it('rate-limits repeated refreshes within min interval', () => {
        const now = 10_000;
        expect(shouldRunRateLimited(null, 1500, now)).toBe(true);
        expect(shouldRunRateLimited(now, 1500, now + 1499)).toBe(false);
        expect(shouldRunRateLimited(now, 1500, now + 1500)).toBe(true);
    });

    it('resets failure count when probe succeeds after failures', () => {
        expect(
            getNextBackgroundFailureCount(3, {
                lastProbeSucceededAtMs: 20_000,
                lastProbeFailedAtMs: 19_000,
            }),
        ).toBe(0);
    });

    it('increments and caps failure count when probes keep failing', () => {
        expect(
            getNextBackgroundFailureCount(0, {
                lastProbeSucceededAtMs: null,
                lastProbeFailedAtMs: 10_000,
            }),
        ).toBe(1);
        expect(
            getNextBackgroundFailureCount(6, {
                lastProbeSucceededAtMs: null,
                lastProbeFailedAtMs: 12_000,
            }),
        ).toBe(6);
    });

    it('applies exponential backoff with a hard delay ceiling', () => {
        expect(getBackgroundRediscoveryDelayMs(5000, 0)).toBe(5000);
        expect(getBackgroundRediscoveryDelayMs(5000, 1)).toBe(10000);
        expect(getBackgroundRediscoveryDelayMs(5000, 2)).toBe(20000);
        expect(getBackgroundRediscoveryDelayMs(5000, 4)).toBe(60000);
        expect(getBackgroundRediscoveryDelayMs(5000, 6)).toBe(60000);
    });
});
