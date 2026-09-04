/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveConfig: vi.fn(),
  updateHasChanges: vi.fn(),
  getActiveBaseUrl: vi.fn(),
  addErrorLog: vi.fn(),
}));

vi.mock("@/lib/config/appConfigStore", () => ({
  getActiveBaseUrl: mocks.getActiveBaseUrl,
  updateHasChanges: mocks.updateHasChanges,
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: mocks.addErrorLog,
  addLog: vi.fn(),
}));

import { savePersistConfigToFlash } from "@/lib/config/appSettings";
import {
  CONFIG_FLASH_SAVE_QUIET_MS,
  __resetConfigFlashPersistence,
  hasUnsavedConfigChanges,
  noteConfigWritten,
  notePersistedToFlash,
  noteTransientConfigWriteSettled,
  noteTransientConfigWritten,
  saveConfigToFlashNow,
} from "@/lib/config/configFlashPersistence";

/**
 * The device applies a config write immediately but does NOT put it in flash — `at_close_config()`
 * effectuates and stops there, and `ConfigStore::write()` is only reachable from
 * `PUT /v1/configs:save_to_flash`. So "did the app call saveConfig" is exactly the question of
 * whether a setting survives the machine's next power-up.
 */
describe("configFlashPersistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    __resetConfigFlashPersistence(() => mocks.saveConfig());
    mocks.getActiveBaseUrl.mockReturnValue("http://c64u");
    mocks.saveConfig.mockResolvedValue({ errors: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const settle = async () => {
    await vi.advanceTimersByTimeAsync(CONFIG_FLASH_SAVE_QUIET_MS + 10);
  };

  it("leaves a change transient by default, so a power cycle undoes it", async () => {
    noteConfigWritten(() => mocks.saveConfig());
    await settle();

    expect(mocks.saveConfig).not.toHaveBeenCalled();
    expect(hasUnsavedConfigChanges()).toBe(false);
  });

  it("saves once the writes stop, when the user has asked for changes to stick", async () => {
    savePersistConfigToFlash(true);

    noteConfigWritten(() => mocks.saveConfig());
    expect(mocks.saveConfig).not.toHaveBeenCalled();
    await settle();

    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
    expect(hasUnsavedConfigChanges()).toBe(false);
  });

  it("saves once for a burst of writes rather than once per write", async () => {
    // A slider drag emits a write per frame. The machine's own menu writes flash when you leave it,
    // not per keystroke, and this has to behave the same or it would hammer the flash.
    savePersistConfigToFlash(true);

    for (let index = 0; index < 20; index += 1) {
      noteConfigWritten(() => mocks.saveConfig());
      await vi.advanceTimersByTimeAsync(100);
    }
    await settle();

    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
  });

  it("clears the unsaved marker so Home stops offering to save", async () => {
    savePersistConfigToFlash(true);
    noteConfigWritten(() => mocks.saveConfig());
    await settle();

    expect(mocks.updateHasChanges).toHaveBeenCalledWith("http://c64u", false);
  });

  it("does not save a change made before the setting was turned on", async () => {
    noteConfigWritten(() => mocks.saveConfig());
    savePersistConfigToFlash(true);
    await settle();

    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });

  it("abandons the save when the setting is turned off inside the quiet period", async () => {
    savePersistConfigToFlash(true);
    noteConfigWritten(() => mocks.saveConfig());
    await vi.advanceTimersByTimeAsync(CONFIG_FLASH_SAVE_QUIET_MS - 100);
    savePersistConfigToFlash(false);
    await settle();

    expect(mocks.saveConfig).not.toHaveBeenCalled();
    expect(hasUnsavedConfigChanges()).toBe(false);
  });

  it("keeps the change pending when the save fails, and reports it", async () => {
    savePersistConfigToFlash(true);
    mocks.saveConfig.mockRejectedValueOnce(new Error("device offline"));

    noteConfigWritten(() => mocks.saveConfig());
    await settle();

    expect(mocks.addErrorLog).toHaveBeenCalledWith(
      "Saving configuration to flash failed",
      expect.objectContaining({ error: "device offline" }),
    );
    expect(hasUnsavedConfigChanges()).toBe(true);
    expect(mocks.updateHasChanges).not.toHaveBeenCalledWith("http://c64u", false);
  });

  it("retries on the next settled write after a failed save", async () => {
    savePersistConfigToFlash(true);
    mocks.saveConfig.mockRejectedValueOnce(new Error("device offline"));
    noteConfigWritten(() => mocks.saveConfig());
    await settle();

    noteConfigWritten(() => mocks.saveConfig());
    await settle();

    expect(mocks.saveConfig).toHaveBeenCalledTimes(2);
    expect(hasUnsavedConfigChanges()).toBe(false);
  });

  it("shares one request between concurrent saves", async () => {
    let release!: (value: { errors: string[] }) => void;
    const inFlight = new Promise<{ errors: string[] }>((resolve) => {
      release = resolve;
    });
    mocks.saveConfig.mockReturnValue(inFlight);

    const first = saveConfigToFlashNow();
    const second = saveConfigToFlashNow();
    release({ errors: [] });

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
  });

  it("does nothing before any config write has handed it a way to save", async () => {
    savePersistConfigToFlash(true);
    __resetConfigFlashPersistence();

    await expect(saveConfigToFlashNow()).resolves.toBe(false);
    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });

  it("stops chasing a save once something else has written flash", async () => {
    savePersistConfigToFlash(true);
    noteConfigWritten(() => mocks.saveConfig());
    notePersistedToFlash();
    await settle();

    expect(mocks.saveConfig).not.toHaveBeenCalled();
    expect(hasUnsavedConfigChanges()).toBe(false);
  });

  // HARD27-011: a playback-time mixer write reaches the device through the same funnel as a
  // Config-page edit. Skipping the arm is not enough on its own — a user edit moments earlier may
  // already have armed a save, and that save would write the transient value to flash. The timer
  // is held instead, so the user's own edit is still persisted once the undo lands.
  it("holds an armed save across a transient write and lets it out after the undo", async () => {
    savePersistConfigToFlash(true);
    noteConfigWritten(() => mocks.saveConfig());

    noteTransientConfigWritten();
    await settle();
    expect(mocks.saveConfig).not.toHaveBeenCalled();
    expect(hasUnsavedConfigChanges()).toBe(true);

    noteTransientConfigWriteSettled();
    await settle();
    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a transient write when no save was armed", async () => {
    noteTransientConfigWritten();
    noteTransientConfigWriteSettled();
    await settle();

    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });

  it("drops a held save when the setting is turned off before the undo lands", async () => {
    savePersistConfigToFlash(true);
    noteConfigWritten(() => mocks.saveConfig());
    noteTransientConfigWritten();

    savePersistConfigToFlash(false);
    noteTransientConfigWriteSettled();
    await settle();

    expect(mocks.saveConfig).not.toHaveBeenCalled();
    expect(hasUnsavedConfigChanges()).toBe(false);
  });
});
