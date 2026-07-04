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
    expect(ids).toEqual([
      "hvsc_enabled",
      "commoserve_enabled",
      "demo_mode_enabled",
      "background_execution_enabled",
      "lighting_studio_enabled",
      "remote_input_enabled",
      "ram_snapshots_enabled",
      "home_telnet_reu_snapshot_enabled",
      "home_telnet_config_actions_enabled",
      "home_telnet_drive_actions_enabled",
      "home_telnet_printer_actions_enabled",
      "home_telnet_power_cycle_enabled",
      "home_telnet_clear_ram_reboot_enabled",
      "keypad_input_enabled",
    ]);
  });

  it("classifies stable and experimental flags via the registry", () => {
    const groupsById = Object.fromEntries(
      FEATURE_FLAG_DEFINITIONS.map((definition) => [definition.id, definition.group]),
    );
    expect(groupsById).toEqual({
      hvsc_enabled: "stable",
      commoserve_enabled: "stable",
      demo_mode_enabled: "stable",
      lighting_studio_enabled: "experimental",
      remote_input_enabled: "stable",
      background_execution_enabled: "experimental",
      home_telnet_reu_snapshot_enabled: "experimental",
      ram_snapshots_enabled: "stable",
      home_telnet_config_actions_enabled: "experimental",
      home_telnet_drive_actions_enabled: "experimental",
      home_telnet_printer_actions_enabled: "experimental",
      home_telnet_power_cycle_enabled: "experimental",
      home_telnet_clear_ram_reboot_enabled: "experimental",
      keypad_input_enabled: "experimental",
    });
  });

  it("ships keyboard and keypad navigation as a user-visible, default-on experimental flag", () => {
    const keypad = FEATURE_FLAG_DEFINITIONS.find((definition) => definition.id === "keypad_input_enabled");
    expect(keypad).toBeDefined();
    expect(keypad?.enabled).toBe(true);
    expect(keypad?.visible_to_user).toBe(true);
    expect(keypad?.developer_only).toBe(false);
    expect(keypad?.group).toBe("experimental");
    // Standard-user toggleable is derived as visible_to_user && !developer_only,
    // so this row remains available for users who need to disable keyboard navigation.
    expect(Boolean(keypad?.visible_to_user) && !keypad?.developer_only).toBe(true);
  });

  it("ships Remote Input as a user-visible, default-on stable flag", () => {
    // Remote Input is on by default and no longer hidden behind developer
    // mode; joystick relay is gated at runtime on machine:input support, not by
    // this flag. Users can still turn the whole surface off from Settings.
    const remote = FEATURE_FLAG_DEFINITIONS.find((definition) => definition.id === "remote_input_enabled");
    expect(remote).toBeDefined();
    expect(remote?.enabled).toBe(true);
    expect(remote?.visible_to_user).toBe(true);
    expect(remote?.developer_only).toBe(false);
    expect(remote?.group).toBe("stable");
    expect(Boolean(remote?.visible_to_user) && !remote?.developer_only).toBe(true);
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
    expect(
      isHvscEnabled({
        hvsc_enabled: false,
        commoserve_enabled: true,
        demo_mode_enabled: false,
        lighting_studio_enabled: false,
        background_execution_enabled: true,
        home_telnet_reu_snapshot_enabled: false,
        ram_snapshots_enabled: false,
        home_telnet_config_actions_enabled: false,
        home_telnet_drive_actions_enabled: false,
        home_telnet_printer_actions_enabled: false,
        home_telnet_power_cycle_enabled: false,
        home_telnet_clear_ram_reboot_enabled: false,
        keypad_input_enabled: true,
      }),
    ).toBe(false);
    expect(
      isHvscEnabled({
        hvsc_enabled: true,
        commoserve_enabled: true,
        demo_mode_enabled: false,
        lighting_studio_enabled: false,
        background_execution_enabled: true,
        home_telnet_reu_snapshot_enabled: false,
        ram_snapshots_enabled: false,
        home_telnet_config_actions_enabled: false,
        home_telnet_drive_actions_enabled: false,
        home_telnet_printer_actions_enabled: false,
        home_telnet_power_cycle_enabled: false,
        home_telnet_clear_ram_reboot_enabled: false,
        keypad_input_enabled: true,
      }),
    ).toBe(true);
  });

  it("keeps home telnet flags consistently prefixed and documented", () => {
    const homeTelnetDefinitions = FEATURE_FLAG_DEFINITIONS.filter((definition) =>
      definition.id.startsWith("home_telnet_"),
    );

    expect(homeTelnetDefinitions.map((definition) => definition.id)).toContain("home_telnet_reu_snapshot_enabled");
    homeTelnetDefinitions.forEach((definition) => {
      expect(definition.description).toContain("Depends on the Telnet interface.");
    });
  });
});
