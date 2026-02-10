/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FeatureFlagManager,
  InMemoryFeatureFlagRepository,
  FEATURE_FLAG_DEFINITIONS,
  isHvscEnabled,
} from '@/lib/config/featureFlags';

const addErrorLog = vi.fn();

vi.mock('@/lib/logging', () => ({
  addErrorLog: (...args: unknown[]) => addErrorLog(...args),
}));

const buildDefaults = () =>
  Object.fromEntries(
    Object.entries(FEATURE_FLAG_DEFINITIONS).map(([key, def]) => [key, def.defaultValue]),
  ) as Record<keyof typeof FEATURE_FLAG_DEFINITIONS, boolean>;

describe('featureFlags', () => {
  beforeEach(() => {
    addErrorLog.mockReset();
  });
  it('uses default values when no flags are stored', async () => {
    const repository = new InMemoryFeatureFlagRepository();
    const manager = new FeatureFlagManager(repository, buildDefaults());

    await manager.load();
    const snapshot = manager.getSnapshot();
    expect(snapshot.isLoaded).toBe(true);
    expect(snapshot.flags.hvsc_enabled).toBe(true);
  });

  it('persists flag updates in repository', async () => {
    const repository = new InMemoryFeatureFlagRepository();
    const manager = new FeatureFlagManager(repository, buildDefaults());

    await manager.load();
    await manager.setFlag('hvsc_enabled', true);

    const freshManager = new FeatureFlagManager(repository, buildDefaults());
    await freshManager.load();
    expect(freshManager.getSnapshot().flags.hvsc_enabled).toBe(true);
  });

  it('falls back to defaults when repository load fails', async () => {
    const repository = {
      getFlag: vi.fn(),
      getAllFlags: vi.fn().mockRejectedValue(new Error('boom')),
      setFlag: vi.fn(),
    };
    const manager = new FeatureFlagManager(repository, buildDefaults());

    await manager.load();

    expect(manager.getSnapshot().isLoaded).toBe(true);
    expect(manager.getSnapshot().flags.hvsc_enabled).toBe(true);
    expect(addErrorLog).toHaveBeenCalledWith('Feature flag load failed', expect.any(Object));
  });

  it('surfaces repository failures when setting flags', async () => {
    const repository = {
      getFlag: vi.fn(),
      getAllFlags: vi.fn().mockResolvedValue({}),
      setFlag: vi.fn().mockRejectedValue(new Error('fail')),
    };
    const manager = new FeatureFlagManager(repository, buildDefaults());

    await manager.load();
    await expect(manager.setFlag('hvsc_enabled', false)).rejects.toThrow('fail');
    expect(addErrorLog).toHaveBeenCalledWith('Feature flag update failed', expect.any(Object));
  });

  it('returns null when in-memory repository has no value', async () => {
    const repository = new InMemoryFeatureFlagRepository();

    await expect(repository.getFlag('hvsc_enabled')).resolves.toBeNull();
  });

  it('reports gating logic for HVSC controls', () => {
    expect(isHvscEnabled({ hvsc_enabled: false })).toBe(false);
    expect(isHvscEnabled({ hvsc_enabled: true })).toBe(true);
  });
});
