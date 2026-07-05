/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog, buildErrorLogDetails } from "@/lib/logging";
import type { SidEnablement } from "@/lib/config/sidVolumeControl";

const STORAGE_KEY = "c64u.playbackSessionSnapshot";

type StoredSnapshotEnvelope = {
  deviceId: string;
  volumeSnapshot: Record<string, string | number>;
  volumeActive: boolean;
  manualMuteSnapshot: Record<string, string | number> | null;
  manualMuteEnablement: SidEnablement | null;
  pauseMuteSnapshot: Record<string, string | number> | null;
  pauseMuteEnablement: SidEnablement | null;
  savedAt: number;
};

const readEnvelope = (deviceId: string): StoredSnapshotEnvelope | null => {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSnapshotEnvelope>;
    if (!parsed || parsed.deviceId !== deviceId) return null;
    if (!parsed.volumeSnapshot || typeof parsed.volumeSnapshot !== "object") return null;
    return parsed as StoredSnapshotEnvelope;
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    addLog(
      "warn",
      "Failed to parse stored playback snapshot envelope",
      buildErrorLogDetails(normalizedError, { deviceId }),
    );
    return null;
  }
};

export const persistPlaybackSnapshot = (params: {
  deviceId: string;
  volumeSnapshot: Record<string, string | number>;
  volumeActive: boolean;
  manualMuteSnapshot: Record<string, string | number> | null;
  manualMuteEnablement: SidEnablement | null;
  pauseMuteSnapshot: Record<string, string | number> | null;
  pauseMuteEnablement: SidEnablement | null;
}) => {
  if (typeof sessionStorage === "undefined") return;
  try {
    const envelope: StoredSnapshotEnvelope = {
      deviceId: params.deviceId,
      volumeSnapshot: params.volumeSnapshot,
      volumeActive: params.volumeActive,
      manualMuteSnapshot: params.manualMuteSnapshot,
      manualMuteEnablement: params.manualMuteEnablement,
      pauseMuteSnapshot: params.pauseMuteSnapshot,
      pauseMuteEnablement: params.pauseMuteEnablement,
      savedAt: Date.now(),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    addLog(
      "warn",
      "Failed to persist playback snapshot envelope",
      buildErrorLogDetails(normalizedError, { deviceId: params.deviceId }),
    );
  }
};

export const hydratePlaybackSnapshot = (
  deviceId: string,
): {
  volumeSnapshot: Record<string, string | number>;
  volumeActive: boolean;
  manualMuteSnapshot: Record<string, string | number> | null;
  manualMuteEnablement: SidEnablement | null;
  pauseMuteSnapshot: Record<string, string | number> | null;
  pauseMuteEnablement: SidEnablement | null;
} | null => {
  const envelope = readEnvelope(deviceId);
  if (!envelope) return null;
  return {
    volumeSnapshot: envelope.volumeSnapshot,
    volumeActive: Boolean(envelope.volumeActive),
    manualMuteSnapshot: envelope.manualMuteSnapshot ?? null,
    manualMuteEnablement: envelope.manualMuteEnablement ?? null,
    pauseMuteSnapshot: envelope.pauseMuteSnapshot ?? null,
    pauseMuteEnablement: envelope.pauseMuteEnablement ?? null,
  };
};

export const discardPlaybackSnapshot = (deviceId?: string) => {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (!deviceId) {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    const current = readEnvelope(deviceId);
    if (current) sessionStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    addLog(
      "warn",
      "Failed to discard playback snapshot envelope",
      buildErrorLogDetails(normalizedError, { deviceId: deviceId ?? null }),
    );
  }
};

// HARD12-020: once the machine has resumed (from either Home or Play) the
// captured pause-mute snapshot is no longer needed. Clearing it here (rather
// than dropping the whole envelope) keeps the playback volume-session
// snapshot intact for a later Stop restore while preventing a stale
// pause-mute from being re-applied on the next Home resume.
export const clearPersistedPauseMute = (deviceId: string) => {
  if (typeof sessionStorage === "undefined") return;
  const envelope = readEnvelope(deviceId);
  if (!envelope) return;
  if (!envelope.pauseMuteSnapshot && !envelope.pauseMuteEnablement) return;
  persistPlaybackSnapshot({
    deviceId: envelope.deviceId,
    volumeSnapshot: envelope.volumeSnapshot,
    volumeActive: envelope.volumeActive,
    manualMuteSnapshot: envelope.manualMuteSnapshot,
    manualMuteEnablement: envelope.manualMuteEnablement,
    pauseMuteSnapshot: null,
    pauseMuteEnablement: null,
  });
};
