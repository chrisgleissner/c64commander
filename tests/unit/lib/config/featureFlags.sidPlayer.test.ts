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
  FEATURE_FLAG_DEFINITIONS,
  FeatureFlagManager,
  InMemoryFeatureFlagRepository,
  type FeatureFlagId,
} from "@/lib/config/featureFlags";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";

const DEVICE_FLAGS: FeatureFlagId[] = [
  "remote_input_enabled",
  "ram_snapshots_enabled",
  "home_telnet_reu_snapshot_enabled",
  "home_telnet_config_actions_enabled",
  "home_telnet_drive_actions_enabled",
  "home_telnet_printer_actions_enabled",
  "home_telnet_power_cycle_enabled",
  "home_telnet_clear_ram_reboot_enabled",
  "launch_safety_enabled",
  "disk_explorer_enabled",
  "in_image_search_enabled",
  "live_view_enabled",
  "av_sync_tests_enabled",
  "audio_mirror_enabled",
  "video_mirror_enabled",
  "new_disk_enabled",
  "lighting_studio_enabled",
];

const MUSIC_FLAGS: FeatureFlagId[] = [
  "hvsc_enabled",
  "commoserve_enabled",
  "keypad_input_enabled",
  "background_execution_enabled",
  "app_styles_gallery_enabled",
  "demo_mode_enabled",
];

describe("feature flags in SID Player", () => {
  beforeEach(() => {
    localStorage.clear();
    saveStartupModeByUser("default");
  });

  it("SPM-SET-03 marks exactly the device features as requiring a device", () => {
    const required = FEATURE_FLAG_DEFINITIONS.filter((definition) => definition.requires_device).map(
      (definition) => definition.id,
    );
    expect([...required].sort()).toEqual([...DEVICE_FLAGS].sort());
    for (const id of MUSIC_FLAGS) {
      expect(FEATURE_FLAG_DEFINITIONS.find((definition) => definition.id === id)?.requires_device).toBe(false);
    }
  });

  it("SPM-SET-03 SID Player resolves device flags off and keeps their stored override", async () => {
    const repository = new InMemoryFeatureFlagRepository({ live_view_enabled: true, hvsc_enabled: true });
    const manager = new FeatureFlagManager(repository, () => true);
    await manager.load();
    expect(manager.getSnapshot().flags.live_view_enabled).toBe(true);

    saveStartupModeByUser("sid-player");

    const snapshot = manager.getSnapshot();
    for (const id of DEVICE_FLAGS) {
      expect(snapshot.flags[id]).toBe(false);
      expect(snapshot.resolved[id].visible).toBe(false);
      expect(snapshot.resolved[id].editable).toBe(false);
    }
    expect(snapshot.resolved.live_view_enabled.hasOverride).toBe(true);
    expect(snapshot.resolved.live_view_enabled.overrideValue).toBe(true);
    expect(manager.getExplicitOverrides()).toEqual({ live_view_enabled: true, hvsc_enabled: true });
    expect(snapshot.flags.hvsc_enabled).toBe(true);
  });

  it("SPM-SET-03 leaving SID Player restores the stored override", async () => {
    const repository = new InMemoryFeatureFlagRepository({ live_view_enabled: true });
    const manager = new FeatureFlagManager(repository, () => true);
    await manager.load();
    saveStartupModeByUser("sid-player");
    expect(manager.getSnapshot().flags.live_view_enabled).toBe(false);
    saveStartupModeByUser("default");
    expect(manager.getSnapshot().flags.live_view_enabled).toBe(true);
    expect(manager.getSnapshot().resolved.live_view_enabled.visible).toBe(true);
  });

  it("SPM-SET-03 a manager created while SID Player is active starts with device flags off", () => {
    saveStartupModeByUser("sid-player");
    const manager = new FeatureFlagManager(new InMemoryFeatureFlagRepository(), () => true);
    for (const id of DEVICE_FLAGS) expect(manager.getSnapshot().flags[id]).toBe(false);
  });
});
