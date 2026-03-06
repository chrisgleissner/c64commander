/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import {
  formatActionDuration,
  formatActionEffectTarget,
  formatActionSummaryOrigin,
  formatTriggerDisplay,
} from '@/lib/diagnostics/actionSummaryDisplay';

describe('formatActionSummaryOrigin', () => {
  it('returns "unknown" for null/undefined origin', () => {
    expect(formatActionSummaryOrigin(null)).toBe('unknown');
    expect(formatActionSummaryOrigin(undefined)).toBe('unknown');
  });

  it('returns origin unchanged when no originalOrigin', () => {
    expect(formatActionSummaryOrigin('user')).toBe('user');
    expect(formatActionSummaryOrigin('system')).toBe('system');
  });

  it('formats origin with arrow when originalOrigin differs', () => {
    expect(formatActionSummaryOrigin('system', 'automatic')).toBe(
      'automatic → system',
    );
  });
});

describe('formatActionEffectTarget', () => {
  it('lowercases normal targets', () => {
    expect(formatActionEffectTarget('EMULATOR')).toBe('emulator');
  });

  it('maps real-device to device fallback when product is unavailable', () => {
    expect(formatActionEffectTarget('real-device')).toBe('device');
    expect(formatActionEffectTarget('Real-Device')).toBe('device');
  });

  it('maps real-device using transformed /v1/info product values', () => {
    expect(formatActionEffectTarget('real-device', 'c64u')).toBe('c64u');
    expect(formatActionEffectTarget('real-device', 'C64U')).toBe('c64u');
    expect(formatActionEffectTarget('real-device', 'u64')).toBe('u64');
    expect(formatActionEffectTarget('real-device', 'U64')).toBe('u64');
    expect(formatActionEffectTarget('real-device', 'Ultimate 64')).toBe('u64');
    expect(formatActionEffectTarget('real-device', 'Ultimate 64 Elite')).toBe(
      'u64e',
    );
    expect(formatActionEffectTarget('real-device', 'Ultimate 64-II')).toBe(
      'u64e2',
    );
    expect(formatActionEffectTarget('real-device', 'u64e')).toBe('u64e');
    expect(formatActionEffectTarget('real-device', 'U64E')).toBe('u64e');
    expect(formatActionEffectTarget('real-device', 'u64e2')).toBe('u64e2');
    expect(formatActionEffectTarget('real-device', 'U64E2')).toBe('u64e2');
    expect(formatActionEffectTarget('real-device', 'C64 Ultimate')).toBe(
      'c64u',
    );
    expect(formatActionEffectTarget('real-device', 'unknown-model')).toBe(
      'device',
    );
  });

  it('maps internal and external mocks to demo/sandbox labels', () => {
    expect(formatActionEffectTarget('internal-mock')).toBe('demo');
    expect(formatActionEffectTarget('external-mock')).toBe('sandbox');
    expect(formatActionEffectTarget('mock')).toBe('demo');
  });

  it('never renders mock and never falls back to c64', () => {
    expect(formatActionEffectTarget('internal-mock')).not.toContain('mock');
    expect(formatActionEffectTarget('external-mock')).not.toContain('mock');
    expect(formatActionEffectTarget('mock')).not.toContain('mock');
    expect(formatActionEffectTarget('real-device', 'unknown-model')).toBe(
      'device',
    );
  });

  it('returns "unknown" for null/undefined', () => {
    expect(formatActionEffectTarget(null)).toBe('unknown');
    expect(formatActionEffectTarget(undefined)).toBe('unknown');
  });
});

describe('formatTriggerDisplay', () => {
  it('formats trigger with kind only when name matches', () => {
    expect(formatTriggerDisplay({ kind: 'timer', name: 'timer' })).toBe(
      'timer',
    );
  });

  it('includes name suffix when name differs from kind', () => {
    expect(
      formatTriggerDisplay({ kind: 'timer', name: 'connectivity.probe' }),
    ).toBe('timer (connectivity.probe)');
  });

  it('includes interval when present', () => {
    expect(
      formatTriggerDisplay({
        kind: 'timer',
        name: 'connectivity.probe',
        intervalMs: 5000,
      }),
    ).toBe('timer (connectivity.probe) · 5000ms');
  });

  it('omits interval when null', () => {
    expect(
      formatTriggerDisplay({
        kind: 'timer',
        name: 'connectivity.probe',
        intervalMs: null,
      }),
    ).toBe('timer (connectivity.probe)');
  });
});

describe('formatActionDuration', () => {
  it('returns em-dash for null/undefined/NaN/negative', () => {
    expect(formatActionDuration(null)).toBe('—');
    expect(formatActionDuration(undefined)).toBe('—');
    expect(formatActionDuration(NaN)).toBe('—');
    expect(formatActionDuration(-1)).toBe('—');
    expect(formatActionDuration(Infinity)).toBe('—');
    expect(formatActionDuration(-Infinity)).toBe('—');
  });

  it('formats sub-second durations as Nms', () => {
    expect(formatActionDuration(0)).toBe('0ms');
    expect(formatActionDuration(1)).toBe('1ms');
    expect(formatActionDuration(500)).toBe('500ms');
    expect(formatActionDuration(999)).toBe('999ms');
    expect(formatActionDuration(999.4)).toBe('999ms');
    expect(formatActionDuration(999.5)).toBe('1.0s');
  });

  it('formats seconds with one decimal as N.Ns', () => {
    expect(formatActionDuration(1000)).toBe('1.0s');
    expect(formatActionDuration(1500)).toBe('1.5s');
    expect(formatActionDuration(9999)).toBe('10.0s');
    expect(formatActionDuration(59900)).toBe('59.9s');
  });

  it('formats minute-range as NmNs', () => {
    expect(formatActionDuration(100_000)).toBe('1m40s');
    expect(formatActionDuration(120_000)).toBe('2m0s');
    expect(formatActionDuration(3_599_000)).toBe('59m59s');
  });

  it('formats hour-range as NhNm', () => {
    expect(formatActionDuration(3_600_000)).toBe('1h0m');
    expect(formatActionDuration(7_260_000)).toBe('2h1m');
    expect(formatActionDuration(356_400_000)).toBe('99h0m');
  });

  it('formats 100+ hours as Nh', () => {
    expect(formatActionDuration(360_000_000)).toBe('100h');
    expect(formatActionDuration(3_600_000_000)).toBe('1000h');
  });

  it('never exceeds 6 characters', () => {
    const testCases = [
      0, 1, 500, 999, 1000, 9999, 59900, 99949, 100_000, 3_599_000, 3_600_000,
      356_400_000, 360_000_000,
    ];
    for (const ms of testCases) {
      const result = formatActionDuration(ms);
      expect(result.length).toBeLessThanOrEqual(6);
    }
  });
});
