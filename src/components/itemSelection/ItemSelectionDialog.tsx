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
  AppSurfaceClose,
} from "@/components/ui/app-surface";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { Input } from "@/components/ui/input";
import { FileOriginIcon } from "@/components/FileOriginIcon";
import { cn } from "@/lib/utils";
import { reportUserError } from "@/lib/uiErrors";
import type { SourceEntry, SelectedItem, SourceLocation } from "@/lib/sourceNavigation/types";
import { SOURCE_EXPLANATIONS, SOURCE_LABELS } from "@/lib/sourceNavigation/sourceTerms";
import type { AddItemsProgressState } from "./AddItemsProgressOverlay";
import { useSourceNavigator } from "@/lib/sourceNavigation/useSourceNavigator";
import { ItemSelectionView } from "./ItemSelectionView";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";

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
  sourceGroups: SourceGroup[];
  onAddLocalSource: () => Promise<string | null>;
  onConfirm: (source: SourceLocation, selections: SelectedItem[]) => Promise<boolean>;
  filterEntry?: (entry: SourceEntry) => boolean;
  allowFolderSelection?: boolean;
  isConfirming?: boolean;
  autoConfirmLocalSource?: boolean;
  progress?: AddItemsProgressState;
  showProgressFooter?: boolean;
  autoConfirmCloseBefore?: boolean;
  onAutoConfirmStart?: (source: SourceLocation) => void;
  onCancelScan?: () => void;
};

