/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { C64API } from "@/lib/c64api";
import { subscribeNetworkEdges } from "@/lib/connection/networkStatusWatch";
import { readNativeNetworkStatus } from "@/lib/connection/offlineStartup";
import { addLog } from "@/lib/logging";
import { resolveForeignSenderPassword } from "@/lib/streams/foreignSenderStop";
import { isSidVolumeName, resolveAudioMixerMuteValue, type AudioMixerVolumeItem } from "./audioMixerSolo";

/**
 * Solo mutes every other SID on the device itself, and the device keeps that (Auto Save Config
 * writes it through). The Config page puts the levels back when Solo ends or the page closes, but a
 * crash or "Force stop" ran neither, and the next launch found the other SIDs still silent with
 * nothing recording what they had been. So the levels are recorded per device for as long as Solo
 * is on, and swept at launch the way leftover streams are.
 */
const SOLO_RECORD_KEY = "c64u_audio_mixer_solo:v1";
const AUDIO_MIXER = "Audio Mixer";

type SoloRecord = { host: string; soloItem: string; items: AudioMixerVolumeItem[] };

export const recordSoloLevels = (host: string, soloItem: string, items: AudioMixerVolumeItem[]): void => {
  try {
    localStorage.setItem(SOLO_RECORD_KEY, JSON.stringify({ host, soloItem, items } satisfies SoloRecord));
  } catch (error) {
    addLog("warn", "Audio Mixer: could not record the levels Solo replaced", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
  }
};

export const clearSoloLevels = (): void => {
  try {
    localStorage.removeItem(SOLO_RECORD_KEY);
  } catch (error) {
    addLog("warn", "Audio Mixer: could not clear the record of Solo levels", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
  }
};

const readSoloLevels = (): SoloRecord | null => {
  try {
    const raw = localStorage.getItem(SOLO_RECORD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SoloRecord>;
    if (typeof parsed.host !== "string" || typeof parsed.soloItem !== "string" || !Array.isArray(parsed.items)) {
      return null;
    }
    return parsed as SoloRecord;
  } catch (error) {
    addLog("warn", "Audio Mixer: could not read the record of Solo levels", {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    return null;
  }
};

/**
 * The levels to put back: only a SID that is still at the value Solo muted it to. One the user has
 * changed since is theirs now and is left alone, however long ago Solo was interrupted.
 */
export const buildSoloRecoveryUpdates = (
  record: Pick<SoloRecord, "soloItem" | "items">,
  current: Record<string, unknown>,
): Record<string, string | number> => {
  const updates: Record<string, string | number> = {};
  record.items.forEach((item) => {
    if (!isSidVolumeName(item.name) || item.name === record.soloItem) return;
    const muted = resolveAudioMixerMuteValue(item.options);
    if (item.value === muted || current[item.name] !== muted) return;
    updates[item.name] = item.value;
  });
  return updates;
};

const readCurrentLevels = (response: unknown): Record<string, unknown> => {
  const category = (response as Record<string, Record<string, unknown>> | undefined)?.[AUDIO_MIXER] ?? {};
  const items = (category.items as Record<string, unknown> | undefined) ?? category;
  return Object.fromEntries(
    Object.entries(items).map(([name, value]) => [
      name,
      value && typeof value === "object"
        ? ((value as { selected?: unknown; current?: unknown }).selected ?? (value as { current?: unknown }).current)
        : value,
    ]),
  );
};

/** Put back the SID levels a Solo left muted when the app went away without ending it. */
export const recoverInterruptedSolo = async (): Promise<void> => {
  const record = readSoloLevels();
  if (!record) return;
  const network = await readNativeNetworkStatus();
  if (network.supported && !network.online) {
    const unsubscribe = subscribeNetworkEdges((edge) => {
      if (edge !== "online") return;
      unsubscribe();
      void recoverInterruptedSolo();
    });
    return;
  }
  try {
    const password = await resolveForeignSenderPassword(record.host);
    const api = new C64API(undefined, password ?? undefined, record.host);
    const current = readCurrentLevels(await api.getCategory(AUDIO_MIXER));
    const updates = buildSoloRecoveryUpdates(record, current);
    for (const [name, value] of Object.entries(updates)) {
      await api.setConfigValue(AUDIO_MIXER, name, value);
    }
    clearSoloLevels();
    addLog("info", "Audio Mixer: restored the SID levels an interrupted Solo left muted", {
      host: record.host,
      restored: Object.keys(updates),
    });
  } catch (error) {
    addLog(
      "warn",
      "Audio Mixer: could not restore the SID levels an interrupted Solo left muted; will retry at the next launch",
      {
        host: record.host,
        error: (error as Error).message,
        stack: (error as Error).stack,
      },
    );
  }
};
