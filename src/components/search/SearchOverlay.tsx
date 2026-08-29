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
import { isHvscInstalled } from "@/lib/hvsc/hvscStateStore";
import { useSearchTier2 } from "@/hooks/useSearchTier2";
import { PROMOTED_ENTRY_IDS } from "@/lib/search/promoted";
import { SKIP_ATTR, isDeviceBackKey, resolveInputProfile, resolveSemanticAction } from "@/lib/input";
import { t } from "@/lib/i18n";
import { resolveSearchHandler } from "@/lib/search/handlers";
import { recordPickedEntry, recordRecentQuery, loadRecentQueries } from "@/lib/search/history";
import { getSearchEntries } from "@/lib/search/registry";
import { resolveEntry } from "@/lib/search/requirements";
import { navigateToSearchTarget } from "@/lib/search/navigate";
import { markSearchKeystroke, markSearchResultsPainted } from "@/lib/search/latencyProbe";
import { SEARCH_OVERLAY_TESTID, subscribeSearchClose, type SearchOpenRequest } from "@/lib/search/overlayState";
import { GROUP_WEIGHTS, compareWithinGroup, type ScoredEntry } from "@/lib/search/score";
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

/**
 * Tie-break order when two groups' best rows score the same, and the order tier 2 lands in.
 *
 * Derived from the ranking's own group weights rather than written out again. The two lists said
 * the same thing in two files, and the one here would have gone on saying it after the weights in
 * `score.ts` changed.
 */
const GROUP_ORDER: readonly SearchGroup[] = (Object.keys(GROUP_WEIGHTS) as SearchGroup[]).sort(
  (left, right) => GROUP_WEIGHTS[right] - GROUP_WEIGHTS[left],
);

/** The four capabilities that are one action from Home, offered as chips on an empty query. */
const rowId = (entryId: string) => `search-row-${entryId.replace(/[^a-zA-Z0-9-]/g, "-")}`;
const recentQueryId = (query: string) => `search-recent-${query.replace(/[^a-zA-Z0-9-]/g, "-")}`;
/*
 * The DOM id of each keyboard stop, which is also its testid.
 *
 * One expression per kind, not two: the arrow keys find a stop by id and the tests find it by
 * testid, and when those were written out separately a renamed row was reachable by one and not the
 * other.
 */
const moreStopId = (group: SearchGroup) => `search-more-${group}`;
const EMPTY_PLAY_STOP_ID = "search-empty-play";

