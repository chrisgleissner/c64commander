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

export function useSidData(isConnected: boolean, configOverrides: Record<string, string | number>) {
  // An Ultimate-II+ lists no Audio Mixer: its SIDs are emulated under Audio Output Settings instead.
  // The previous device's list stands in while this one's loads, so it is not taken as this device's answer.
  const { data: categoryList, isPlaceholderData } = useC64Categories();
  const sidAudioMissing =
    isConnected && !isPlaceholderData && Boolean(categoryList) && !categoryList?.categories?.includes("Audio Mixer");
  const readSidAudio = isConnected && !sidAudioMissing;
  const { data: sidSocketsCategory } = useC64ConfigItems(
    "SID Sockets Configuration",
    [...HOME_SID_SOCKET_ITEMS],
    readSidAudio,
    HOME_SUMMARY_QUERY_OPTIONS,
  );
  const { data: ultiSidCategory } = useC64ConfigItems(
    "UltiSID Configuration",
    [...HOME_ULTISID_ITEMS],
    readSidAudio,
    HOME_SUMMARY_QUERY_OPTIONS,
  );
  const { data: sidAddressingCategory } = useC64ConfigItems(
    "SID Addressing",
    [...HOME_SID_ADDRESSING_ITEMS],
    readSidAudio,
    HOME_SUMMARY_QUERY_OPTIONS,
  );
  const { data: audioMixerCategory } = useC64ConfigItems(
    "Audio Mixer",
    [...SID_AUDIO_ITEMS],
    readSidAudio,
    HOME_SUMMARY_QUERY_OPTIONS,
  );

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
    sidSocketsCategory,
    ultiSidCategory,
    sidAddressingCategory,
    audioMixerCategory,
    sidControlEntries,
    sidSilenceTargets,
  };
}
