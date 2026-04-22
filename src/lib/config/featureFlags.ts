/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { FeatureFlags as FeatureFlagsPlugin } from "@/lib/native/featureFlags";
import { addErrorLog } from "@/lib/logging";
import {
  FEATURE_FLAG_DEFINITIONS,
  FEATURE_FLAG_DEFINITION_BY_ID,
  FEATURE_FLAG_GROUPS,
  FEATURE_FLAG_IDS,
  type FeatureFlagDefinition,
  type FeatureFlagGroupKey,
  type FeatureFlagGroupMetadata,
  type FeatureFlagId,
} from "./featureFlagsRegistry.generated";
import { getDeveloperModeEnabled, subscribeDeveloperMode } from "./developerModeStore";

export { FEATURE_FLAG_DEFINITIONS, FEATURE_FLAG_DEFINITION_BY_ID, FEATURE_FLAG_GROUPS, FEATURE_FLAG_IDS };
export type { FeatureFlagDefinition, FeatureFlagGroupKey, FeatureFlagGroupMetadata, FeatureFlagId };

export type FeatureFlagKey = FeatureFlagId;
export type FeatureFlags = Record<FeatureFlagId, boolean>;

export type FeatureFlagResolution = {
  id: FeatureFlagId;
  definition: FeatureFlagDefinition;
  value: boolean;
  hasOverride: boolean;
  overrideValue: boolean | null;
  visible: boolean;
  editable: boolean;
};

export type FeatureFlagResolvedSnapshot = Readonly<Record<FeatureFlagId, FeatureFlagResolution>>;

export type FeatureFlagSnapshot = {
  flags: FeatureFlags;
  resolved: FeatureFlagResolvedSnapshot;
  developerMode: boolean;
  isLoaded: boolean;
};

export type FeatureFlagListener = (snapshot: FeatureFlagSnapshot) => void;

export interface FeatureFlagOverrideRepository {
  getAllOverrides: (ids: readonly FeatureFlagId[]) => Promise<Partial<Record<FeatureFlagId, boolean>>>;
  setOverride: (id: FeatureFlagId, value: boolean | null) => Promise<void>;
}

export class PluginFeatureFlagRepository implements FeatureFlagOverrideRepository {
  async getAllOverrides(ids: readonly FeatureFlagId[]): Promise<Partial<Record<FeatureFlagId, boolean>>> {
    if (ids.length === 0) return {};
    const result = await FeatureFlagsPlugin.getAllFlags({ keys: [...ids] });
    const flags = result.flags ?? {};
    const overrides: Partial<Record<FeatureFlagId, boolean>> = {};
    (Object.keys(flags) as FeatureFlagId[]).forEach((id) => {
      if ((FEATURE_FLAG_DEFINITION_BY_ID as Record<string, FeatureFlagDefinition>)[id]) {
        overrides[id] = flags[id];
      }
    });
    return overrides;
  }

  async setOverride(id: FeatureFlagId, value: boolean | null): Promise<void> {
    if (value === null) {
      await FeatureFlagsPlugin.clearFlag({ key: id });
      return;
    }
    await FeatureFlagsPlugin.setFlag({ key: id, value });
  }
}

export class InMemoryFeatureFlagRepository implements FeatureFlagOverrideRepository {
  private store = new Map<FeatureFlagId, boolean>();

  constructor(initial: Partial<Record<FeatureFlagId, boolean>> = {}) {
    (Object.entries(initial) as Array<[FeatureFlagId, boolean]>).forEach(([key, value]) => {
      if (value !== undefined) this.store.set(key, value);
    });
  }

  async getAllOverrides(ids: readonly FeatureFlagId[]): Promise<Partial<Record<FeatureFlagId, boolean>>> {
    const overrides: Partial<Record<FeatureFlagId, boolean>> = {};
    ids.forEach((id) => {
      if (this.store.has(id)) overrides[id] = this.store.get(id) ?? false;
    });
    return overrides;
  }

  async setOverride(id: FeatureFlagId, value: boolean | null): Promise<void> {
    if (value === null) this.store.delete(id);
    else this.store.set(id, value);
  }

