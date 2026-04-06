/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AppDialog,
  AppDialogBody,
  AppDialogContent,
  AppDialogDescription,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogTitle,
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetFooter,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import { Input } from "@/components/ui/input";
import { FileOriginIcon } from "@/components/FileOriginIcon";
import { cn } from "@/lib/utils";
import { reportUserError } from "@/lib/uiErrors";
import type { SourceEntry, SelectedItem, SourceLocation } from "@/lib/sourceNavigation/types";
import { SOURCE_LABELS } from "@/lib/sourceNavigation/sourceTerms";
import type { AddItemsProgressState } from "./AddItemsProgressOverlay";
import { useSourceNavigator } from "@/lib/sourceNavigation/useSourceNavigator";
import { ItemSelectionView } from "./ItemSelectionView";
import { ArchiveSelectionView, archiveResultKey } from "./ArchiveSelectionView";
import type { ArchiveSearchResult, ArchiveClientConfigInput } from "@/lib/archive/types";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { LEGAL_NOTICE } from "@/components/archive/OnlineArchiveDialog";

const isLocalAutoConfirmDisabled = () =>
  typeof window !== "undefined" &&
  Boolean((window as Window & { __c64uDisableLocalAutoConfirm?: boolean }).__c64uDisableLocalAutoConfirm);

export type SourceGroup = {
  label: string;
  sources: SourceLocation[];
};

export type ItemSelectionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  confirmLabel: string;
  initialSourceId?: string | null;
  sourceGroups: SourceGroup[];
  onAddLocalSource: () => Promise<string | null>;
  onConfirm: (source: SourceLocation, selections: SelectedItem[]) => Promise<boolean>;
  filterEntry?: (entry: SourceEntry) => boolean;
  allowFolderSelection?: boolean;
  selectionMode?: "single" | "multiple";
  isConfirming?: boolean;
  autoConfirmLocalSource?: boolean;
  progress?: AddItemsProgressState;
  showProgressFooter?: boolean;
  autoConfirmCloseBefore?: boolean;
  onAutoConfirmStart?: (source: SourceLocation) => void;
  onCancelScan?: () => void;
  archiveConfigs?: Record<string, ArchiveClientConfigInput>;
};

