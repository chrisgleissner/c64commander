/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/native/featureFlags", () => ({
  FeatureFlags: {
    getFlag: vi.fn(async () => ({})),
    getAllFlags: vi.fn(async () => ({ flags: {} })),
    setFlag: vi.fn(async () => undefined),
    clearFlag: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

import {
  FEATURE_FLAG_IDS,
  FeatureFlagId,
  FeatureFlagManager,
  InMemoryFeatureFlagRepository,
  PluginFeatureFlagRepository,
  isFeatureEnabled,
  isHvscEnabled,
  isKnownFeatureFlagId,
} from "@/lib/config/featureFlags";

describe("featureFlags", () => {
  describe("InMemoryFeatureFlagRepository", () => {
    it("stores and retrieves overrides", async () => {
      const repo = new InMemoryFeatureFlagRepository({ hvsc_enabled: false });
      const overrides = await repo.getAllOverrides(["hvsc_enabled"]);
      expect(overrides).toEqual({ hvsc_enabled: false });
    });

    it("returns empty object for unknown ids", async () => {
      const repo = new InMemoryFeatureFlagRepository();
      expect(await repo.getAllOverrides(["hvsc_enabled"])).toEqual({});
    });

    it("setOverride(null) clears the override", async () => {
      const repo = new InMemoryFeatureFlagRepository({ commoserve_enabled: false });
      await repo.setOverride("commoserve_enabled", null);
      expect(await repo.getAllOverrides(["commoserve_enabled"])).toEqual({});
    });

    it("setOverride with a boolean persists the value", async () => {
      const repo = new InMemoryFeatureFlagRepository();
      await repo.setOverride("hvsc_enabled", true);
      expect(await repo.getAllOverrides(["hvsc_enabled"])).toEqual({ hvsc_enabled: true });
    });

    it("snapshotOverrides reflects current contents", async () => {
      const repo = new InMemoryFeatureFlagRepository();
      await repo.setOverride("hvsc_enabled", false);
      expect(repo.snapshotOverrides()).toEqual({ hvsc_enabled: false });
    });

    it("ignores undefined values in initial map", async () => {
      const repo = new InMemoryFeatureFlagRepository({
        hvsc_enabled: undefined,
      } as Partial<Record<FeatureFlagId, boolean>>);
      expect(await repo.getAllOverrides(["hvsc_enabled"])).toEqual({});
    });
  });

  describe("FeatureFlagManager resolver precedence", () => {
    let repo: InMemoryFeatureFlagRepository;
    let manager: FeatureFlagManager;

    beforeEach(() => {
      repo = new InMemoryFeatureFlagRepository();
      manager = new FeatureFlagManager(repo, () => false);
    });

    it("uses registry defaults when no override exists", async () => {
      await manager.load();
      const snap = manager.getSnapshot();
      expect(snap.flags.hvsc_enabled).toBe(true);
      expect(snap.flags.commoserve_enabled).toBe(true);
      expect(snap.flags.lighting_studio_enabled).toBe(false);
      expect(snap.isLoaded).toBe(true);
    });

    it("override replaces the registry default", async () => {
      await repo.setOverride("hvsc_enabled", false);
      await manager.load();
      const resolution = manager.getSnapshot().resolved.hvsc_enabled;
      expect(resolution.value).toBe(false);
      expect(resolution.hasOverride).toBe(true);
      expect(resolution.overrideValue).toBe(false);
    });

    it("hides developer-only features when developer mode is off", async () => {
      await manager.load();
      const resolution = manager.getSnapshot().resolved.lighting_studio_enabled;
      expect(resolution.visible).toBe(false);
      expect(resolution.editable).toBe(false);
    });

    it("keeps every visible standard-user feature editable", async () => {
      await manager.load();
      const resolutions = Object.values(manager.getSnapshot().resolved).filter(
        (resolution) => resolution.definition.visible_to_user && !resolution.definition.developer_only,
      );

      expect(resolutions.length).toBeGreaterThan(0);
      resolutions.forEach((resolution) => {
        expect(resolution.visible).toBe(true);
        expect(resolution.editable).toBe(true);
      });
    });

    it("keeps developer-only features hidden and non-editable for standard users", async () => {
      await manager.load();
      const resolutions = Object.values(manager.getSnapshot().resolved).filter(
        (resolution) => resolution.definition.developer_only,
      );

      expect(resolutions.length).toBeGreaterThan(0);
      resolutions.forEach((resolution) => {
        expect(resolution.definition.visible_to_user).toBe(false);
        expect(resolution.visible).toBe(false);
        expect(resolution.editable).toBe(false);
      });
    });

    it("developer mode makes every feature visible and editable", async () => {
      manager = new FeatureFlagManager(repo, () => true);
      await manager.load();
      const { lighting_studio_enabled, commoserve_enabled } = manager.getSnapshot().resolved;
      expect(lighting_studio_enabled.visible).toBe(true);
      expect(lighting_studio_enabled.editable).toBe(true);
      expect(commoserve_enabled.editable).toBe(true);
    });

    it("applyDeveloperMode updates editability without reloading", async () => {
      await manager.load();
      expect(manager.getSnapshot().resolved.lighting_studio_enabled.visible).toBe(false);
      manager.applyDeveloperMode(true);
      expect(manager.getSnapshot().resolved.lighting_studio_enabled.visible).toBe(true);
      manager.applyDeveloperMode(true);
      manager.applyDeveloperMode(false);
      expect(manager.getSnapshot().resolved.lighting_studio_enabled.visible).toBe(false);
    });
  });

  describe("FeatureFlagManager write path", () => {
    let repo: InMemoryFeatureFlagRepository;
    let manager: FeatureFlagManager;

    beforeEach(() => {
      repo = new InMemoryFeatureFlagRepository();
      manager = new FeatureFlagManager(repo, () => true);
    });

    it("setFlag to a non-default value persists an override", async () => {
      await manager.load();
      await manager.setFlag("hvsc_enabled", false);
      expect(repo.snapshotOverrides()).toEqual({ hvsc_enabled: false });
      expect(manager.getSnapshot().flags.hvsc_enabled).toBe(false);
    });

    it("setFlag back to default clears the persisted override", async () => {
      await repo.setOverride("hvsc_enabled", false);
      await manager.load();
      await manager.setFlag("hvsc_enabled", true);
      expect(repo.snapshotOverrides()).toEqual({});
      const res = manager.getSnapshot().resolved.hvsc_enabled;
      expect(res.hasOverride).toBe(false);
      expect(res.value).toBe(true);
    });

    it("rejects writes to non-editable features when developer mode is off", async () => {
      manager = new FeatureFlagManager(repo, () => false);
      await manager.load();
      await expect(manager.setFlag("lighting_studio_enabled", true)).rejects.toThrow(/not editable/);
    });

    it("clearOverride removes an override and emits", async () => {
      await repo.setOverride("hvsc_enabled", false);
      await manager.load();
      const listener = vi.fn();
      manager.subscribe(listener);
      listener.mockClear();
      await manager.clearOverride("hvsc_enabled");
      expect(repo.snapshotOverrides()).toEqual({});
      expect(listener).toHaveBeenCalled();
    });

    it("setFlag for an unknown id throws", async () => {
      await manager.load();
      await expect(manager.setFlag("ghost_flag" as FeatureFlagId, true)).rejects.toThrow(/Unknown feature flag/);
    });

    it("applyBootstrapOverride stores non-default values and clears default values", async () => {
      await manager.applyBootstrapOverride("hvsc_enabled", false);
      expect(repo.snapshotOverrides()).toEqual({ hvsc_enabled: false });
      expect(manager.getSnapshot().resolved.hvsc_enabled).toMatchObject({
        hasOverride: true,
        overrideValue: false,
        value: false,
      });

      await manager.applyBootstrapOverride("hvsc_enabled", true);
      expect(repo.snapshotOverrides()).toEqual({});
      expect(manager.getSnapshot().resolved.hvsc_enabled).toMatchObject({
        hasOverride: false,
        overrideValue: null,
        value: true,
      });
    });

    it("replaceOverrides clears defaults and keeps only non-default explicit overrides", async () => {
      await repo.setOverride("hvsc_enabled", false);
      await repo.setOverride("commoserve_enabled", false);
      await manager.load();

      await manager.replaceOverrides({
        hvsc_enabled: true,
        lighting_studio_enabled: true,
      });

      expect(repo.snapshotOverrides()).toEqual({ lighting_studio_enabled: true });
      expect(manager.getExplicitOverrides()).toEqual({ lighting_studio_enabled: true });
    });

    it("replaceOverrides logs and rethrows repository failures", async () => {
      const { addErrorLog } = await import("@/lib/logging");
      const failing = {
        getAllOverrides: vi.fn(async () => ({})),
        setOverride: vi.fn(async () => {
          throw new Error("replace failed");
        }),
      };
      const manager = new FeatureFlagManager(failing, () => true);

      await expect(manager.replaceOverrides({ hvsc_enabled: false })).rejects.toThrow("replace failed");
      expect(addErrorLog).toHaveBeenCalledWith("Feature flag replace failed", {
        error: "replace failed",
      });
    });
  });

  describe("FeatureFlagManager load semantics", () => {
    it("returns an initial non-loaded snapshot with defaults", () => {
      const manager = new FeatureFlagManager(new InMemoryFeatureFlagRepository(), () => false);
      const snap = manager.getSnapshot();
      expect(snap.isLoaded).toBe(false);
      expect(snap.flags.hvsc_enabled).toBe(true);
    });

    it("is idempotent across repeat load() calls", async () => {
      const repo = new InMemoryFeatureFlagRepository();
      const manager = new FeatureFlagManager(repo, () => false);
      await manager.load();
      await manager.load();
      expect(manager.getSnapshot().isLoaded).toBe(true);
    });

    it("reload re-queries overrides", async () => {
      const repo = new InMemoryFeatureFlagRepository();
      const manager = new FeatureFlagManager(repo, () => false);
      await manager.load();
      await repo.setOverride("hvsc_enabled", false);
      await manager.reload();
      expect(manager.getSnapshot().flags.hvsc_enabled).toBe(false);
    });

    it("survives a failing repository load and returns defaults", async () => {
      const failing = {
        getAllOverrides: vi.fn(async () => {
          throw new Error("load failed");
        }),
        setOverride: vi.fn(async () => undefined),
      };
      const manager = new FeatureFlagManager(failing, () => false);
      await manager.load();
      const snap = manager.getSnapshot();
      expect(snap.isLoaded).toBe(true);
      expect(snap.flags.hvsc_enabled).toBe(true);
    });

    it("coalesces concurrent load() calls", async () => {
      let resolveOverrides: ((value: Record<string, boolean>) => void) | null = null;
      const deferred = {
        getAllOverrides: vi.fn(
          () =>
            new Promise<Record<string, boolean>>((resolve) => {
              resolveOverrides = resolve;
            }),
        ),
        setOverride: vi.fn(async () => undefined),
      };
      const manager = new FeatureFlagManager(deferred, () => false);
      const p1 = manager.load();
      const p2 = manager.load();
      expect(deferred.getAllOverrides).toHaveBeenCalledTimes(1);
      resolveOverrides?.({ hvsc_enabled: false });
      await Promise.all([p1, p2]);
      expect(manager.getSnapshot().flags.hvsc_enabled).toBe(false);
    });

    it("subscribe delivers the current snapshot immediately and returns an unsubscribe", () => {
      const manager = new FeatureFlagManager(new InMemoryFeatureFlagRepository(), () => false);
      const listener = vi.fn();
      const unsub = manager.subscribe(listener);
      expect(listener).toHaveBeenCalledWith(manager.getSnapshot());
      listener.mockClear();
      unsub();
      manager.applyDeveloperMode(true);
      expect(listener).not.toHaveBeenCalled();
    });

    it("subscribeToDeveloperMode routes updates into the manager", () => {
      const manager = new FeatureFlagManager(new InMemoryFeatureFlagRepository(), () => false);
      let emit: (enabled: boolean) => void = () => {};
      manager.subscribeToDeveloperMode((l) => {
        emit = l;
        return () => {};
      });
      emit(true);
      expect(manager.getSnapshot().developerMode).toBe(true);
      manager.unsubscribeFromDeveloperMode();
      manager.unsubscribeFromDeveloperMode();
    });

    it("refreshDeveloperMode re-reads from the reader function", () => {
      let mode = false;
      const manager = new FeatureFlagManager(new InMemoryFeatureFlagRepository(), () => mode);
      expect(manager.getSnapshot().developerMode).toBe(false);
      mode = true;
      manager.refreshDeveloperMode();
      expect(manager.getSnapshot().developerMode).toBe(true);
    });
  });

  describe("PluginFeatureFlagRepository", () => {
    beforeEach(async () => {
      const { FeatureFlags } = await import("@/lib/native/featureFlags");
      vi.mocked(FeatureFlags.getAllFlags).mockReset();
      vi.mocked(FeatureFlags.setFlag).mockReset();
      vi.mocked(FeatureFlags.clearFlag).mockReset();
    });

    it("getAllOverrides returns only ids known to the registry", async () => {
      const { FeatureFlags } = await import("@/lib/native/featureFlags");
      vi.mocked(FeatureFlags.getAllFlags).mockResolvedValueOnce({
        flags: { hvsc_enabled: false, unknown_flag: true } as unknown as Record<string, boolean>,
      });
      const repo = new PluginFeatureFlagRepository();
      const result = await repo.getAllOverrides(["hvsc_enabled"]);
      expect(result).toEqual({ hvsc_enabled: false });
    });

    it("getAllOverrides returns {} when asked about nothing", async () => {
      const { FeatureFlags } = await import("@/lib/native/featureFlags");
      const repo = new PluginFeatureFlagRepository();
      const result = await repo.getAllOverrides([]);
      expect(result).toEqual({});
      expect(FeatureFlags.getAllFlags).not.toHaveBeenCalled();
    });

    it("setOverride delegates setFlag to the plugin", async () => {
      const { FeatureFlags } = await import("@/lib/native/featureFlags");
      const repo = new PluginFeatureFlagRepository();
      await repo.setOverride("hvsc_enabled", true);
      expect(FeatureFlags.setFlag).toHaveBeenCalledWith({ key: "hvsc_enabled", value: true });
    });

    it("setOverride(null) delegates clearFlag to the plugin", async () => {
      const { FeatureFlags } = await import("@/lib/native/featureFlags");
      const repo = new PluginFeatureFlagRepository();
      await repo.setOverride("hvsc_enabled", null);
      expect(FeatureFlags.clearFlag).toHaveBeenCalledWith({ key: "hvsc_enabled" });
    });

    it("treats a missing flags field as an empty override map", async () => {
      const { FeatureFlags } = await import("@/lib/native/featureFlags");
      vi.mocked(FeatureFlags.getAllFlags).mockResolvedValueOnce({});
      const repo = new PluginFeatureFlagRepository();
      expect(await repo.getAllOverrides(["hvsc_enabled"])).toEqual({});
    });
  });

  describe("helpers", () => {
    it("isHvscEnabled is true by default", () => {
      expect(
        isHvscEnabled({
          hvsc_enabled: true,
          commoserve_enabled: true,
          lighting_studio_enabled: false,
          background_execution_enabled: true,
          reu_snapshot_enabled: false,
        }),
      ).toBe(true);
    });

    it("isHvscEnabled is false when hvsc_enabled is false", () => {
      expect(
        isHvscEnabled({
          hvsc_enabled: false,
          commoserve_enabled: true,
          lighting_studio_enabled: false,
          background_execution_enabled: true,
          reu_snapshot_enabled: false,
        }),
      ).toBe(false);
    });

    it("isFeatureEnabled reads the requested id", () => {
      const flags = {
        hvsc_enabled: false,
        commoserve_enabled: true,
        lighting_studio_enabled: false,
        background_execution_enabled: true,
        reu_snapshot_enabled: false,
      };
      expect(isFeatureEnabled(flags, "commoserve_enabled")).toBe(true);
      expect(isFeatureEnabled(flags, "hvsc_enabled")).toBe(false);
    });

    it("isKnownFeatureFlagId recognizes every registered id", () => {
      FEATURE_FLAG_IDS.forEach((id) => expect(isKnownFeatureFlagId(id)).toBe(true));
    });

    it("isKnownFeatureFlagId rejects unknown ids", () => {
      expect(isKnownFeatureFlagId("nope")).toBe(false);
    });
  });
});
