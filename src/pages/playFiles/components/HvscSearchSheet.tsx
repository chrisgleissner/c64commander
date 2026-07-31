/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Play, Radio, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useHvscArchiveSearch, type HvscSearchHit } from "@/pages/playFiles/hooks/useHvscArchiveSearch";

export type HvscSearchSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Play this tune now.
   *
   * While a station is running it is played as an interruption: the station keeps its place and
   * carries on the moment the tune ends. See `insertTuneNext` on the Play page.
   */
  onPlay: (hit: HvscSearchHit) => void;
  /**
   * Start a new station seeded by this tune, or undefined when that is not possible.
   *
   * A tune the similarity corpus has never heard of can be played but cannot seed anything, so the
   * action is hidden per row rather than offered and then failing.
   */
  onStartStation?: (hit: HvscSearchHit) => void;
  canSeedStation?: (hit: HvscSearchHit) => boolean;
  /** True while a station is running, which is what makes the play action an interruption. */
  stationActive: boolean;
};

/**
 * Reaching for a particular tune, by name, anywhere in HVSC.
 *
 * A station is endless and chooses for you, which is the point of it — right up to the moment you
 * want to hear one specific thing. Before this there was no way to do that without stopping the
 * station, going to the picker, drilling down through the composer folders to a tune you could
 * already name, adding it to the playlist and losing the station entirely.
 *
 * So the tune is played as an interruption rather than as a replacement: the station keeps its
 * place, the tune plays, and the station carries on. Seeding a new station from what was found is
 * the other thing people want here, and it is one tap away on the same row.
 */
export const HvscSearchSheet = ({
  open,
  onOpenChange,
  onPlay,
  onStartStation,
  canSeedStation,
  stationActive,
}: HvscSearchSheetProps) => {
  const search = useHvscArchiveSearch({ enabled: open });
  /**
   * Whether the explanatory text is still worth its height.
   *
   * The keyboard takes roughly half this sheet the moment the field is focused, and measured on a
   * Pixel 4 the three-line description plus the title left about one and a half result rows visible,
   * with the second clipped mid-line. The description is onboarding — it answers "what does this
   * search do" — and once somebody has typed they have stopped asking that and started reading
   * results. So it is spent on the empty state and reclaimed for the list afterwards.
   */
  const showIntro = !search.query.trim();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex max-h-[85vh] flex-col" data-testid="hvsc-search-sheet">
        <SheetHeader className={showIntro ? undefined : "pb-0"}>
          <SheetTitle className={showIntro ? undefined : "text-base"}>Find a tune</SheetTitle>
          {showIntro ? (
            <SheetDescription>
              {stationActive
                ? "Search the whole of HVSC by title or composer. The station keeps its place and carries on afterwards."
                : "Search the whole of HVSC by title or composer."}
            </SheetDescription>
          ) : (
            // The dialog primitive requires a description for its accessible name, so it stays in
            // the tree and out of the layout rather than being removed.
            <SheetDescription className="sr-only">Search the whole of HVSC by title or composer.</SheetDescription>
          )}
        </SheetHeader>

        <div className="flex items-center gap-2 pt-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            autoFocus
            placeholder="Title or composer…"
            value={search.query}
            onChange={(event) => search.setQuery(event.target.value)}
            data-testid="hvsc-search-input"
            aria-label="Search HVSC by title or composer"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pt-2" data-testid="hvsc-search-results">
          {search.indexUnavailable ? (
            <p className="text-sm text-muted-foreground" data-testid="hvsc-search-unavailable">
              The HVSC index is not ready yet. Install or open the library once, then search again.
            </p>
          ) : !search.query.trim() ? (
            <p className="text-sm text-muted-foreground">
              Type part of a title or a composer's name — "commando", "hubbard", or both.
            </p>
          ) : search.hits.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="hvsc-search-empty">
              {search.isSearching || !search.hasSearched ? "Searching…" : "Nothing found. Try a shorter search."}
            </p>
          ) : (
            <>
              {/* One line, always. The advice to narrow the search used to be spelled out and wrapped
                  onto a second line, which on a phone with the keyboard up costs a whole result row —
                  and the results are ranked, so the best answers are already at the top whether or
                  not the list was capped. */}
              <p className="pb-2 text-xs text-muted-foreground" data-testid="hvsc-search-count">
                {search.totalCount > search.hits.length
                  ? `${search.hits.length} of ${search.totalCount} matches`
                  : `${search.totalCount} ${search.totalCount === 1 ? "match" : "matches"}`}
              </p>
              {/* Enough of a gap to read as separate results, and no more. Each row is three lines
                  of its own — title, composer, folder — so without a clear gap between the cards
                  the lines of one result run into the next. The keyboard leaves this list very
                  little room, which is why the space goes between the rows rather than inside
                  them. */}
              <ul className="flex flex-col gap-2">
                {search.hits.map((hit) => {
                  const seedable = Boolean(onStartStation) && (canSeedStation?.(hit) ?? true);
                  return (
                    <li
                      key={hit.virtualPath}
                      className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5"
                      data-testid="hvsc-search-row"
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-w-0 flex-1 justify-start gap-2 py-1 text-left"
                        data-testid="hvsc-search-play"
                        title={stationActive ? `Play ${hit.title} now, then carry on` : `Play ${hit.title}`}
                        onClick={() => {
                          // Act first, close second: the action is the point, and a handler that
                          // needed this sheet still mounted would otherwise break silently.
                          onPlay(hit);
                          onOpenChange(false);
                        }}
                      >
                        <Play className="shrink-0" aria-hidden="true" />
                        {/* Tight leading, because the keyboard leaves this list very little room and
                            three loosely-spaced lines per row meant barely two rows were readable. */}
                        <span className="min-w-0 leading-tight">
                          <span className="block truncate text-sm font-medium">{hit.title}</span>
                          {hit.author ? (
                            <span className="block truncate text-xs text-muted-foreground">{hit.author}</span>
                          ) : null}
                          <span className="block truncate text-[11px] text-muted-foreground/70">{hit.folder}</span>
                        </span>
                      </Button>
                      {seedable ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          data-testid="hvsc-search-start-station"
                          aria-label={`Start a station from ${hit.title}`}
                          title="Start a station from this tune"
                          onClick={() => {
                            onStartStation?.(hit);
                            onOpenChange(false);
                          }}
                        >
                          <Radio />
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