/** Keypad bindings prepended to the keyboard ones, so a D-pad and a keyboard both resolve here. */
const OVERLAY_KEYMAP = resolveInputProfile("keypad");

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
    .map(([group, unsorted]) => {
      // Sorted here, where the group exists: an entry whose requirements are unmet sorts last, so a
      // disabled row cannot take one of the rows this group shows from an enabled one.
      const all = [...unsorted].sort(compareWithinGroup);
      return { group, all };
    })
    .map(({ group, all }) => ({
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

  /*
   * Read, not assumed. Passing a literal `true` made every entry that requires the archive resolve
   * as available: on an installation where it has never been prepared, "Find a tune" was offered
   * enabled and opened a sheet with nothing to search, instead of saying what it needs and offering
   * the row that installs it. The state is a localStorage read, taken once per open.
   */
  const hvscReady = useMemo(() => isHvscInstalled(), [request]);
  const ctx = useRequirementContext(hvscReady);
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

  const grouped = useMemo(() => {
    const sections = groupResults([...results, ...tier2Scored], expandedGroups);
    /*
     * A music heading while the archive is still being scanned, even with nothing in it yet.
     *
     * The spinner is drawn in that heading, and the heading only existed once tier 2 had produced a
     * hit — so the one thing it is there to say, that results are still coming, was never on screen
     * during the wait it describes.
     */
    if (!tier2.isSearching || sections.some((section) => section.group === "music")) return sections;
    return [...sections, { group: "music" as const, rows: [], total: 0 }];
  }, [results, tier2Scored, expandedGroups, tier2.isSearching]);
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
    // Expanding a group is an answer to one query. Left standing, "More in Settings (12)" kept every
    // later query's Settings group uncapped for the rest of the session, and the five-row cap — and
    // the keystroke cost it exists to bound — quietly stopped applying.
    setExpandedGroups(new Set());
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

  const hasQuery = query.trim() !== "";

  /*
   * Everything the arrow keys can reach, in the order it is drawn.
   *
   * The overlay carries `data-key-nav-skip`, so the app's focus ring stays out of it and these keys
   * are the only way around on a keypad. Cycling the result rows alone left the promoted chips, the
   * recent searches, each "More in ..." button and the empty state's "Open Play" reachable by
   * pointer only, which is not a keypad-first app.
   */
  const keyStops = useMemo<ReadonlyArray<{ readonly id: string; readonly run: () => void }>>(() => {
    if (!hasQuery) {
      return [
        ...promoted.map((resolved) => ({ id: rowId(resolved.entry.id), run: () => void activate(resolved) })),
        ...recentQueries.map((recent) => ({ id: recentQueryId(recent), run: () => setQuery(recent) })),
      ];
    }
    if (flatRows.length === 0) {
      return tier2.isSearching ? [] : [{ id: EMPTY_PLAY_STOP_ID, run: openPlayAndClose }];
    }
    return grouped.flatMap((section) => [
      ...section.rows.map((scored) => ({
        id: rowId(scored.resolved.entry.id),
        run: () => void activate(scored.resolved),
      })),
      ...(section.total > section.rows.length
        ? [
            {
              id: moreStopId(section.group),
              run: () => setExpandedGroups((current) => new Set(current).add(section.group)),
            },
          ]
        : []),
    ]);
  }, [activate, flatRows.length, grouped, hasQuery, openPlayAndClose, promoted, recentQueries, tier2.isSearching]);

  const activeStopId = keyStops[activeIndex]?.id ?? null;

  /*
   * Read through the keymap, not off `event.key`.
   *
   * A keypad handset's D-pad emits `code: "DpadDown"` or `keyCode: 20`, never `key: "ArrowDown"`,
   * so a handler that compares key names is inert on exactly the hardware that has no pointer to
   * fall back on. The keypad profile carries the keyboard bindings too, so one lookup serves both.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const action = resolveSemanticAction(OVERLAY_KEYMAP, event);
      // The device Back key resolves to no action at all, so it is asked for by name. Without this
      // the hardware Back button could not close the overlay on the handset.
      if (action === "escape" || action === "back" || isDeviceBackKey(event)) {
        event.preventDefault();
        close();
        return;
      }
      if (action === "dpadDown" || action === "dpadUp") {
        if (keyStops.length === 0) return;
        event.preventDefault();
        const step = action === "dpadDown" ? 1 : -1;
        setActiveIndex((current) => (current + step + keyStops.length) % keyStops.length);
        return;
      }
      if (action === "enter" || action === "center" || action === "activate") {
        const stop = keyStops[activeIndex];
        if (!stop) return;
        event.preventDefault();
        stop.run();
      }
    },
    [activeIndex, close, keyStops],
  );

  /*
   * Keep the active row visible without moving focus, which stays in the field.
   *
   * Keyed on the active row's ID, not on `flatRows`. That array is a new identity on every render,
   * so depending on it ran scrollIntoView on every keystroke — a forced synchronous reflow whose
   * cost appears the moment the list is non-empty and does not scale with the number of rows.
   * Measured on the handset: 82 ms at p50 with results against 19 ms with none.
   */
  const scrolledToRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeStopId === null || scrolledToRef.current === activeStopId) return;
    scrolledToRef.current = activeStopId;
    listRef.current?.querySelector(`#${CSS.escape(activeStopId)}`)?.scrollIntoView({ block: "nearest" });
  }, [activeStopId]);

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
          aria-activedescendant={activeStopId ?? undefined}
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
        /*
         * Everything the arrow keys can stop on carries role="option", including the promoted
         * chips, the recent searches, each "More in ..." button and the empty state's Open Play.
         * A listbox may only contain options, and aria-activedescendant may only name one — those
         * four were plain buttons inside it, so the row the combobox claimed was active was
         * sometimes not an option at all.
         */
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
                  id={rowId(resolved.entry.id)}
                  role="option"
                  aria-selected={activeStopId === rowId(resolved.entry.id)}
                  className={cn(
                    "min-h-11 rounded-full border border-border px-4 text-sm disabled:opacity-50",
                    activeStopId === rowId(resolved.entry.id) && "bg-muted",
                  )}
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
                    id={recentQueryId(recent)}
                    role="option"
                    aria-selected={activeStopId === recentQueryId(recent)}
                    onClick={() => setQuery(recent)}
                    className={cn(
                      "flex min-h-11 w-full items-center rounded-md px-2 text-left text-sm hover:bg-muted",
                      activeStopId === recentQueryId(recent) && "bg-muted",
                    )}
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
            <Button
              id={EMPTY_PLAY_STOP_ID}
              role="option"
              aria-selected={activeStopId === EMPTY_PLAY_STOP_ID}
              variant="outline"
              onClick={openPlayAndClose}
              className={cn(activeStopId === EMPTY_PLAY_STOP_ID && "bg-muted")}
              data-testid={EMPTY_PLAY_STOP_ID}
            >
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
                const isActive = activeStopId === rowId(entry.id);
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
                  id={moreStopId(section.group)}
                  role="option"
                  aria-selected={activeStopId === moreStopId(section.group)}
                  onClick={() => setExpandedGroups((current) => new Set(current).add(section.group))}
                  className={cn(
                    "flex min-h-11 w-full items-center px-2 text-left text-sm text-primary",
                    activeStopId === moreStopId(section.group) && "bg-muted",
                  )}
                  data-testid={moreStopId(section.group)}
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
