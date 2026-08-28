/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2, Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useSearchResults, useRequirementContext, entrySubtitle, entryTitle } from "@/hooks/useSearchResults";
import { useSearchTier2 } from "@/hooks/useSearchTier2";
import { SKIP_ATTR } from "@/lib/input";
import { t } from "@/lib/i18n";
import { resolveSearchHandler } from "@/lib/search/handlers";
import { recordPickedEntry, recordRecentQuery, loadRecentQueries } from "@/lib/search/history";
import { getSearchEntries } from "@/lib/search/registry";
import { resolveEntry } from "@/lib/search/requirements";
import { navigateToSearchTarget } from "@/lib/search/navigate";
import { markSearchKeystroke, markSearchResultsPainted } from "@/lib/search/latencyProbe";
import { SEARCH_OVERLAY_TESTID, subscribeSearchClose, type SearchOpenRequest } from "@/lib/search/overlayState";
import type { ScoredEntry } from "@/lib/search/score";
import type { ResolvedSearchEntry, SearchEntry, SearchGroup } from "@/lib/search/types";
import { cn } from "@/lib/utils";

/**
 * The one search surface, opened by all three doors (spec.md sections 5.7 and 5.8).
 *
 * It owns its own keyboard handling and does not reuse the focus ring. That is not a preference:
 * the ring deliberately ignores keys while an editable element has focus, and inside a dialog its
 * Up/Down move real DOM focus through tabbables — which would pull focus out of the field on the
 * first press and stop the user typing. So Up, Down, Enter and Escape are handled on the input,
 * focus stays in the field, and the active row is tracked with aria-activedescendant. The root
 * carries `data-key-nav-skip`, which both keeps the discovery engine out of the rows and tells the
 * engine this subtree drives its own keys.
 */

/** At most five rows per group before a "More in ..." row (spec.md section 5.7). */
const ROWS_PER_GROUP = 5;

const GROUP_LABELS: Readonly<Record<SearchGroup, string>> = {
  action: "Actions",
  page: "Pages",
  setting: "Settings",
  config: "Device settings",
  music: "Music",
  disk: "Disks",
  docs: "Docs",
};

/** Tie-break order when two groups' best rows score the same, and the order tier 2 lands in. */
const GROUP_ORDER: readonly SearchGroup[] = ["action", "page", "setting", "config", "docs", "disk", "music"];

/** The four capabilities that are one action from Home, offered as chips on an empty query. */
const PROMOTED_ENTRY_IDS = ["action.sid-radio", "action.resume-session", "action.recently-played", "page.play"];

const rowId = (entryId: string) => `search-row-${entryId.replace(/[^a-zA-Z0-9-]/g, "-")}`;

interface GroupedResults {
  readonly group: SearchGroup;
  readonly rows: readonly ScoredEntry[];
  readonly total: number;
}

/**
 * Groups are drawn in the order of their BEST row, not in a fixed order.
 *
 * A fixed order would put the group weights twice: once inside the ranking and once again in the
 * layout, and the second application wins. Typing "settings" then draws the Actions group — whose
 * best row only matched a subtitle — above the Pages group holding the exact title match. Ordering
 * on the best score keeps section 5.6's ranking as the thing that decides.
 */
const groupResults = (results: readonly ScoredEntry[], expanded: ReadonlySet<SearchGroup>): GroupedResults[] => {
  const byGroup = new Map<SearchGroup, ScoredEntry[]>();
  for (const scored of results) {
    const bucket = byGroup.get(scored.resolved.entry.group);
    if (bucket) bucket.push(scored);
    else byGroup.set(scored.resolved.entry.group, [scored]);
  }
  return [...byGroup.entries()]
    .map(([group, all]) => ({
      group,
      rows: expanded.has(group) ? all : all.slice(0, ROWS_PER_GROUP),
      total: all.length,
      best: Math.max(...all.map((scored) => scored.score)),
    }))
    .sort((left, right) =>
      left.best === right.best
        ? GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group)
        : right.best - left.best,
    )
    .map(({ group, rows, total }) => ({ group, rows, total }));
};

export interface SearchOverlayProps {
  /** A new object per open request, so re-opening while already open re-seeds the field. */
  readonly request: SearchOpenRequest;
  readonly onClose: () => void;
}