  snapshotOverrides(): Partial<Record<FeatureFlagId, boolean>> {
    const out: Partial<Record<FeatureFlagId, boolean>> = {};
    this.store.forEach((value, id) => {
      out[id] = value;
    });
    return out;
  }
}

const definitionFor = (id: FeatureFlagId): FeatureFlagDefinition => {
  const definition = (FEATURE_FLAG_DEFINITION_BY_ID as Record<string, FeatureFlagDefinition>)[id];
  if (!definition) {
    throw new Error(`Unknown feature flag id: ${id}`);
  }
  return definition;
};

export const isKnownFeatureFlagId = (id: string): id is FeatureFlagId =>
  Object.prototype.hasOwnProperty.call(FEATURE_FLAG_DEFINITION_BY_ID, id);

const isStandardUserToggleable = (definition: FeatureFlagDefinition): boolean =>
  definition.visible_to_user && !definition.developer_only;

const computeResolution = (
  definition: FeatureFlagDefinition,
  override: boolean | undefined,
  developerMode: boolean,
): FeatureFlagResolution => {
  const hasOverride = typeof override === "boolean";
  const value = hasOverride ? (override as boolean) : definition.enabled;
  const visible = developerMode ? true : definition.visible_to_user;
  const editable = developerMode ? true : isStandardUserToggleable(definition);
  return {
    id: definition.id,
    definition,
    value,
    hasOverride,
    overrideValue: hasOverride ? (override as boolean) : null,
    visible,
    editable,
  };
};

const buildSnapshot = (
  overrides: Partial<Record<FeatureFlagId, boolean>>,
  developerMode: boolean,
  isLoaded: boolean,
): FeatureFlagSnapshot => {
  const flags = {} as FeatureFlags;
  const resolved = {} as Record<FeatureFlagId, FeatureFlagResolution>;
  FEATURE_FLAG_DEFINITIONS.forEach((definition) => {
    const resolution = computeResolution(definition, overrides[definition.id], developerMode);
    flags[definition.id] = resolution.value;
    resolved[definition.id] = resolution;
  });
  return { flags, resolved, developerMode, isLoaded };
};

const getExplicitOverridesFromSnapshot = (snapshot: FeatureFlagSnapshot): Partial<Record<FeatureFlagId, boolean>> => {
  const overrides: Partial<Record<FeatureFlagId, boolean>> = {};
  FEATURE_FLAG_IDS.forEach((id) => {
    const resolution = snapshot.resolved[id];
    if (resolution.hasOverride && resolution.overrideValue !== null) {
      overrides[id] = resolution.overrideValue;
    }
  });
  return overrides;
};

export class FeatureFlagManager {
  private snapshot: FeatureFlagSnapshot;
  private overrides: Partial<Record<FeatureFlagId, boolean>> = {};
  private developerMode: boolean;
  private listeners = new Set<FeatureFlagListener>();
  private loadPromise: Promise<void> | null = null;
  private devModeUnsubscribe: (() => void) | null = null;

  constructor(
    private repository: FeatureFlagOverrideRepository,
    private readDeveloperMode: () => boolean = getDeveloperModeEnabled,
  ) {
    this.developerMode = this.readDeveloperMode();
    this.snapshot = buildSnapshot(this.overrides, this.developerMode, false);
  }

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: FeatureFlagListener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  subscribeToDeveloperMode(
    subscribe: (listener: (enabled: boolean) => void) => () => void = (listener) =>
      subscribeDeveloperMode(({ enabled }) => listener(enabled)),
  ) {
    this.devModeUnsubscribe?.();
    this.devModeUnsubscribe = subscribe((enabled) => {
      this.applyDeveloperMode(enabled);
    });
    return this.devModeUnsubscribe;
  }

  unsubscribeFromDeveloperMode() {
    this.devModeUnsubscribe?.();
    this.devModeUnsubscribe = null;
  }

  refreshDeveloperMode() {
    this.applyDeveloperMode(this.readDeveloperMode());
  }

  async load() {
    await this.runLoad(false);
  }

  async reload() {
    await this.runLoad(true);
  }