export const ItemSelectionDialog = ({
  open,
  onOpenChange,
  title,
  confirmLabel,
  initialSourceId = null,
  sourceGroups,
  onAddLocalSource,
  onConfirm,
  filterEntry,
  allowFolderSelection = true,
  selectionMode = "multiple",
  isConfirming = false,
  autoConfirmLocalSource = false,
  progress,
  showProgressFooter = true,
  autoConfirmCloseBefore = false,
  onAutoConfirmStart,
  onCancelScan,
  archiveConfigs,
}: ItemSelectionDialogProps) => {
  const { profile } = useDisplayProfile();
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Map<string, SourceEntry>>(new Map());
  const [archiveSelection, setArchiveSelection] = useState<Map<string, ArchiveSearchResult>>(new Map());
  const [filterText, setFilterText] = useState("");
  const [pendingLocalSource, setPendingLocalSource] = useState(false);
  const [pendingLocalSourceCount, setPendingLocalSourceCount] = useState(0);
  const [pendingLocalSourceId, setPendingLocalSourceId] = useState<string | null>(null);
  const [autoConfirming, setAutoConfirming] = useState(false);

  const localSources = useMemo(
    () => sourceGroups.flatMap((group) => group.sources).filter((item) => item.type === "local"),
    [sourceGroups],
  );
  const localSourceCount = localSources.length;

  const source = useMemo(() => {
    for (const group of sourceGroups) {
      const match = group.sources.find((item) => item.id === selectedSourceId);
      if (match) return match;
    }
    return null;
  }, [sourceGroups, selectedSourceId]);

  const c64UltimateSource = useMemo(
    () => sourceGroups.flatMap((group) => group.sources).find((item) => item.type === "ultimate") ?? null,
    [sourceGroups],
  );

  const hvscSource = useMemo(
    () => sourceGroups.flatMap((group) => group.sources).find((item) => item.type === "hvsc") ?? null,
    [sourceGroups],
  );

  const commoserveSource = useMemo(
    () => sourceGroups.flatMap((group) => group.sources).find((item) => item.type === "commoserve") ?? null,
    [sourceGroups],
  );

  const isArchiveSource = source?.type === "commoserve";
  const archiveConfig = source ? (archiveConfigs?.[source.id] ?? null) : null;

  const browser = useSourceNavigator(isArchiveSource ? null : source);

  useEffect(() => {
    if (!browser.error || !open) return;
    reportUserError({
      operation: "BROWSE",
      title: "Browse failed",
      description: browser.error,
      context: { sourceId: selectedSourceId },
    });
  }, [browser.error, open, reportUserError, selectedSourceId]);

  useEffect(() => {
    if (!open) return;
    setSelectedSourceId(initialSourceId);
    setSelection(new Map());
    setArchiveSelection(new Map());
    setFilterText("");
    setPendingLocalSource(false);
    setPendingLocalSourceCount(0);
    setPendingLocalSourceId(null);
    setAutoConfirming(false);
  }, [initialSourceId, open]);

  const confirmLocalSource = useCallback(
    async (target: SourceLocation) => {
      if (autoConfirming || isConfirming) return;
      setAutoConfirming(true);
      const selections: SelectedItem[] = [
        {
          type: "dir",
          name: target.name,
          path: target.rootPath,
        },
      ];
      try {
        onAutoConfirmStart?.(target);
        if (autoConfirmCloseBefore) {
          onOpenChange(false);
        }
        const success = await onConfirm(target, selections);
        if (success) {
          if (!autoConfirmCloseBefore) {
            onOpenChange(false);
          }
        }
      } catch (error) {
        reportUserError({
          operation: "ITEM_SELECTION",
          title: "Add items failed",
          description: (error as Error).message,
          error,
        });
      }
      setAutoConfirming(false);
    },
    [
      autoConfirmCloseBefore,
      autoConfirming,
      isConfirming,
      onAutoConfirmStart,
      onConfirm,
      onOpenChange,
      reportUserError,
    ],
  );

  useEffect(() => {
    if (!open || !pendingLocalSource || selectedSourceId) return;
    const targetSource = pendingLocalSourceId
      ? localSources.find((item) => item.id === pendingLocalSourceId)
      : localSourceCount > pendingLocalSourceCount
        ? localSources[0]
        : null;
    if (!targetSource) return;
    setSelectedSourceId(targetSource.id);
    setPendingLocalSource(false);
    setPendingLocalSourceId(null);
    if (autoConfirmLocalSource && !isLocalAutoConfirmDisabled()) {
      void confirmLocalSource(targetSource);
    }
  }, [
    autoConfirmLocalSource,
    confirmLocalSource,
    localSourceCount,
    localSources,
    open,
    pendingLocalSource,
    pendingLocalSourceCount,
    pendingLocalSourceId,
    selectedSourceId,
  ]);

  const visibleEntries = useMemo(() => {
    const filesFiltered = filterEntry
      ? browser.entries.filter((entry) => entry.type === "dir" || filterEntry(entry))
      : browser.entries;
    if (browser.isQueryBacked) return filesFiltered;
    if (!filterText) return filesFiltered;
    const lower = filterText.toLowerCase();
    return filesFiltered.filter(
      (entry) => entry.name.toLowerCase().includes(lower) || entry.path.toLowerCase().includes(lower),
    );
  }, [browser.entries, browser.isQueryBacked, filterEntry, filterText]);

  const toggleSelection = (entry: SourceEntry) => {
    setSelection((prev) => {
      if (selectionMode === "single") {
        if (prev.has(entry.path) && prev.size === 1) {
          return new Map();
        }
        return new Map([[entry.path, entry]]);
      }

      const next = new Map(prev);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.set(entry.path, entry);
      }
      return next;
    });
  };

  const activeSelectionCount = isArchiveSource ? archiveSelection.size : selection.size;

  const handleConfirm = async () => {
    if (!source) return;
    if (isConfirming || autoConfirming) return;
    if (!activeSelectionCount) {
      reportUserError({
        operation: "ITEM_SELECTION",
        title: "Select items",
        description: "Choose at least one item to add.",
      });
      return;
    }
    const selections: SelectedItem[] = isArchiveSource
      ? Array.from(archiveSelection.values()).map((result) => ({
          type: "file" as const,
          name: result.name,
          path: `${result.id}/${result.category}`,
        }))
      : Array.from(selection.values()).map((entry) => ({
          type: entry.type,
          name: entry.name,
          path: entry.path,
          durationMs: entry.durationMs,
          songNr: entry.songNr,
          subsongCount: entry.subsongCount,
          sizeBytes: entry.sizeBytes ?? null,
          modifiedAt: entry.modifiedAt ?? null,
        }));
    try {
      const success = await onConfirm(source, selections);
      if (success) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        onOpenChange(false);
      }
    } catch (error) {
      reportUserError({
        operation: "ITEM_SELECTION",
        title: "Add items failed",
        description: (error as Error).message,
        error,
      });
    }
  };

  const formatElapsed = (ms: number) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  };

  const handleAddLocalSource = async () => {
    if (pendingLocalSource) return;
    setPendingLocalSource(true);
    setPendingLocalSourceCount(localSourceCount);
    setPendingLocalSourceId(null);
    try {
      const newSourceId = await onAddLocalSource();
      if (newSourceId) {
        setPendingLocalSourceId(newSourceId);
        return;
      }
      setPendingLocalSourceId(null);
    } catch (error) {
      setPendingLocalSource(false);
      setPendingLocalSourceId(null);
      reportUserError({
        operation: "LOCAL_FOLDER_PICK",
        title: "Unable to add folder",
        description: (error as Error).message,
        error,
      });
    }
  };

  const interstitialGridClassName = profile === "expanded" ? "grid-cols-2" : "grid-cols-1";
  const interstitialButtonClassName = cn("justify-start min-w-0", profile === "medium" && "w-full min-h-16 px-4 py-3");
  const interstitialLabelClassName = cn("flex min-w-0 flex-col items-start truncate", profile === "medium" && "w-full");
  const interstitialTextClassName = cn(profile === "medium" && "whitespace-normal break-words text-left leading-snug");
  const footerLayoutClassName = profile === "compact" ? "flex-col" : "flex-row items-center justify-between";
  const footerActionsClassName = profile === "compact" ? "flex-row flex-wrap" : "flex-row ml-auto";
  const footerPaddingClassName =
    profile === "compact"
      ? "px-3 pt-1 pb-[calc(0.25rem+var(--safe-area-inset-bottom))]"
      : "px-6 pt-4 pb-[calc(1rem+var(--safe-area-inset-bottom))]";
  const bodyPaddingClassName = profile === "compact" ? "px-3 py-1.5" : "px-6 py-4";
  const sourceContentClassName = profile === "compact" ? "space-y-2" : "space-y-3";
  const selectedSourceLabel = source
    ? source.type === "local"
      ? SOURCE_LABELS.local
      : source.type === "ultimate"
        ? source.name.trim() || SOURCE_LABELS.c64u
        : source.type === "hvsc"
          ? SOURCE_LABELS.hvsc
          : SOURCE_LABELS.commoserve
    : null;
  const selectedSourceOrigin = source?.type ?? null;
  const showArchiveLegalNotice = source?.type === "commoserve";
  const showCompactHeaderConfirm = profile === "compact" && !showArchiveLegalNotice;
  const interstitialOptionContentClassName = "flex min-w-0 w-full items-center justify-start gap-3";
  const interstitialIconClassName = "h-8 w-8 shrink-0 self-center text-[1.75rem]";
  const selectionHeadingIconClassName = "h-5 w-5 shrink-0 text-[1.25rem]";

  if (!source) {
    return (
      <AppDialog open={open} onOpenChange={onOpenChange}>
        <AppDialogContent className="max-w-md">
          <AppDialogHeader>
            <AppDialogTitle className="text-xl">{title}</AppDialogTitle>
            <AppDialogDescription>Choose a source.</AppDialogDescription>
          </AppDialogHeader>
          <AppDialogBody className={bodyPaddingClassName}>
            <div className="space-y-5">
              <p className="text-lg font-semibold text-foreground">Choose source</p>
              <div className={cn("grid gap-2", interstitialGridClassName)} data-testid="import-selection-interstitial">
                <Button
                  variant="outline"
                  className={interstitialButtonClassName}
                  onClick={() => void handleAddLocalSource()}
                  disabled={pendingLocalSource}
                  aria-busy={pendingLocalSource}
                  id="import-option-local"
                  data-testid="import-option-local"
                  aria-label="Add file / folder from Local"
                >
                  <span className={interstitialOptionContentClassName} aria-hidden="true">
                    <FileOriginIcon origin="local" className={interstitialIconClassName} />
                    <span className={interstitialLabelClassName}>
                      <span className={cn("truncate font-medium", interstitialTextClassName)}>
                        {SOURCE_LABELS.local}
                      </span>
                    </span>
                  </span>
                </Button>
                <Button
                  variant="outline"
                  className={interstitialButtonClassName}
                  onClick={() => {
                    if (!c64UltimateSource) return;
                    setPendingLocalSource(false);
                    setSelectedSourceId(c64UltimateSource.id);
                  }}
                  disabled={!c64UltimateSource?.isAvailable}
                  id="import-option-c64u"
                  data-testid="import-option-c64u"
                  aria-label="Add file / folder from C64U"
                >
                  <span className={interstitialOptionContentClassName} aria-hidden="true">
                    <FileOriginIcon origin="ultimate" className={interstitialIconClassName} />
                    <span className={interstitialLabelClassName}>
                      <span className={cn("truncate font-medium", interstitialTextClassName)}>
                        {SOURCE_LABELS.c64u}
                      </span>
                    </span>
                  </span>
                </Button>
                {hvscSource ? (
                  <Button
                    variant="outline"
                    className={interstitialButtonClassName}
                    onClick={() => {
                      if (!hvscSource.isAvailable) return;
                      setPendingLocalSource(false);
                      setSelectedSourceId(hvscSource.id);
                    }}
                    disabled={!hvscSource.isAvailable}
                    id="import-option-hvsc"
                    data-testid="import-option-hvsc"
                    aria-label="Add file / folder from HVSC"
                  >
                    <span className={interstitialOptionContentClassName} aria-hidden="true">
                      <FileOriginIcon origin="hvsc" className={interstitialIconClassName} />
                      <span className={interstitialLabelClassName}>
                        <span className={cn("truncate font-medium", interstitialTextClassName)}>
                          {SOURCE_LABELS.hvsc}
                        </span>
                      </span>
                    </span>
                  </Button>
                ) : null}
                {commoserveSource ? (
                  <Button
                    variant="outline"
                    className={interstitialButtonClassName}
                    onClick={() => {
                      setPendingLocalSource(false);
                      setSelectedSourceId(commoserveSource.id);
                    }}
                    id="import-option-commoserve"
                    data-testid="import-option-commoserve"
                    aria-label={`Search ${SOURCE_LABELS.commoserve}`}
                  >
                    <span className={interstitialOptionContentClassName} aria-hidden="true">
                      <FileOriginIcon origin="commoserve" className={interstitialIconClassName} />
                      <span className={interstitialLabelClassName}>
                        <span className={cn("truncate font-medium", interstitialTextClassName)}>
                          {SOURCE_LABELS.commoserve}
                        </span>
                      </span>
                    </span>
                  </Button>
                ) : null}
              </div>
            </div>
          </AppDialogBody>
          <AppDialogFooter>
            <Button
              variant="outline"
              size={profile === "compact" ? "sm" : "default"}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </AppDialogFooter>
        </AppDialogContent>
      </AppDialog>
    );
  }

  return (
    <AppSheet open={open} onOpenChange={onOpenChange}>
      <AppSheetContent className="overflow-hidden p-0">
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <AppSheetHeader>
            <AppSheetTitle className="text-xl">{title}</AppSheetTitle>
            <AppSheetDescription>Choose a source.</AppSheetDescription>
          </AppSheetHeader>

          <div className={cn("shrink-0 space-y-3 border-b border-border", bodyPaddingClassName)}>
            <div className={cn("flex items-center justify-between gap-2", profile === "compact" && "text-sm")}>
              <div>
                <p className="text-base font-semibold" data-testid="add-items-selection-heading">
                  {selectedSourceLabel ? (
                    <span className="inline-flex items-center gap-2">
                      <span>{`From ${selectedSourceLabel}`}</span>
                      {selectedSourceOrigin ? (
                        <span aria-hidden="true" data-testid="add-items-selection-icon">
                          <FileOriginIcon origin={selectedSourceOrigin} className={selectionHeadingIconClassName} />
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    "Select items"
                  )}
                </p>
                <p className="text-xs text-muted-foreground" data-testid="add-items-selection-count">
                  {activeSelectionCount} selected
                </p>
              </div>
              {showCompactHeaderConfirm ? (
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleConfirm}
                  disabled={isConfirming || autoConfirming || activeSelectionCount === 0}
                  data-testid="add-items-confirm"
                  className="shrink-0"
                >
                  {confirmLabel}
                </Button>
              ) : null}
            </div>

            {!isArchiveSource ? (
              <Input
                placeholder="Filter files…"
                value={browser.isQueryBacked ? (browser.query ?? "") : filterText}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (browser.isQueryBacked) {
                    browser.setQuery?.(nextValue);
                    return;
                  }
                  setFilterText(nextValue);
                }}
                data-testid="add-items-filter"
              />
            ) : null}
          </div>

          <AppSheetBody className={bodyPaddingClassName} data-testid="add-items-scroll">
            <div
              className={sourceContentClassName}
              data-testid={
                source.type === "ultimate"
                  ? "c64u-file-picker"
                  : source.type === "local"
                    ? "local-file-picker"
                    : source.type === "commoserve"
                      ? "commoserve-picker"
                      : "source-file-picker"
              }
            >
              {isArchiveSource && archiveConfig ? (
                <ArchiveSelectionView
                  config={archiveConfig}
                  selection={archiveSelection}
                  onToggleSelect={(result) => {
                    setArchiveSelection((prev) => {
                      const next = new Map(prev);
                      const key = archiveResultKey(result);
                      if (next.has(key)) {
                        next.delete(key);
                      } else {
                        next.set(key, result);
                      }
                      return next;
                    });
                  }}
                  onSelectAll={(results) => {
                    setArchiveSelection((prev) => {
                      const next = new Map(prev);
                      for (const result of results) {
                        next.set(archiveResultKey(result), result);
                      }
                      return next;
                    });
                  }}
                  onClearSelection={() => setArchiveSelection(new Map())}
                />
              ) : (
                <ItemSelectionView
                  path={browser.path}
                  rootPath={source.rootPath}
                  entries={visibleEntries}
                  isLoading={browser.isLoading}
                  showLoadingIndicator={browser.showLoadingIndicator}
                  selection={selection}
                  onToggleSelect={toggleSelection}
                  onOpen={browser.navigateTo}
                  onNavigateUp={browser.navigateUp}
                  onNavigateRoot={browser.navigateRoot}
                  onRefresh={browser.refresh}
                  showFolderSelect={allowFolderSelection}
                  emptyLabel="No matching items in this folder."
                />
              )}
              {!isArchiveSource && browser.hasMore ? (
                <div className="pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => browser.loadMore?.()}
                    disabled={browser.isLoading}
                    data-testid="add-items-load-more"
                  >
                    Load more
                  </Button>
                </div>
              ) : null}
            </div>
          </AppSheetBody>

          <AppSheetFooter
            className={cn("shrink-0 gap-2 border-t border-border", footerPaddingClassName, footerLayoutClassName)}
          >
            {showProgressFooter && progress && progress.status !== "idle" && (
              <div className="text-xs text-muted-foreground" data-testid="add-items-progress">
                <span>
                  {progress.message || "Scanning…"} {progress.count} items, {formatElapsed(progress.elapsedMs)}
                </span>
                {progress.total ? <span> / {progress.total}</span> : null}
              </div>
            )}
            {showArchiveLegalNotice ? (
              <p className="text-xs leading-snug text-muted-foreground" data-testid="archive-legal-notice">
                {LEGAL_NOTICE}
              </p>
            ) : null}
            <div className={cn("flex gap-2", footerActionsClassName)}>
              <Button
                variant="outline"
                size={profile === "compact" ? "sm" : "default"}
                onClick={() => {
                  if (progress?.status === "scanning" && onCancelScan) {
                    onCancelScan();
                    return;
                  }
                  onOpenChange(false);
                }}
              >
                {progress?.status === "scanning" && onCancelScan ? "Cancel scan" : "Cancel"}
              </Button>
              {source && (profile !== "compact" || showArchiveLegalNotice) && (
                <Button
                  variant="default"
                  size="default"
                  onClick={handleConfirm}
                  disabled={isConfirming || autoConfirming || activeSelectionCount === 0}
                  data-testid="add-items-confirm"
                >
                  {confirmLabel}
                </Button>
              )}
            </div>
          </AppSheetFooter>
        </div>
      </AppSheetContent>
    </AppSheet>
  );
};
