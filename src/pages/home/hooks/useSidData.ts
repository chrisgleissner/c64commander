/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo } from "react";
import { useC64Categories, useC64ConfigItems } from "@/hooks/useC64Connection";
import {
  HOME_SID_ADDRESSING_ITEMS,
  HOME_SID_SOCKET_ITEMS,
  HOME_SUMMARY_QUERY_OPTIONS,
  HOME_ULTISID_ITEMS,
  SID_AUDIO_ITEMS,
} from "../constants";
import { buildSidControlEntries } from "@/lib/config/sidDetails";
import { buildConfigKey } from "../utils/HomeConfigUtils";
import { buildSidSilenceTargets } from "@/lib/sid/sidSilence";

export type SidAudioStatus = "loading" | "error" | "ready";

// Controls built from a category that has not answered would be empty selects, so Audio renders only once all four have data.
export function resolveSidAudioStatus(reads: readonly { data: unknown; isError?: boolean }[]): SidAudioStatus {
  const unanswered = reads.filter((read) => read.data === undefined);
  if (unanswered.length === 0) return "ready";
  return unanswered.some((read) => read.isError) ? "error" : "loading";
}

export function useSidData(isConnected: boolean, configOverrides: Record<string, string | number>) {
  // An Ultimate-II+ lists no Audio Mixer: its SIDs are emulated under Audio Output Settings instead.
  // The previous device's list stands in while this one's loads, so it is not taken as this device's answer.
  const { data: categoryList, isPlaceholderData } = useC64Categories();
  const sidAudioMissing =
    isConnected && !isPlaceholderData && Boolean(categoryList) && !categoryList?.categories?.includes("Audio Mixer");
  const readSidAudio = isConnected && !sidAudioMissing && !isPlaceholderData;
  const sidSocketsQuery = useC64ConfigItems(
    "SID Sockets Configuration",
    [...HOME_SID_SOCKET_ITEMS],
    readSidAudio,
    HOME_SUMMARY_QUERY_OPTIONS,
  );
  const ultiSidQuery = useC64ConfigItems(
    "UltiSID Configuration",
    [...HOME_ULTISID_ITEMS],
    readSidAudio,
    HOME_SUMMARY_QUERY_OPTIONS,
  );
  const sidAddressingQuery = useC64ConfigItems(
    "SID Addressing",
    [...HOME_SID_ADDRESSING_ITEMS],
    readSidAudio,
    HOME_SUMMARY_QUERY_OPTIONS,
  );
  const audioMixerQuery = useC64ConfigItems(
    "Audio Mixer",
    [...SID_AUDIO_ITEMS],
    readSidAudio,
    HOME_SUMMARY_QUERY_OPTIONS,
  );
  const sidSocketsCategory = sidSocketsQuery.data;
  const ultiSidCategory = ultiSidQuery.data;
  const sidAddressingCategory = sidAddressingQuery.data;
  const audioMixerCategory = audioMixerQuery.data;

  const sidAudioReads = [sidSocketsQuery, ultiSidQuery, sidAddressingQuery, audioMixerQuery];
  const sidAudioStatus: SidAudioStatus =
    sidAudioMissing || !isConnected ? "ready" : resolveSidAudioStatus(sidAudioReads);
  const refetchSidAudio = () => {
    sidAudioReads.forEach((read) => {
      if (read.data === undefined) void read.refetch();
    });
  };

  const sidControlEntries = useMemo(() => {
    if (sidAudioMissing) return [];
    const entries = buildSidControlEntries(audioMixerCategory, sidAddressingCategory);
    return entries.map((entry) => {
      const volumeOverride = configOverrides[buildConfigKey("Audio Mixer", entry.volumeItem)];
      const panOverride = configOverrides[buildConfigKey("Audio Mixer", entry.panItem)];
      const addressOverride = configOverrides[buildConfigKey("SID Addressing", entry.addressItem)];
      return {
        ...entry,
        volume: volumeOverride !== undefined ? String(volumeOverride) : entry.volume,
        pan: panOverride !== undefined ? String(panOverride) : entry.pan,
        addressRaw: addressOverride !== undefined ? String(addressOverride) : entry.addressRaw,
      };
    });
  }, [audioMixerCategory, configOverrides, sidAddressingCategory, sidAudioMissing]);

  const sidSilenceTargets = useMemo(() => buildSidSilenceTargets(sidControlEntries), [sidControlEntries]);

  return {
    sidAudioMissing,
    sidAudioStatus,
    refetchSidAudio,
    sidSocketsCategory,
    ultiSidCategory,
    sidAddressingCategory,
    audioMixerCategory,
    sidControlEntries,
    sidSilenceTargets,
  };
}
