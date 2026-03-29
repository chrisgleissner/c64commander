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
    getFlag: vi.fn(async () => ({ value: null })),
    getAllFlags: vi.fn(async () => ({ flags: {} })),
    setFlag: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

import {
  InMemoryFeatureFlagRepository,
  PluginFeatureFlagRepository,
  FeatureFlagManager,
  isHvscEnabled,
  type FeatureFlags,
} from "@/lib/config/featureFlags";

describe("featureFlags", () => {
  describe("InMemoryFeatureFlagRepository", () => {
    it("stores and retrieves flags", async () => {
      const repo = new InMemoryFeatureFlagRepository({ hvsc_enabled: true });
      const flag = await repo.getFlag("hvsc_enabled");
      expect(flag).toBe(true);
    });

    it("returns null for unknown flags", async () => {
      const repo = new InMemoryFeatureFlagRepository();
      const flag = await repo.getFlag("hvsc_enabled");
      expect(flag).toBeNull();
    });

    it("treats a corrupted stored flag as null", async () => {
      const repo = new InMemoryFeatureFlagRepository();
      (repo as unknown as { store: Map<string, boolean | undefined> }).store.set("hvsc_enabled", undefined);
      const flag = await repo.getFlag("hvsc_enabled");
      expect(flag).toBeNull();
    });

    it("returns all stored flags for given keys", async () => {
      const repo = new InMemoryFeatureFlagRepository({ hvsc_enabled: false });
      const flags = await repo.getAllFlags(["hvsc_enabled"]);
      expect(flags).toEqual({ hvsc_enabled: false });
    });

    it("normalizes corrupted stored flag entries to false in bulk reads", async () => {
      const repo = new InMemoryFeatureFlagRepository();
      (repo as unknown as { store: Map<string, boolean | undefined> }).store.set("hvsc_enabled", undefined);
      const flags = await repo.getAllFlags(["hvsc_enabled"]);
      expect(flags).toEqual({ hvsc_enabled: false });
    });

    it("sets flags", async () => {
      const repo = new InMemoryFeatureFlagRepository();
      await repo.setFlag("hvsc_enabled", true);
      expect(await repo.getFlag("hvsc_enabled")).toBe(true);
    });

    it("constructs with empty initial values", async () => {
      const repo = new InMemoryFeatureFlagRepository({});
      const flags = await repo.getAllFlags(["hvsc_enabled"]);
      expect(flags).toEqual({});
    });
  });

  describe("FeatureFlagManager", () => {
    let repo: InMemoryFeatureFlagRepository;
    let manager: FeatureFlagManager;
    const defaults: FeatureFlags = { hvsc_enabled: true };

    beforeEach(() => {
      repo = new InMemoryFeatureFlagRepository();
      manager = new FeatureFlagManager(repo, defaults);
    });

    it("returns default snapshot before load", () => {
      const snapshot = manager.getSnapshot();
      expect(snapshot.flags.hvsc_enabled).toBe(true);
      expect(snapshot.isLoaded).toBe(false);
    });

    it("loads flags from repository", async () => {
      await repo.setFlag("hvsc_enabled", false);
      await manager.load();
      const snapshot = manager.getSnapshot();
      expect(snapshot.flags.hvsc_enabled).toBe(false);
      expect(snapshot.isLoaded).toBe(true);
    });

    it("is idempotent on repeated load", async () => {
      await manager.load();
      await manager.load();
      expect(manager.getSnapshot().isLoaded).toBe(true);
    });

    it("reloads flags after stored values change post-load", async () => {
      await repo.setFlag("hvsc_enabled", false);
      await manager.load();

      await repo.setFlag("hvsc_enabled", true);
      await manager.reload();

      expect(manager.getSnapshot()).toEqual({
        flags: { hvsc_enabled: true },
        isLoaded: true,
      });
    });

    it("subscribes and receives initial snapshot", () => {
      const listener = vi.fn();
      manager.subscribe(listener);
      expect(listener).toHaveBeenCalledWith(manager.getSnapshot());
    });

    it("unsubscribes via returned function", () => {
      const listener = vi.fn();
      const unsub = manager.subscribe(listener);
      listener.mockClear();
      unsub();
      manager.load();
    });

    it("emits to listeners on load", async () => {
      const listener = vi.fn();
      manager.subscribe(listener);
      listener.mockClear();
      await manager.load();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ isLoaded: true }));
    });

    it("sets flag and emits", async () => {
      await manager.load();
      const listener = vi.fn();
      manager.subscribe(listener);
      listener.mockClear();
      await manager.setFlag("hvsc_enabled", false);
      expect(manager.getSnapshot().flags.hvsc_enabled).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("handles load error gracefully", async () => {
      const failingRepo = {
        getFlag: vi.fn(async () => null),
        getAllFlags: vi.fn(async () => {
          throw new Error("load failed");
        }),
        setFlag: vi.fn(async () => undefined),
      };
      const errorManager = new FeatureFlagManager(failingRepo, defaults);
      await errorManager.load();
      expect(errorManager.getSnapshot().isLoaded).toBe(true);
      expect(errorManager.getSnapshot().flags.hvsc_enabled).toBe(true);
    });

    it("handles setFlag error by logging and rethrowing", async () => {
      const failingRepo = {
        getFlag: vi.fn(async () => null),
        getAllFlags: vi.fn(async () => ({})),
        setFlag: vi.fn(async () => {
          throw new Error("write failed");
        }),
      };
      const errorManager = new FeatureFlagManager(failingRepo, defaults);
      await expect(errorManager.setFlag("hvsc_enabled", false)).rejects.toThrow("write failed");
    });
  });

  describe("isHvscEnabled", () => {
    it("returns true when hvsc_enabled is true", () => {
      expect(isHvscEnabled({ hvsc_enabled: true })).toBe(true);
    });

    it("returns false when hvsc_enabled is false", () => {
      expect(isHvscEnabled({ hvsc_enabled: false })).toBe(false);
    });
  });

  describe("PluginFeatureFlagRepository", () => {
    it("getFlag returns the boolean value when the plugin returns a boolean", async () => {
      const { FeatureFlags } = await import("@/lib/native/featureFlags");
      vi.mocked(FeatureFlags.getFlag).mockResolvedValueOnce({ value: true });
      const repo = new PluginFeatureFlagRepository();
      expect(await repo.getFlag("hvsc_enabled")).toBe(true);
    });

    it("getFlag returns null when plugin value is not a boolean", async () => {
      const { FeatureFlags } = await import("@/lib/native/featureFlags");
      vi.mocked(FeatureFlags.getFlag).mockResolvedValueOnce({ value: null });
      const repo = new PluginFeatureFlagRepository();
      expect(await repo.getFlag("hvsc_enabled")).toBeNull();
    });

    it("getAllFlags returns flags from plugin", async () => {
      const { FeatureFlags } = await import("@/lib/native/featureFlags");
      vi.mocked(FeatureFlags.getAllFlags).mockResolvedValueOnce({
        flags: { hvsc_enabled: false },
      });
      const repo = new PluginFeatureFlagRepository();
      const result = await repo.getAllFlags(["hvsc_enabled"]);
      expect(result).toEqual({ hvsc_enabled: false });
    });

    it("getAllFlags returns empty object when flags is undefined", async () => {
      const { FeatureFlags } = await import("@/lib/native/featureFlags");
      vi.mocked(FeatureFlags.getAllFlags).mockResolvedValueOnce({
        flags: undefined,
      });
      const repo = new PluginFeatureFlagRepository();
      const result = await repo.getAllFlags(["hvsc_enabled"]);
      expect(result).toEqual({});
    });

    it("setFlag delegates to the plugin", async () => {
      const { FeatureFlags } = await import("@/lib/native/featureFlags");
      const repo = new PluginFeatureFlagRepository();
      await repo.setFlag("hvsc_enabled", true);
      expect(FeatureFlags.setFlag).toHaveBeenCalledWith({
        key: "hvsc_enabled",
        value: true,
      });
    });
  });
});
