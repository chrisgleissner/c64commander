/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearHealthHistory,
  getHealthHistory,
  healthHistorySize,
  pushHealthHistoryEntry,
  type HealthHistoryEntry,
} from '@/lib/diagnostics/healthHistory';

const makeEntry = (overrideTimestamp?: string): HealthHistoryEntry => ({
  timestamp: overrideTimestamp ?? new Date().toISOString(),
  overallHealth: 'Healthy',
  durationMs: 100,
  probes: {
    rest: { outcome: 'Success', durationMs: 30, reason: null },
    jiffy: { outcome: 'Success', durationMs: 20, reason: null },
    raster: { outcome: 'Success', durationMs: 10, reason: null },
    config: { outcome: 'Success', durationMs: 25, reason: null },
    ftp: { outcome: 'Success', durationMs: 15, reason: null },
  },
  latency: { p50: 30, p90: 50, p99: 80 },
});

beforeEach(() => {
  clearHealthHistory();
});

describe('pushHealthHistoryEntry', () => {
  it('adds a single entry retrievable via getHealthHistory', () => {
    const entry = makeEntry('2026-01-01T00:00:00.000Z');
    pushHealthHistoryEntry(entry);
    expect(getHealthHistory()).toHaveLength(1);
    expect(getHealthHistory()[0].timestamp).toBe('2026-01-01T00:00:00.000Z');
  });

  it('appends entries in chronological order', () => {
    pushHealthHistoryEntry(makeEntry('2026-01-01T00:00:00.000Z'));
    pushHealthHistoryEntry(makeEntry('2026-01-01T00:01:00.000Z'));
    const history = getHealthHistory();
    expect(history).toHaveLength(2);
    expect(history[0].timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(history[1].timestamp).toBe('2026-01-01T00:01:00.000Z');
  });

  it('evicts oldest entry when over capacity (MAX_ENTRIES = 500)', () => {
    // Fill to capacity
    for (let i = 0; i < 500; i++) {
      pushHealthHistoryEntry(makeEntry(`2026-01-01T00:${String(i).padStart(2, '0')}:00.000Z`));
    }
    expect(healthHistorySize()).toBe(500);

    // Push one more — oldest is evicted
    pushHealthHistoryEntry(makeEntry('2026-01-02T00:00:00.000Z'));
    expect(healthHistorySize()).toBe(500);

    // The newest entry is last
    const history = getHealthHistory();
    expect(history[499].timestamp).toBe('2026-01-02T00:00:00.000Z');

    // The first entry (index 0) was the second-oldest after eviction
    expect(history[0].timestamp).toBe('2026-01-01T00:01:00.000Z');
  });
});

describe('clearHealthHistory', () => {
  it('removes all entries', () => {
    pushHealthHistoryEntry(makeEntry());
    pushHealthHistoryEntry(makeEntry());
    clearHealthHistory();
    expect(healthHistorySize()).toBe(0);
    expect(getHealthHistory()).toHaveLength(0);
  });
});

describe('healthHistorySize', () => {
  it('returns 0 when empty', () => {
    expect(healthHistorySize()).toBe(0);
  });

  it('returns correct count after pushes', () => {
    pushHealthHistoryEntry(makeEntry());
    pushHealthHistoryEntry(makeEntry());
    expect(healthHistorySize()).toBe(2);
  });
});

describe('getHealthHistory', () => {
  it('returns a defensive copy (modification does not affect internal state)', () => {
    pushHealthHistoryEntry(makeEntry());
    const copy = getHealthHistory() as HealthHistoryEntry[];
    copy.push(makeEntry());
    expect(healthHistorySize()).toBe(1);
  });
});