  private async runLoad(force: boolean) {
    if (!force && this.snapshot.isLoaded) return;
    if (this.loadPromise) {
      await this.loadPromise;
      if (!force && this.snapshot.isLoaded) return;
    }
    this.loadPromise = this.performLoad();
    try {
      await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  private async performLoad() {
    try {
      this.overrides = await this.repository.getAllOverrides(FEATURE_FLAG_IDS);
      this.developerMode = this.readDeveloperMode();
      this.emitSnapshot(true);
    } catch (error) {
      addErrorLog("Feature flag load failed", {
        error: (error as Error).message,
      });
      this.overrides = {};
      this.developerMode = this.readDeveloperMode();
      this.emitSnapshot(true);
    }
  }

  async setFlag(id: FeatureFlagId, value: boolean) {
    const definition = definitionFor(id);
    const resolution = this.snapshot.resolved[id];
    if (!resolution.editable) {
      throw new Error(`feature flag "${id}" is not editable`);
    }
    try {
      if (value === definition.enabled) {
        await this.repository.setOverride(id, null);
        delete this.overrides[id];
      } else {
        await this.repository.setOverride(id, value);
        this.overrides[id] = value;
      }
      this.emitSnapshot(this.snapshot.isLoaded);
    } catch (error) {
      addErrorLog("Feature flag update failed", {
        id,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async applyBootstrapOverride(id: FeatureFlagId, value: boolean) {
    const definition = definitionFor(id);
    try {
      if (value === definition.enabled) {
        await this.repository.setOverride(id, null);
        delete this.overrides[id];
      } else {
        await this.repository.setOverride(id, value);
        this.overrides[id] = value;
      }
      this.emitSnapshot(this.snapshot.isLoaded);
    } catch (error) {
      addErrorLog("Feature flag bootstrap update failed", {
        id,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async clearOverride(id: FeatureFlagId) {
    definitionFor(id);
    try {
      await this.repository.setOverride(id, null);
      delete this.overrides[id];
      this.emitSnapshot(this.snapshot.isLoaded);
    } catch (error) {
      addErrorLog("Feature flag clear failed", {
        id,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  getExplicitOverrides() {
    return getExplicitOverridesFromSnapshot(this.snapshot);
  }

  async replaceOverrides(nextOverrides: Partial<Record<FeatureFlagId, boolean>>) {
    try {
      const sanitized: Partial<Record<FeatureFlagId, boolean>> = {};
      FEATURE_FLAG_IDS.forEach((id) => {
        const value = nextOverrides[id];
        if (typeof value === "boolean") {
          sanitized[id] = value;
        }
      });

      for (const id of FEATURE_FLAG_IDS) {
        const nextValue = sanitized[id];
        if (typeof nextValue === "boolean") {
          const definition = definitionFor(id);
          if (nextValue === definition.enabled) {
            await this.repository.setOverride(id, null);
          } else {
            await this.repository.setOverride(id, nextValue);
          }
        } else {
          await this.repository.setOverride(id, null);
        }
      }

      this.overrides = {};
      FEATURE_FLAG_IDS.forEach((id) => {
        const nextValue = sanitized[id];
        if (typeof nextValue === "boolean" && nextValue !== definitionFor(id).enabled) {
          this.overrides[id] = nextValue;
        }
      });
      this.emitSnapshot(this.snapshot.isLoaded);
    } catch (error) {
      addErrorLog("Feature flag replace failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  applyDeveloperMode(enabled: boolean) {
    if (this.developerMode === enabled) return;
    this.developerMode = enabled;
    this.emitSnapshot(this.snapshot.isLoaded);
  }

  private emitSnapshot(isLoaded: boolean) {
    this.snapshot = buildSnapshot(this.overrides, this.developerMode, isLoaded);
    this.listeners.forEach((listener) => listener(this.snapshot));
  }
}

export const featureFlagManager = new FeatureFlagManager(new PluginFeatureFlagRepository());

export const isFeatureEnabled = (flags: FeatureFlags, id: FeatureFlagId): boolean => Boolean(flags[id]);

export const isHvscEnabled = (flags: FeatureFlags) => Boolean(flags.hvsc_enabled);