export const SearchOverlay = ({ request, onClose }: SearchOverlayProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState(request.initialQuery ?? "");
  const [activeIndex, setActiveIndex] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<SearchGroup>>(new Set());
  const [recentQueries, setRecentQueries] = useState<readonly string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // HVSC readiness is not probed here: an entry that needs it says so, and the resolver's own
  // reason is what a disabled row shows. Tier 2 music results carry their own readiness state.
  const ctx = useRequirementContext(true);
  const { results } = useSearchResults(query, ctx);
  const tier2 = useSearchTier2(query, true);

  // Appended, never merged into the synchronous pass: tiers 0 and 1 have already committed with
  // the keystroke, and tier 2 lands whenever its debounce returns.
  const tier2Scored = useMemo<ScoredEntry[]>(
    () =>
      tier2.entries.map((entry) => ({
        resolved: resolveEntry(entry, ctx),
        score: 0,
        title: entryTitle(entry),
      })),
    [tier2.entries, ctx],
  );

  const grouped = useMemo(
    () => groupResults([...results, ...tier2Scored], expandedGroups),
    [results, tier2Scored, expandedGroups],
  );
  const flatRows = useMemo(() => grouped.flatMap((section) => section.rows), [grouped]);

  // Resolved from the registry, not from `results`: an empty query ranks nothing, and the chips
  // are exactly what an empty query shows.
  const promoted = useMemo(
    () =>
      PROMOTED_ENTRY_IDS.map((id) => getSearchEntries().find((entry) => entry.id === id))
        .filter((entry): entry is SearchEntry => entry !== undefined)
        .map((entry) => resolveEntry(entry, ctx)),
    [ctx],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  /*
   * The end of the keystroke-to-painted-list interval (spec.md section 5.5).
   *
   * This effect runs after the results have committed, and the frame callback it schedules runs
   * after the browser has painted them — so the measurement covers scoring, reconciliation and the
   * paint, rather than the part that is easy to time. It costs one boolean read when the probe is
   * off, which is always outside a HIL run.
   */
  useEffect(() => {
    const frame = requestAnimationFrame(markSearchResultsPainted);
    return () => cancelAnimationFrame(frame);
  }, [flatRows]);

  const close = useCallback(() => {
    setQuery("");
    setExpandedGroups(new Set());
    onClose();
  }, [onClose]);

  // Re-seeded on a fresh request, so a second door opened while this one is already up starts over.
  useEffect(() => {
    setQuery(request.initialQuery ?? "");
    setExpandedGroups(new Set());
    setRecentQueries(loadRecentQueries());
  }, [request]);

  useEffect(() => subscribeSearchClose(close), [close]);

  useEffect(() => {
    // After the paint, so the field is in the document and the keyboard opens once.
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  const activate = useCallback(
    async (resolved: ResolvedSearchEntry) => {
      const { entry, enabled, remedyTarget, disabledReason } = resolved;
      const target = enabled ? entry.target : (remedyTarget ?? null);
      if (!target) {
        toast({ title: entryTitle(entry), description: disabledReason ?? undefined });
        return;
      }
      recordPickedEntry(entry.id);
      if (query.trim() !== "") recordRecentQuery(query);
      const label = entryTitle(entry);
      const result = await navigateToSearchTarget(target, {
        navigate: (path) => navigate(path),
        currentPath: location.pathname,
        label,
        onToast: (message) => toast({ title: message, variant: "destructive" }),
        runAction: (handlerId) =>
          resolveSearchHandler(handlerId)?.({ navigate: (path) => navigate(path), currentPath: location.pathname }),
      });
      // A guard refused: the overlay stays open so the user can see the page saying why.
      if (result !== "blocked") close();
    },
    [close, location.pathname, navigate, query],
  );

  /** The "nearest group" an empty result set offers: Play, which owns the music archive search. */
  const openPlayAndClose = useCallback(() => {
    navigate("/play");
    close();
  }, [close, navigate]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (flatRows.length === 0) return;
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((current) => (current + step + flatRows.length) % flatRows.length);
        return;
      }
      if (event.key === "Enter") {
        const scored = flatRows[activeIndex];
        if (!scored) return;
        event.preventDefault();
        void activate(scored.resolved);
      }
    },
    [activate, activeIndex, close, flatRows],
  );

  // Keep the active row visible without moving focus, which stays in the field.
  useEffect(() => {
    const scored = flatRows[activeIndex];
    if (!scored) return;
    listRef.current?.querySelector(`#${CSS.escape(rowId(scored.resolved.entry.id))}`)?.scrollIntoView({
      block: "nearest",
    });
  }, [activeIndex, flatRows]);

  const activeRow = flatRows[activeIndex];
  const hasQuery = query.trim() !== "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("search.title", "Search")}
      data-testid={SEARCH_OVERLAY_TESTID}
      {...{ [SKIP_ATTR]: "true" }}
      className="fixed inset-0 z-[70] flex flex-col bg-background"
      style={{ paddingTop: "var(--app-safe-area-top, 0px)", paddingBottom: "var(--app-safe-area-bottom, 0px)" }}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <Input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={flatRows.length > 0}
          aria-controls="search-results-listbox"
          aria-autocomplete="list"
          aria-activedescendant={activeRow ? rowId(activeRow.resolved.entry.id) : undefined}
          placeholder={t("search.placeholder", "Search the app")}
          value={query}
          onChange={(event) => {
            markSearchKeystroke();
            setQuery(event.target.value);
          }}
          onKeyDown={onKeyDown}
          data-testid="search-input"
          className="border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={close}
          aria-label={t("search.close", "Close search")}
          data-testid="search-close"
          className="size-11 shrink-0"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div
        ref={listRef}
        role="listbox"
        id="search-results-listbox"
        aria-label={t("search.results", "Search results")}
        {...{ [SKIP_ATTR]: "true" }}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-4"
        data-testid="search-results"
      >
        {!hasQuery ? (
          <div className="space-y-4 py-3">
            <div className="flex flex-wrap gap-2" data-testid="search-promoted">
              {promoted.map((resolved) => (
                <button
                  key={resolved.entry.id}
                  type="button"
                  onClick={() => void activate(resolved)}
                  disabled={!resolved.enabled && !resolved.remedyTarget}
                  title={resolved.disabledReason ?? undefined}
                  className="min-h-11 rounded-full border border-border px-4 text-sm disabled:opacity-50"
                  data-testid={`search-chip-${resolved.entry.id}`}
                >
                  {entryTitle(resolved.entry)}
                </button>
              ))}
            </div>
            {recentQueries.length > 0 ? (
              <div className="space-y-1" data-testid="search-recent">
                <p className="px-1 text-xs font-medium text-muted-foreground" aria-hidden>
                  {t("search.recent", "Recent searches")}
                </p>
                {recentQueries.map((recent) => (
                  <button
                    key={recent}
                    type="button"
                    onClick={() => setQuery(recent)}
                    className="flex min-h-11 w-full items-center rounded-md px-2 text-left text-sm hover:bg-muted"
                  >
                    {recent}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : flatRows.length === 0 && !tier2.isSearching ? (
          <div className="space-y-2 py-10 text-center" data-testid="search-empty">
            <p className="text-sm text-foreground">
              {t("search.noMatches", "Nothing matches")} “{query}”
            </p>
            <p className="text-xs text-muted-foreground">
              {t("search.noMatchesHint", "Try a shorter word, or open Play to search the music archive.")}
            </p>
            <Button variant="outline" onClick={openPlayAndClose} data-testid="search-empty-play">
              {t("search.openPlay", "Open Play")}
            </Button>
          </div>
        ) : (
          grouped.map((section) => (
            <div key={section.group} className="py-2">
              {/* Presentational: the group name is folded into each option's accessible name. */}
              <p className="flex items-center gap-2 px-1 pb-1 text-xs font-medium text-muted-foreground" aria-hidden>
                {GROUP_LABELS[section.group]}
                {section.group === "music" && tier2.isSearching ? (
                  <Loader2 className="h-3 w-3 animate-spin" data-testid="search-music-spinner" />
                ) : null}
              </p>
              {section.rows.map((scored) => {
                const { entry, enabled, disabledReason } = scored.resolved;
                const title = entryTitle(entry);
                const subtitle = entrySubtitle(entry);
                const isActive = activeRow?.resolved.entry.id === entry.id;
                return (
                  <div
                    key={entry.id}
                    id={rowId(entry.id)}
                    role="option"
                    aria-selected={isActive}
                    aria-disabled={!enabled}
                    aria-label={`${GROUP_LABELS[section.group]}: ${title}${enabled ? "" : `. ${disabledReason ?? ""}`}`}
                    onClick={() => void activate(scored.resolved)}
                    data-testid={`search-result-${entry.id}`}
                    data-active={isActive ? "true" : undefined}
                    className={cn(
                      "flex min-h-11 cursor-pointer flex-col justify-center rounded-md px-2 py-1.5",
                      isActive ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <span className={cn("text-sm", enabled ? "text-foreground" : "text-muted-foreground")}>
                      {title}
                    </span>
                    {enabled ? (
                      subtitle ? (
                        <span className="text-xs text-muted-foreground">{subtitle}</span>
                      ) : null
                    ) : (
                      <span className="text-xs text-muted-foreground">{disabledReason}</span>
                    )}
                  </div>
                );
              })}
              {section.total > section.rows.length ? (
                <button
                  type="button"
                  onClick={() => setExpandedGroups((current) => new Set(current).add(section.group))}
                  className="flex min-h-11 w-full items-center px-2 text-left text-sm text-primary"
                  data-testid={`search-more-${section.group}`}
                >
                  {t("search.more", "More in")} {GROUP_LABELS[section.group]} ({section.total})
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default SearchOverlay;
