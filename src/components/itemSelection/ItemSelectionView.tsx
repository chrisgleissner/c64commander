/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef } from "react";
import { ArrowUp, ChevronRight, Folder, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PathWrap } from "@/components/PathWrap";
import { getInputModality } from "@/lib/input";
import type { SourceEntry } from "@/lib/sourceNavigation/types";

export type ItemSelectionViewProps = {
  path: string;
  rootPath: string;
  entries: SourceEntry[];
  isLoading: boolean;
  showLoadingIndicator?: boolean;
  selection: Map<string, SourceEntry>;
  onToggleSelect: (entry: SourceEntry) => void;
  onOpen: (path: string) => void;
  onNavigateUp: () => void;
  onNavigateRoot: () => void;
  onRefresh: () => void;
  showFolderSelect: boolean;
  emptyLabel: string;
};

export const ItemSelectionView = ({
  path,
  rootPath,
  entries,
  isLoading,
  showLoadingIndicator = false,
  selection,
  onToggleSelect,
  onOpen,
  onNavigateUp,
  onNavigateRoot,
  onRefresh,
  showFolderSelect,
  emptyLabel,
}: ItemSelectionViewProps) => {
  const atRoot = path === rootPath || path === rootPath.replace(/\/$/, "");
  const rootRef = useRef<HTMLDivElement>(null);
  const focusFollowsNavigationRef = useRef(false);
  const navigate = (go: () => void) => {
    focusFollowsNavigationRef.current =
      getInputModality() === "key-navigation" && (rootRef.current?.contains(document.activeElement) ?? false);
    go();
  };
  const handleOpen = (entryPath: string) => navigate(() => onOpen(entryPath));

  // The control that opened a folder is replaced by the folder's entries, and the Up and Root
  // buttons disable while it loads, so focus fell back to the dialog. A keypad reader then walked
  // the whole header again for every folder level.
  useEffect(() => {
    if (isLoading || !focusFollowsNavigationRef.current) return;
    focusFollowsNavigationRef.current = false;
    if (rootRef.current?.contains(document.activeElement)) return;
    rootRef.current
      ?.querySelector<HTMLElement>('[data-testid="source-entry-row"] :is(button, [role="checkbox"]):not(:disabled)')
      ?.focus();
  }, [entries, isLoading]);

  return (
    <div ref={rootRef} className="space-y-3 relative">
      {showLoadingIndicator && (
        <div
          className="absolute right-3 top-2 z-10 rounded-full bg-muted/80 px-2 py-0.5 text-xs text-muted-foreground shadow-elev-1"
          data-testid="ftp-loading"
        >
          Loading…
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(onNavigateRoot)}
          disabled={atRoot || isLoading}
          data-testid="navigate-root"
        >
          Root
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate(onNavigateUp)} disabled={atRoot || isLoading}>
          <ArrowUp className="h-4 w-4 mr-1" />
          Up
        </Button>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={isLoading}>
          <RefreshCw className="h-4 w-4 mr-1" />
          {isLoading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      <div
        id="source-path-label"
        className="flex items-start gap-2 w-full min-w-0 font-semibold text-sm"
        data-testid="source-path-label"
        aria-label={`Path: ${path}`}
      >
        <Folder className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <PathWrap path={path} className="text-foreground" />
        </div>
      </div>

      <div className="space-y-2">
        {entries.length === 0 && <p className="text-xs text-muted-foreground">{emptyLabel}</p>}
        {entries.map((entry) => {
          const isSelected = selection.has(entry.path);
          const canSelect = entry.type === "file" || showFolderSelect;
          const isFolder = entry.type === "dir";
          const canNavigateFolder = isFolder && !isLoading;
          const folderLabel = `Open ${entry.name}`;
          return (
            <div
              key={entry.path}
              className="flex items-center gap-2 min-w-0 border-b border-border/50 py-[0.44rem]"
              data-testid="source-entry-row"
              data-entry-type={entry.type}
              tabIndex={canNavigateFolder ? 0 : undefined}
              onClick={
                canNavigateFolder
                  ? () => {
                      handleOpen(entry.path);
                    }
                  : undefined
              }
              onKeyDown={
                canNavigateFolder
                  ? (event: React.KeyboardEvent) => {
                      if (event.key === "Enter" && !(event.target as HTMLElement).closest('[role="checkbox"]')) {
                        event.preventDefault();
                        handleOpen(entry.path);
                      }
                    }
                  : undefined
              }
            >
              {/* A 44 px box around the 18 px checkbox, centred on it: a tap just beside the box opened the folder. */}
              <div
                className="-mx-[13px] -my-2 flex h-11 w-11 shrink-0 items-center justify-center"
                onClick={(event) => {
                  event.stopPropagation();
                  if ((event.target as HTMLElement).closest('[role="checkbox"]')) return;
                  if (canSelect) onToggleSelect(entry);
                }}
              >
                <Checkbox
                  id={`select-${entry.name}`}
                  checked={isSelected}
                  onCheckedChange={() => canSelect && onToggleSelect(entry)}
                  onClick={(event) => event.stopPropagation()}
                  disabled={!canSelect}
                  aria-label={`Select ${entry.name}`}
                />
              </div>
              {isFolder ? (
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-label={folderLabel}
                  aria-disabled={isLoading ? "true" : undefined}
                  disabled={!canNavigateFolder}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!canNavigateFolder) return;
                    handleOpen(entry.path);
                  }}
                >
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words whitespace-normal">{entry.name}</p>
                    {entry.subtitle ? (
                      <p className="text-xs text-muted-foreground break-words whitespace-normal">{entry.subtitle}</p>
                    ) : null}
                    {entry.detail ? (
                      <p
                        className="text-xs text-muted-foreground/70 break-all whitespace-normal"
                        data-testid="source-entry-detail"
                      >
                        {entry.detail}
                      </p>
                    ) : null}
                  </div>
                </button>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words whitespace-normal">{entry.name}</p>
                    {entry.subtitle ? (
                      <p className="text-xs text-muted-foreground break-words whitespace-normal">{entry.subtitle}</p>
                    ) : null}
                    {entry.detail ? (
                      <p
                        className="text-xs text-muted-foreground/70 break-all whitespace-normal"
                        data-testid="source-entry-detail"
                      >
                        {entry.detail}
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
              {isFolder ? (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
