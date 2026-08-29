/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { History, Monitor, Play, Radio, type LucideIcon } from "lucide-react";

import { toast } from "@/hooks/use-toast";
import { useRequirementContext } from "@/hooks/useSearchResults";
import { t } from "@/lib/i18n";
import { addErrorLog } from "@/lib/logging";
import { loadRecentlyPlayed } from "@/lib/sidRadio/recentlyPlayed";
import { resolveSearchHandler } from "@/lib/search/handlers";
import { navigateToSearchTarget } from "@/lib/search/navigate";
import { resolveEntry } from "@/lib/search/requirements";
import { isHvscInstalled } from "@/lib/hvsc/hvscStateStore";
import { PROMOTED_ENTRY_IDS } from "@/lib/search/promoted";
import { getSearchEntries } from "@/lib/search/registry";
import { PLAYBACK_SESSION_KEY } from "@/pages/playFiles/playFilesUtils";
import type { ResolvedSearchEntry } from "@/lib/search/types";

/**
 * The four capabilities that were hardest to reach, one action from Home (spec.md section 6.3).
 *
 * They resolve through the same registry and the same navigateToSearchTarget that search uses, so a
 * tile cannot go anywhere search cannot — and the reachability walk covers both at once.
 *
 * Radio navigates to Play rather than hoisting the station launcher into a provider. `useSidRadio`
 * produces items into the Play page's playback engine, and a second owner of that transport is how
 * two stations end up running at once.
 */

/** One promoted action, in the shape MachineControls renders its extra actions in. */
export interface ListenAction {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly description: string | null;
  readonly disabled: boolean;
  readonly onSelect: () => void;
  readonly testId: string;
  readonly focusId: string;
}

/**
 * Tiles whose emptiness needs no sentence. Both are greyed and already labelled with the thing
 * that is missing, and neither reason names anything a reader could do about it.
 */
const SELF_EVIDENT_WHEN_EMPTY = new Set(["action.resume-session", "action.recently-played"]);

interface Tile {
  readonly entryId: string;
  readonly icon: LucideIcon;
  readonly label: string;
  /** A word about what this tile has, when there is one — the tune Resume would restore. */
  readonly detail?: string | null;
}

const readSessionLabel = (): string | null => {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PLAYBACK_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { currentItemLabel?: unknown; currentItemId?: unknown } | null;
    if (!parsed || !parsed.currentItemId) return null;
    return typeof parsed.currentItemLabel === "string" ? parsed.currentItemLabel : null;
  } catch (error) {
    addErrorLog("Failed to read the playback session for the Resume tile", { error: (error as Error).message });
    return null;
  }
};

export const useListenActions = (): ListenAction[] => {
  const navigate = useNavigate();
  const location = useLocation();
  const [sessionLabel, setSessionLabel] = useState<string | null>(null);
  const [recentCount, setRecentCount] = useState(0);

  useEffect(() => {
    setSessionLabel(readSessionLabel());
    setRecentCount(loadRecentlyPlayed().length);
  }, []);

  // Read, not assumed: an entry that needs the archive must resolve as unavailable where it has
  // never been prepared, so the tile says what it is waiting for instead of failing when tapped.
  const hvscReady = useMemo(() => isHvscInstalled(), []);
  const ctx = useRequirementContext(hvscReady);

  /*
   * Built from the shared list, in its order. The tiles and the search overlay's chips are the same
   * four promoted actions, and holding the ids in two places is how they came to disagree about the
   * fourth one.
   */
  const tiles = useMemo<Tile[]>(() => {
    const byId: Record<string, Omit<Tile, "entryId">> = {
      "action.sid-radio": { icon: Radio, label: t("home.tile.radio", "Radio") },
      /*
       * "Last tune", not "Resume". Two constraints meet here. The machine's own Pause control
       * renames itself to Resume while the C64 is paused, and both tiles are in one grid now, so
       * "Resume" alone would be two buttons of the same name meaning different things. And the
       * word "Resume" does not fit: at four columns on a 320px screen the layout audit measured it
       * needing 64px in a 59px tile. "Last" and "tune" each fit, and with the play glyph above them
       * the tile reads as what it does.
       */
      "action.resume-session": { icon: Play, label: t("home.tile.resume", "Last tune"), detail: sessionLabel },
      "action.recently-played": {
        icon: History,
        label: t("home.tile.recent", "Recent"),
        detail: recentCount > 0 ? `${recentCount}` : null,
      },
      "home.section.live-view": { icon: Monitor, label: t("home.tile.liveView", "Live View") },
    };
    return PROMOTED_ENTRY_IDS.flatMap((entryId) => {
      const tile = byId[entryId];
      return tile === undefined ? [] : [{ entryId, ...tile }];
    });
  }, [recentCount, sessionLabel]);

  const resolved = useMemo(() => {
    const entries = getSearchEntries();
    return tiles.map((tile) => {
      const entry = entries.find((candidate) => candidate.id === tile.entryId);
      return { tile, resolved: entry ? resolveEntry(entry, ctx) : null };
    });
  }, [ctx, tiles]);

  // The Recent tile is enabled by its own list rather than by a requirement: the list is local, and
  // a requirement kind for "this local list is not empty" would exist for one row.
  const recentIsEmpty = recentCount === 0;

  const activate = useCallback(
    async (entry: ResolvedSearchEntry) => {
      await navigateToSearchTarget(entry.entry.target, {
        navigate: (path) => navigate(path),
        currentPath: location.pathname,
        label: t(entry.entry.titleKey, entry.entry.titleDefault),
        onToast: (message) => toast({ title: message, variant: "destructive" }),
        runAction: (handlerId) =>
          resolveSearchHandler(handlerId)?.({ navigate: (path) => navigate(path), currentPath: location.pathname }),
      });
    },
    [location.pathname, navigate],
  );

  /*
   * Returned as machine actions rather than rendered as a section of their own.
   *
   * This app is a remote control first and a standalone player second — it is what it is named
   * for — so a banner headed "Needs no C64 attached" over-weighted the second and, with Live View
   * among the four, was not even true: Live View requires a connected machine and streaming
   * support. They are now four tiles in Quick Actions, keeping the ids the tour spotlights and the
   * screenshot corpus names.
   */
  return useMemo(
    () =>
      resolved.flatMap(({ tile, resolved: entry }) => {
        if (!entry) return [];
        const emptyRecent = tile.entryId === "action.recently-played" && recentIsEmpty;
        const enabled = entry.enabled && !emptyRecent;
        /*
         * The reason a tile cannot run, on the card rather than only in its accessible name: one
         * that vanishes teaches nothing and one greyed with no explanation teaches less.
         *
         * "Nothing has been played yet" and "Nothing has been opened yet" are the exceptions. They
         * restate a greyed tile already labelled Resume or Recent, and they are the only reasons
         * here that name nothing a reader could act on — no device to connect, no switch to turn
         * on. They were also long enough to run past the bottom of the tile. A reason that does
         * point somewhere is still shown.
         */
        return [
          {
            id: `promoted.${tile.entryId}`,
            label: tile.label,
            icon: tile.icon,
            description: enabled
              ? (tile.detail ?? null)
              : SELF_EVIDENT_WHEN_EMPTY.has(tile.entryId)
                ? null
                : (entry.disabledReason ?? null),
            disabled: !enabled,
            onSelect: () => void activate(entry),
            testId: `home-tile-${tile.entryId}`,
            focusId: `home-tile-${tile.entryId}`,
          },
        ];
      }),
    [activate, recentIsEmpty, resolved],
  );
};
