/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { loadPersistConfigToFlash } from "@/lib/config/appSettings";
import { getActiveBaseUrl, updateHasChanges } from "@/lib/config/appConfigStore";
import { addErrorLog } from "@/lib/logging";

/**
 * Decides whether a setting changed from the app outlives the machine's next power-up.
 *
 * A REST config write only EFFECTUATES. `PUT /v1/configs/<category>/<item>` ends at
 * `ConfigStore::at_close_config()`, which calls `effectuate()` and nothing else, so a new value
 * reaches the hardware registers but never reaches flash. `ConfigStore::write()` — the only thing
 * that touches flash — is reachable from exactly one route, `PUT /v1/configs:save_to_flash`.
 *
 * That transient behavior is the DEFAULT here and is deliberate. Trying settings from a phone
 * invites experimenting, and an experiment that is undone by a power cycle is one nobody has to
 * undo by hand. The machine's own `Auto Save Config` setting does not change this: the firmware
 * reads it only from `ConfigBrowser::on_exit`, so it governs the on-screen setup menu and has no
 * bearing on anything the app does.
 *
 * Someone who wants their changes to stick turns on "Keep device settings after a restart" in
 * Settings, and then this module saves for them.
 *
 * It does not save per write. The machine's own menu collects changes and writes once when you
 * leave the menu; a quiet period stands in for that here, so dragging a brightness slider costs one
 * flash write rather than one per frame.
 */

/**
 * How long the app waits for config writes to stop before saving.
 *
 * Has to outlast a drag — an LED color slider emits writes for as long as a finger is moving —
 * while staying short enough that changing one setting and immediately pulling the power keeps it.
 */
export const CONFIG_FLASH_SAVE_QUIET_MS = 1_500;

/**
 * How this module reaches the device: handed in, never imported.
 *
 * `c64api` calls `noteConfigWritten`, so importing it back would close a cycle between the two
 * modules — and importing it dynamically to dodge that only moved the problem into the bundler,
 * which then warned that a module statically imported in fifty other places cannot be split out.
 * The caller already holds the API, so it passes the one operation this module needs.
 */
export type ConfigFlashSaver = () => Promise<unknown>;

let saver: ConfigFlashSaver | null = null;

let quietTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSave = false;
let saveInFlight: Promise<boolean> | null = null;

const clearQuietTimer = () => {
  if (quietTimer) clearTimeout(quietTimer);
  quietTimer = null;
};

/**
 * Writes every stale config store to flash.
 *
 * Concurrent callers share one request. The device answers with the list of stores it actually
 * wrote, and a second call moments later reports an empty list, so a duplicate save is harmless —
 * but it is still a flash write, and making exactly one is the point of the quiet period.
 */
export const saveConfigToFlashNow = async (): Promise<boolean> => {
  if (saveInFlight) return saveInFlight;
  if (!saver) return false;
  const save = saver;
  const attempt = (async () => {
    try {
      await save();
      pendingSave = false;
      updateHasChanges(getActiveBaseUrl(), false);
      return true;
    } catch (error) {
      // The change is still live on the machine; only its permanence failed. Leaving `pendingSave`
      // set means the next settled write tries again rather than quietly giving up on it.
      addErrorLog("Saving configuration to flash failed", {
        service: "config",
        error: (error as Error).message,
      });
      return false;
    } finally {
      saveInFlight = null;
    }
  })();
  saveInFlight = attempt;
  return attempt;
};

const onQuiet = async () => {
  quietTimer = null;
  if (!pendingSave) return;
  // Re-read rather than trusting the answer from when the write happened: the setting can be turned
  // off inside the quiet window, and a save the user has just declined must not still go out.
  if (!loadPersistConfigToFlash()) {
    pendingSave = false;
    return;
  }
  await saveConfigToFlashNow();
};

/**
 * Records that a config item was written to the device, and arms the save.
 *
 * Called from the two funnels every config write passes through, after the device has ACCEPTED the
 * write — a rejected write leaves nothing to persist. Cheap and side-effect-free while the setting
 * is off, which is the default.
 */
export const noteConfigWritten = (save: ConfigFlashSaver): void => {
  saver = save;
  if (!loadPersistConfigToFlash()) return;
  pendingSave = true;
  clearQuietTimer();
  quietTimer = setTimeout(() => {
    void onQuiet();
  }, CONFIG_FLASH_SAVE_QUIET_MS);
};

/**
 * Records a write the app intends to undo, so an armed save waits for the undo.
 *
 * HARD27-011: playback-time mixer writes — the volume override, the pause mute — are transient by
 * design, but they reach the device through the same funnels as a Config-page edit. Skipping
 * `noteConfigWritten` for them is not enough on its own: a user edit moments earlier may already
 * have armed a save, and that save would then write the transient value to flash. Holding the timer
 * keeps `pendingSave` set, so the user's own edit is still persisted — by
 * `noteTransientConfigWriteSettled` when the undo lands, or by their next ordinary config write if
 * the undo never happens.
 */
export const noteTransientConfigWritten = (): void => {
  if (!pendingSave) return;
  clearQuietTimer();
};

/**
 * Records that the undo of a transient write has landed, and re-arms a held save.
 *
 * The device is back to the values the user chose, so a save armed before the transient write may
 * now go out. No-op when nothing was pending.
 */
export const noteTransientConfigWriteSettled = (): void => {
  if (!pendingSave) return;
  if (!loadPersistConfigToFlash()) {
    pendingSave = false;
    clearQuietTimer();
    return;
  }
  clearQuietTimer();
  quietTimer = setTimeout(() => {
    void onQuiet();
  }, CONFIG_FLASH_SAVE_QUIET_MS);
};

/**
 * Records that flash now holds everything, however it got there.
 *
 * Home's "To Flash" button goes straight to the API rather than through `saveConfigToFlashNow`.
 * Without this the module would keep believing something was outstanding and would save again.
 */
export const notePersistedToFlash = (): void => {
  pendingSave = false;
  clearQuietTimer();
};

/** True when a write has happened that flash does not have yet. */
export const hasUnsavedConfigChanges = (): boolean => pendingSave;

/** Test seam: forget any pending save and timer. */
export const __resetConfigFlashPersistence = (saveForTests: ConfigFlashSaver | null = null): void => {
  clearQuietTimer();
  pendingSave = false;
  saveInFlight = null;
  saver = saveForTests;
};
