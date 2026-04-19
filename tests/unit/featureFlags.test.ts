/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FeatureFlagManager,
  InMemoryFeatureFlagRepository,
  FEATURE_FLAG_DEFINITIONS,
  isHvscEnabled,
} from "@/lib/config/featureFlags";

const addErrorLog = vi.fn();

vi.mock("@/lib/logging", () => ({
  addErrorLog: (...args: unknown[]) => addErrorLog(...args),
}));

describe("featureFlags persistence and logging", () => {
  beforeEach(() => {
    addErrorLog.mockReset();
  });

  it("exposes the expected initial registry", () => {
    const ids = FEATURE_FLAG_DEFINITIONS.map((definition) => definition.id);
    expect(ids).toEqual(["hvsc_enabled", "commoserve_enabled", "lighting_studio_enabled"]);
  });

  it("classifies stable and experimental flags via the registry", () => {
    const groupsById = Object.fromEntries(
      FEATURE_FLAG_DEFINITIONS.map((definition) => [definition.id, definition.group]),
    );
    expect(groupsById).toEqual({
      hvsc_enabled: "stable",
      commoserve_enabled: "stable",
      lighting_studio_enabled: "experimental",
    });
  });

  it("persists a non-default override and it survives a reload through a fresh manager", async () => {
    const repository = new InMemoryFeatureFlagRepository();
    const manager = new FeatureFlagManager(repository, () => true);
    await manager.load();
    await manager.setFlag("hvsc_enabled", false);

    const freshManager = new FeatureFlagManager(repository, () => true);
    await freshManager.load();

    const resolution = freshManager.getSnapshot().resolved.hvsc_enabled;
    expect(resolution.hasOverride).toBe(true);
    expect(resolution.value).toBe(false);
  });

  it("logs and recovers when the repository load fails", async () => {
    const repository = {
      getAllOverrides: vi.fn().mockRejectedValue(new Error("boom")),
      setOverride: vi.fn(),
    };
    const manager = new FeatureFlagManager(repository, () => false);
    await manager.load();
    expect(manager.getSnapshot().isLoaded).toBe(true);
    expect(manager.getSnapshot().flags.hvsc_enabled).toBe(true);
    expect(addErrorLog).toHaveBeenCalledWith("Feature flag load failed", expect.any(Object));
  });

  it("surfaces and logs repository failures when writing an override", async () => {
    const repository = {
      getAllOverrides: vi.fn().mockResolvedValue({}),
      setOverride: vi.fn().mockRejectedValue(new Error("fail")),
    };
    const manager = new FeatureFlagManager(repository, () => true);
    await manager.load();
    await expect(manager.setFlag("hvsc_enabled", false)).rejects.toThrow("fail");
    expect(addErrorLog).toHaveBeenCalledWith("Feature flag update failed", expect.any(Object));
  });

  it("surfaces and logs repository failures when clearing an override", async () => {
    const repository = {
      getAllOverrides: vi.fn().mockResolvedValue({ hvsc_enabled: false }),
      setOverride: vi.fn().mockRejectedValue(new Error("clear failed")),
    };
    const manager = new FeatureFlagManager(repository, () => true);
    await manager.load();
    await expect(manager.clearOverride("hvsc_enabled")).rejects.toThrow("clear failed");
    expect(addErrorLog).toHaveBeenCalledWith("Feature flag clear failed", expect.any(Object));
  });

  it("reports gating logic for HVSC controls", () => {
    expect(isHvscEnabled({ hvsc_enabled: false, commoserve_enabled: true, lighting_studio_enabled: false })).toBe(
      false,
    );
    expect(isHvscEnabled({ hvsc_enabled: true, commoserve_enabled: true, lighting_studio_enabled: false })).toBe(true);
  });
});
