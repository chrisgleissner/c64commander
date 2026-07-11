/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog, addLog, buildErrorLogDetails } from "@/lib/logging";
import { isSidVolumeName } from "@/lib/config/audioMixerSolo";
import {
  buildEnabledSidMuteUpdates,
  buildEnabledSidVolumeSnapshot,
  buildSidEnablement,
  filterEnabledSidVolumeItems,
} from "@/lib/config/sidVolumeControl";
import { extractAudioMixerItems } from "@/pages/playFiles/playFilesUtils";
import { persistPauseMuteSnapshot } from "@/pages/playFiles/playbackSessionPersistence";

type PauseMuteCaptureApi = {
  getCategory: (category: string, options?: { __c64uIntent?: "user" }) => Promise<Record<string, unknown>>;
  updateConfigBatch: (
    payload: Record<string, Record<string, string | number>>,
  ) => Promise<{ errors?: string[] } | undefined>;
};

/**
 * Mirror of `restorePauseMuteFromPersistedSnapshot` (machineExecutionStore) for the
 * PAUSE side. Home's pause DMA-pauses the CPU but the SID oscillators keep sounding,
 * so — like Play's own pause path — it must mute the SID mixer first and persist a
 * device-scoped snapshot the resume can restore (HARD19-010).
 *
 * Reuses the exact same pure SID-volume helpers Play uses (extractAudioMixerItems,
 * buildSidEnablement, filterEnabledSidVolumeItems, buildEnabledSidVolumeSnapshot,
 * buildEnabledSidMuteUpdates) so the persisted snapshot/enablement match what
 * `buildEnabledSidUnmuteUpdates` expects on resume — the two cannot diverge.
 *
 * Returns true when a mute was actually applied (so the caller sets
 * `pauseMutePending`). Best-effort: logs and returns false on any read/write failure
 * rather than blocking the pause.
 */
export const capturePauseMuteToPersistedSnapshot = async (
  api: PauseMuteCaptureApi,
  deviceId: string | null | undefined,
): Promise<boolean> => {
  if (!deviceId) return false;
  try {
    const [audioMixer, sidSockets, sidAddressing] = await Promise.all([
      api.getCategory("Audio Mixer", { __c64uIntent: "user" }),
      api.getCategory("SID Sockets Configuration", { __c64uIntent: "user" }),
      api.getCategory("SID Addressing", { __c64uIntent: "user" }),
    ]);

    const sidItems = extractAudioMixerItems(audioMixer).filter((item) => isSidVolumeName(item.name));
    const enablement = buildSidEnablement(sidSockets, sidAddressing);
    const enabledItems = filterEnabledSidVolumeItems(sidItems, enablement);
    if (!enabledItems.length) return false;

    // Capture pre-mute values BEFORE writing the mute so resume restores them.
    const snapshot = buildEnabledSidVolumeSnapshot(enabledItems, enablement);
    const muteUpdates = buildEnabledSidMuteUpdates(enabledItems, enablement);
    // Empty updates means the mixer is already muted (or all off) — nothing to
    // capture or restore.
    if (!Object.keys(muteUpdates).length) return false;

    // Multi-item write MUST stay a single updateConfigBatch POST (never decomposed).
    const result = await api.updateConfigBatch({ "Audio Mixer": muteUpdates });
    const firmwareErrors = Array.isArray(result?.errors)
      ? result.errors.filter((entry) => entry.trim().length > 0)
      : [];
    if (firmwareErrors.length) {
      addErrorLog("Home pause SID mute rejected by firmware", {
        errors: firmwareErrors,
        deviceId,
        updateCount: Object.keys(muteUpdates).length,
      });
      return false;
    }

    persistPauseMuteSnapshot(deviceId, snapshot, enablement);
    addLog("info", "Applied SID mute for Home pause", {
      deviceId,
      updateCount: Object.keys(muteUpdates).length,
    });
    return true;
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    addLog("error", "Home pause SID mute capture failed", buildErrorLogDetails(normalizedError, { deviceId }));
    return false;
  }
};
