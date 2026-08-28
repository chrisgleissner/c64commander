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

import { CollapsibleSection } from "@/components/CollapsibleSection";
import { QuickActionCard } from "@/components/QuickActionCard";
import { ProfileActionGrid } from "@/components/layout/PageContainer";
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

export const ListenAndPlay = () => {
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
      "action.resume-session": { icon: Play, label: t("home.tile.resume", "Resume"), detail: sessionLabel },
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

  return (
    <CollapsibleSection
      scope="home"
      id="listen-and-play"
      title={t("home.listenAndPlay", "Listen and play")}
      summary={t("home.listenAndPlay.summary", "Needs no C64 attached")}
      icon={Radio}
      defaultOpen
      testId="home-listen-and-play"
    >
      {/*
        Two columns on a phone, not four. Each tile carries a word AND a line of detail, so four
        tracks on a 393 px screen left about 37 CSS px for the label and every one wrapped to a
        single character per line.

        QuickActionCard rather than a button of our own, for the reason recorded in its own comment:
        it puts the icon ABOVE a label that is free to wrap, so the label never competes with the
        icon for a narrow track. A hand-rolled row put them side by side, which cost the label
        another 40 CSS px and clipped every one of the four at the largest Text size.
      */}
      <ProfileActionGrid compactColumns={2} mediumColumns={2} expandedColumns={4} cardDensity="compact">
        {resolved.map(({ tile, resolved: entry }) => {
          if (!entry) return null;
          const emptyRecent = tile.entryId === "action.recently-played" && recentIsEmpty;
          const enabled = entry.enabled && !emptyRecent;
          // Shown as the card's own description, so the reason a tile cannot run is on screen
          // rather than only in an accessible name. A tile that vanishes teaches nothing, and one
          // greyed with no explanation teaches less.
          const description = enabled
            ? (tile.detail ?? undefined)
            : ((emptyRecent ? t("home.tile.recent.empty", "Nothing has been opened yet") : entry.disabledReason) ??
              undefined);
          return (
            <QuickActionCard
              key={tile.entryId}
              icon={tile.icon}
              label={tile.label}
              description={description}
              disabled={!enabled}
              onClick={() => void activate(entry)}
              dataTestId={`home-tile-${tile.entryId}`}
            />
          );
        })}
      </ProfileActionGrid>
    </CollapsibleSection>
  );
};