export const ItemSelectionDialog = ({
  open,
  onOpenChange,
  title,
  confirmLabel,
  sourceGroups,
  onAddLocalSource,
  onConfirm,
  filterEntry,
  allowFolderSelection = true,
  isConfirming = false,
  autoConfirmLocalSource = false,
  progress,
  showProgressFooter = true,
  autoConfirmCloseBefore = false,
  onAutoConfirmStart,
  onCancelScan,
}: ItemSelectionDialogProps) => {
  const { profile } = useDisplayProfile();
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Map<string, SourceEntry>>(new Map());
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

  const browser = useSourceNavigator(source);

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
    setSelectedSourceId(null);
    setSelection(new Map());
    setFilterText("");
    setPendingLocalSource(false);
    setPendingLocalSourceCount(0);
    setPendingLocalSourceId(null);
    setAutoConfirming(false);
  }, [open]);

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
    if (!filterText) return filesFiltered;
    const lower = filterText.toLowerCase();
    return filesFiltered.filter(
      (entry) => entry.name.toLowerCase().includes(lower) || entry.path.toLowerCase().includes(lower),
    );
  }, [browser.entries, filterEntry, filterText]);

  const toggleSelection = (entry: SourceEntry) => {
    setSelection((prev) => {
      const next = new Map(prev);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.set(entry.path, entry);
      }
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!source) return;
    if (isConfirming || autoConfirming) return;
    if (!selection.size) {
      reportUserError({
        operation: "ITEM_SELECTION",
        title: "Select items",
        description: "Choose at least one item to add.",
      });
      return;
    }
    const selections: SelectedItem[] = Array.from(selection.values()).map((entry) => ({
      type: entry.type,
      name: entry.name,
      path: entry.path,
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

  const interstitialGridClassName = profile === "compact" ? "grid-cols-1" : "grid-cols-2";
  const footerLayoutClassName = profile === "compact" ? "flex-col" : "flex-row items-center justify-between";
  const footerActionsClassName = profile === "compact" ? "flex-row flex-wrap" : "flex-row ml-auto";
  const footerPaddingClassName =
    profile === "compact"
      ? "px-3 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))]"
      : "px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]";
  const headerPaddingClassName = profile === "compact" ? "px-3 pb-1 pt-2.5" : "px-6 pb-3 pt-6";
  const bodyPaddingClassName = profile === "compact" ? "px-3 py-1.5" : "px-6 py-4";
  const sourceContentClassName = profile === "compact" ? "space-y-2" : "space-y-3";

  if (!source) {
    return (
      <AppDialog open={open} onOpenChange={onOpenChange}>
        <AppDialogContent showClose={false} onOpenAutoFocus={(e) => e.preventDefault()} className="max-w-md">
          <AppDialogHeader className={cn(headerPaddingClassName, "pr-12")}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <AppDialogTitle className="text-xl">{title}</AppDialogTitle>
                <AppDialogDescription
                  className={cn("text-sm text-muted-foreground", profile === "compact" && "hidden")}
                >
                  Select items from the chosen source to add.
                </AppDialogDescription>
              </div>
              <AppSurfaceClose asChild>
                <ModalCloseButton className="static h-8 w-8 shrink-0" aria-label="Close" />
              </AppSurfaceClose>
            </div>
          </AppDialogHeader>
          <AppDialogBody className={bodyPaddingClassName}>
            <div className="space-y-5">
              <p className="text-lg font-semibold text-foreground">Choose source</p>
              <div className={cn("grid gap-2", interstitialGridClassName)} data-testid="import-selection-interstitial">
                <Button
                  variant="outline"
                  className="justify-start min-w-0"
                  onClick={() => void handleAddLocalSource()}
                  disabled={pendingLocalSource}
                  aria-busy={pendingLocalSource}
                  id="import-option-local"
                  data-testid="import-option-local"
                  aria-label="Add file / folder from Local"
                >
                  <span className="inline-flex items-center justify-start min-w-0" aria-hidden="true">
                    <FileOriginIcon origin="local" className="h-4 w-4 mr-1" />
                    <span className="flex flex-col items-start truncate">
                      <span className="truncate font-medium">{SOURCE_LABELS.local}</span>
                      <span className="text-[11px] text-muted-foreground">{SOURCE_EXPLANATIONS.local}</span>
                    </span>
                  </span>
                </Button>
                <Button
                  variant="outline"
                  className="justify-start min-w-0"
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
                  <span className="inline-flex items-center justify-start min-w-0" aria-hidden="true">
                    <FileOriginIcon origin="ultimate" className="h-4 w-4 mr-1" />
                    <span className="flex flex-col items-start truncate">
                      <span className="truncate font-medium">{SOURCE_LABELS.c64u}</span>
                      <span className="text-[11px] text-muted-foreground">{SOURCE_EXPLANATIONS.c64u}</span>
                    </span>
                  </span>
                </Button>
                {hvscSource ? (
                  <Button
                    variant="outline"
                    className="justify-start min-w-0"
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
                    <span className="inline-flex items-center justify-start min-w-0" aria-hidden="true">
                      <FileOriginIcon origin="hvsc" className="h-4 w-4 mr-1" />
                      <span className="flex flex-col items-start truncate">
                        <span className="truncate font-medium">{SOURCE_LABELS.hvsc}</span>
                        <span className="text-[11px] text-muted-foreground">{SOURCE_EXPLANATIONS.hvsc}</span>
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
      <AppSheetContent
        showClose={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="p-0 overflow-hidden shadow-2xl"
      >
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <AppSheetHeader className={cn(headerPaddingClassName, "pr-12")}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <AppSheetTitle className="text-xl">{title}</AppSheetTitle>
                <AppSheetDescription className={cn("text-sm text-muted-foreground", profile === "compact" && "hidden")}>
                  Select items from the chosen source to add.
                </AppSheetDescription>
              </div>
              <AppSurfaceClose asChild>
                <ModalCloseButton className="static h-8 w-8 shrink-0" aria-label="Close" />
              </AppSurfaceClose>
            </div>
          </AppSheetHeader>

          <div className={cn("shrink-0 space-y-3 border-b border-border", bodyPaddingClassName)}>
            <div className={cn("flex items-center justify-between gap-2", profile === "compact" && "text-sm")}>
              <div>
                <p className="text-base font-semibold">Select items</p>
                <p className="text-xs text-muted-foreground" data-testid="add-items-selection-count">
                  {selection.size} selected
                </p>
              </div>
              {profile === "compact" ? (
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleConfirm}
                  disabled={isConfirming || autoConfirming || selection.size === 0}
                  data-testid="add-items-confirm"
                  className="shrink-0"
                >
                  {confirmLabel}
                </Button>
              ) : null}
            </div>

            <Input
              placeholder="Filter files…"
              value={filterText}
              onChange={(event) => setFilterText(event.target.value)}
              data-testid="add-items-filter"
            />
          </div>

          <AppSheetBody className={bodyPaddingClassName} data-testid="add-items-scroll">
            <div
              className={sourceContentClassName}
              data-testid={
                source.type === "ultimate"
                  ? "c64u-file-picker"
                  : source.type === "local"
                    ? "local-file-picker"
                    : "source-file-picker"
              }
            >
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
              {source && profile !== "compact" && (
                <Button
                  variant="default"
                  size={profile === "compact" ? "sm" : "default"}
                  onClick={handleConfirm}
                  disabled={isConfirming || autoConfirming || selection.size === 0}
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
