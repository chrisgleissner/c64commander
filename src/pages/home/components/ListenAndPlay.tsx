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
import { ProfileActionGrid } from "@/components/layout/PageContainer";
import { toast } from "@/hooks/use-toast";
import { useRequirementContext } from "@/hooks/useSearchResults";
import { t } from "@/lib/i18n";
import { addErrorLog } from "@/lib/logging";
import { loadRecentlyPlayed } from "@/lib/sidRadio/recentlyPlayed";
import { resolveSearchHandler } from "@/lib/search/handlers";
import { navigateToSearchTarget } from "@/lib/search/navigate";
import { resolveEntry } from "@/lib/search/requirements";
import { getSearchEntries } from "@/lib/search/registry";
import { PLAYBACK_SESSION_KEY } from "@/pages/playFiles/playFilesUtils";
import { cn } from "@/lib/utils";
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

  const ctx = useRequirementContext(true);

  const tiles = useMemo<Tile[]>(
    () => [
      { entryId: "action.sid-radio", icon: Radio, label: t("home.tile.radio", "Radio") },
      { entryId: "action.resume-session", icon: Play, label: t("home.tile.resume", "Resume"), detail: sessionLabel },
      {
        entryId: "action.recently-played",
        icon: History,
        label: t("home.tile.recent", "Recent"),
        detail: recentCount > 0 ? `${recentCount}` : null,
      },
      { entryId: "home.section.live-view", icon: Monitor, label: t("home.tile.liveView", "Live View") },
    ],
    [recentCount, sessionLabel],
  );

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
      summary={t("home.listenAndPlay.summary", "Music and games that need no C64 attached")}
      icon={Radio}
      defaultOpen
      testId="home-listen-and-play"
    >
      {/*
        Two columns on a phone, not four. Each tile carries a word AND a line of detail, so four
        tracks on a 393 px screen leave about 37 CSS px for the label and every one of them wraps to
        a single character per line — measured, and visible in the corpus before this was set.
      */}
      <ProfileActionGrid compactColumns={2} mediumColumns={2} expandedColumns={4} cardDensity="compact">
        {resolved.map(({ tile, resolved: entry }) => {
          if (!entry) return null;
          const emptyRecent = tile.entryId === "action.recently-played" && recentIsEmpty;
          const enabled = entry.enabled && !emptyRecent;
          const reason = emptyRecent
            ? t("home.tile.recent.empty", "Nothing has been opened yet")
            : entry.disabledReason;
          const Icon = tile.icon;
          return (
            <button
              key={tile.entryId}
              type="button"
              disabled={!enabled}
              onClick={() => void activate(entry)}
              data-testid={`home-tile-${tile.entryId}`}
              // The reason is in the accessible name, not only the tooltip: a tile that vanishes
              // teaches nothing, and one that is greyed with no explanation teaches less.
              aria-label={enabled ? tile.label : `${tile.label}. ${reason ?? ""}`}
              className={cn(
                "flex min-h-11 flex-col items-start justify-center gap-1 rounded-panel border border-border bg-card p-3 text-left",
                enabled ? "hover:bg-muted/60" : "opacity-60",
              )}
            >
              <span className="flex w-full min-w-0 items-center gap-2 text-sm font-medium">
                <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                {/* min-w-0 and a word break, so a narrow track truncates the label rather than
                    breaking it down the middle of a word. */}
                <span className="min-w-0 truncate">{tile.label}</span>
              </span>
              <span className="line-clamp-2 w-full min-w-0 break-words text-xs text-muted-foreground">
                {enabled ? (tile.detail ?? "") : reason}
              </span>
            </button>
          );
        })}
      </ProfileActionGrid>
    </CollapsibleSection>
  );
};
