/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SourceNavigatorState } from "@/lib/sourceNavigation/useSourceNavigator";

export type ItemSelectionSearchProps = {
  browser: SourceNavigatorState;
  compact: boolean;
  searchText: string;
  onSearchTextChange: (value: string) => void;
  selectedSourceLabel?: string | null;
};

/** The Add items browser's filter field and the choice of where its text searches. */
export const ItemSelectionSearch = ({
  browser,
  compact,
  searchText,
  onSearchTextChange,
  selectedSourceLabel,
}: ItemSelectionSearchProps) => {
  const compactScopeToggle = compact && browser.canSearchSource && searchText.trim().length > 0;
  const needsScanButton = browser.searchScope === "source" && !browser.searchIsInstant;
  const hasSourceSearchActions = needsScanButton || Boolean(browser.isSearching);
  const sourceSearchActions = (
    <>
      {/* A source that has to be walked cannot search while you type, so it gets an explicit action.
          An indexed one answers on its own and needs no button. */}
      {needsScanButton ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => browser.runSourceSearch?.()}
          disabled={browser.isLoading || !(browser.query ?? "").trim()}
          data-testid="add-items-deep-scan"
        >
          {browser.isLoading ? "Scanning…" : "Scan"}
        </Button>
      ) : null}
      {browser.isSearching ? (
        <span className="text-xs text-muted-foreground" data-testid="add-items-search-summary">
          {browser.totalCount ?? 0} found
        </span>
      ) : null}
    </>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          className="min-w-0 flex-1"
          placeholder={
            browser.searchScope === "source"
              ? `Search all of ${selectedSourceLabel ?? "this source"}…`
              : "Filter files…"
          }
          value={searchText}
          onChange={(event) => onSearchTextChange(event.target.value)}
          data-testid="add-items-filter"
          aria-label={browser.searchScope === "source" ? "Search the whole source" : "Filter this folder"}
        />
        {/* Compact: one button that switches the reach, on the field's own row. As a row of its
            own it took the file list on a 320 x 427 screen down to 69 px, less than one row. */}
        {compactScopeToggle ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => browser.setSearchScope(browser.searchScope === "folder" ? "source" : "folder")}
            data-testid="add-items-scope-toggle"
            aria-label={
              browser.searchScope === "folder"
                ? "Searching this folder. Search everywhere instead"
                : "Searching everywhere. Search this folder instead"
            }
          >
            {browser.searchScope === "folder" ? "This folder" : "Everywhere"}
          </Button>
        ) : null}
      </div>
      {/* Where the text applies. A filter that only ever sees the folder on screen cannot
          find a tune in an archive filed by composer, so the reach is made explicit and
          switchable rather than assumed. Only shown for a source that can actually search
          beyond the current folder. */}
      {browser.canSearchSource && !compact ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="add-items-search-scope">
          <Button
            type="button"
            variant={browser.searchScope === "folder" ? "default" : "outline"}
            size="sm"
            onClick={() => browser.setSearchScope("folder")}
            data-testid="add-items-scope-folder"
            aria-pressed={browser.searchScope === "folder"}
          >
            This folder
          </Button>
          <Button
            type="button"
            variant={browser.searchScope === "source" ? "default" : "outline"}
            size="sm"
            onClick={() => browser.setSearchScope("source")}
            data-testid="add-items-scope-source"
            aria-pressed={browser.searchScope === "source"}
          >
            Everywhere
          </Button>
          {sourceSearchActions}
        </div>
      ) : null}
      {compactScopeToggle && hasSourceSearchActions ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="add-items-search-scope">
          {sourceSearchActions}
        </div>
      ) : null}
    </div>
  );
};
