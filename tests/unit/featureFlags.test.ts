import { describe, expect, it } from 'vitest';
import {
  FeatureFlagManager,
  InMemoryFeatureFlagRepository,
  FEATURE_FLAG_DEFINITIONS,
  isSidPlayerEnabled,
} from '@/lib/config/featureFlags';

const buildDefaults = () =>
  Object.fromEntries(
    Object.entries(FEATURE_FLAG_DEFINITIONS).map(([key, def]) => [key, def.defaultValue]),
  ) as Record<keyof typeof FEATURE_FLAG_DEFINITIONS, boolean>;

describe('featureFlags', () => {
  it('uses default values when no flags are stored', async () => {
    const repository = new InMemoryFeatureFlagRepository();
    const manager = new FeatureFlagManager(repository, buildDefaults());

    await manager.load();
    const snapshot = manager.getSnapshot();
    expect(snapshot.isLoaded).toBe(true);
    expect(snapshot.flags.sid_player_enabled).toBe(false);
  });

  it('persists flag updates in repository', async () => {
    const repository = new InMemoryFeatureFlagRepository();
    const manager = new FeatureFlagManager(repository, buildDefaults());

    await manager.load();
    await manager.setFlag('sid_player_enabled', true);

    const freshManager = new FeatureFlagManager(repository, buildDefaults());
    await freshManager.load();
    expect(freshManager.getSnapshot().flags.sid_player_enabled).toBe(true);
  });

  it('reports gating logic for SID player', () => {
    expect(isSidPlayerEnabled({ sid_player_enabled: false })).toBe(false);
    expect(isSidPlayerEnabled({ sid_player_enabled: true })).toBe(true);
  });
});
