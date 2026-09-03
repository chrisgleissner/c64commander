/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useC64Connection } from "@/hooks/useC64Connection";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useTelnetActions } from "@/hooks/useTelnetActions";
import { variant } from "@/generated/variant";
import { loadSidRadioEnabled } from "@/lib/config/appSettings";
import { deriveDeviceCapabilities } from "@/lib/deviceCapabilities";
import { t } from "@/lib/i18n";
import { readStoredPlaybackSession } from "@/lib/playback/playbackSessionStore";
import { loadPickedEntryIds } from "@/lib/search/history";
import { getSearchEntries, subscribeSearchEntries } from "@/lib/search/registry";
import { resolveEntry, type RequirementContext } from "@/lib/search/requirements";
import { rank, toScorableText, type ScorableEntry, type ScoredEntry } from "@/lib/search/score";
import type { SearchEntry } from "@/lib/search/types";

/** Title and subtitle in this locale, which is what the scorer and the row both read. */
export const entryTitle = (entry: SearchEntry): string => t(entry.titleKey, entry.titleDefault);
export const entrySubtitle = (entry: SearchEntry): string | null =>
  entry.subtitleKey && entry.subtitleDefault ? t(entry.subtitleKey, entry.subtitleDefault) : null;

const hasRestorableSession = (): boolean => Boolean(readStoredPlaybackSession()?.currentItemId);

/**
 * Everything a requirement is evaluated against, assembled from live app state.
 *
 * `flagValue` answers for a feature flag AND for the app settings that act as one — SID Radio is a
 * switch in Settings, not a flag, and a row gated on it still has to say so.
 */
export const useRequirementContext = (hvscReady: boolean): RequirementContext => {
  const { status } = useC64Connection();
  const { flags } = useFeatureFlags();
  const telnet = useTelnetActions();

  return useMemo(() => {
    const capabilities = deriveDeviceCapabilities({
      product: status.deviceInfo?.product,
      firmwareVersion: status.deviceInfo?.firmware_version,
      coreVersion: status.deviceInfo?.core_version,
    });
    const appSwitches: Record<string, () => boolean> = { sid_radio_enabled: loadSidRadioEnabled };
    return {
      deviceConnected: status.isConnected,
      capabilities,
      telnetAvailable: telnet.isAvailable,
      flagValue: (flag) => appSwitches[flag]?.() ?? Boolean((flags as Record<string, boolean>)[flag]),
      variantId: variant.id,
      hvscReady,
      hasRestorableSession: hasRestorableSession(),
    };
  }, [status.isConnected, status.deviceInfo, flags, telnet.isAvailable, hvscReady]);
};

const useRegisteredEntries = (): readonly SearchEntry[] =>
  useSyncExternalStore(subscribeSearchEntries, getSearchEntries, getSearchEntries);

export interface SearchResultsState {
  readonly results: readonly ScoredEntry[];
  readonly totalMatched: number;
}

/**
 * Tiers 0 and 1 scored synchronously on the keystroke, so the results commit in the same React
 * update as the character that produced them (spec.md section 5.5). Tier 2 is appended by the
 * overlay separately and never blocks these.
 */
export const useSearchResults = (query: string, ctx: RequirementContext): SearchResultsState => {
  const entries = useRegisteredEntries();
  const [pickedIds, setPickedIds] = useState<readonly string[]>(loadPickedEntryIds);

  // Re-read once per query the user starts, not per keystroke: the list only changes when a result
  // is activated, which closes the overlay.
  useEffect(() => {
    if (query === "") setPickedIds(loadPickedEntryIds());
  }, [query]);

  const scorable = useMemo<ScorableEntry[]>(
    () =>
      entries.map((entry) => {
        const title = entryTitle(entry);
        const subtitle = entrySubtitle(entry);
        return {
          resolved: resolveEntry(entry, ctx),
          title,
          text: toScorableText({
            title,
            ...(subtitle ? { subtitle } : {}),
            ...(entry.keywords ? { keywords: entry.keywords } : {}),
          }),
        };
      }),
    [entries, ctx],
  );

  return useMemo(() => {
    const results = rank(scorable, query, { pickedIds });
    return { results, totalMatched: results.length };
  }, [scorable, query, pickedIds]);
};
