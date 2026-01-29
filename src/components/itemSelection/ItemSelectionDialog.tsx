import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { reportUserError } from '@/lib/uiErrors';
import type { SourceEntry, SelectedItem, SourceLocation } from '@/lib/sourceNavigation/types';
import type { AddItemsProgressState } from './AddItemsProgressOverlay';
import { useSourceNavigator } from '@/lib/sourceNavigation/useSourceNavigator';
import { ItemSelectionView } from './ItemSelectionView';

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
}: ItemSelectionDialogProps) => {
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Map<string, SourceEntry>>(new Map());
  const [filterText, setFilterText] = useState('');
  const [pendingLocalSource, setPendingLocalSource] = useState(false);
  const [pendingLocalSourceCount, setPendingLocalSourceCount] = useState(0);
  const [pendingLocalSourceId, setPendingLocalSourceId] = useState<string | null>(null);
  const [autoConfirming, setAutoConfirming] = useState(false);

  const localSources = useMemo(
    () => sourceGroups.flatMap((group) => group.sources).filter((item) => item.type === 'local'),
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

  const browser = useSourceNavigator(source);

  useEffect(() => {
    if (!browser.error || !open) return;
    reportUserError({
      operation: 'BROWSE',
      title: 'Browse failed',
      description: browser.error,
      context: { sourceId: selectedSourceId },
    });
  }, [browser.error, open, reportUserError, selectedSourceId]);

  useEffect(() => {
    if (!open) return;
    setSelectedSourceId(null);
    setSelection(new Map());
    setFilterText('');
    setPendingLocalSource(false);
    setPendingLocalSourceCount(0);
    setPendingLocalSourceId(null);
  }, [open]);

  const confirmLocalSource = useCallback(async (target: SourceLocation) => {
    if (autoConfirming || isConfirming) return;
    setAutoConfirming(true);
    const selections: SelectedItem[] = [
      {
        type: 'dir',
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
        operation: 'ITEM_SELECTION',
        title: 'Add items failed',
        description: (error as Error).message,
        error,
      });
    }
    setAutoConfirming(false);
  }, [autoConfirmCloseBefore, autoConfirming, isConfirming, onAutoConfirmStart, onConfirm, onOpenChange, reportUserError]);

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
    if (autoConfirmLocalSource) {
      void confirmLocalSource(targetSource);
    }
  }, [autoConfirmLocalSource, confirmLocalSource, localSourceCount, localSources, open, pendingLocalSource, pendingLocalSourceCount, pendingLocalSourceId, selectedSourceId]);

  const visibleEntries = useMemo(() => {
    const filesFiltered = filterEntry
      ? browser.entries.filter((entry) => entry.type === 'dir' || filterEntry(entry))
      : browser.entries;
    if (!filterText) return filesFiltered;
    const lower = filterText.toLowerCase();
    return filesFiltered.filter((entry) => entry.name.toLowerCase().includes(lower) || entry.path.toLowerCase().includes(lower));
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
        operation: 'ITEM_SELECTION',
        title: 'Select items',
        description: 'Choose at least one item to add.',
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
        operation: 'ITEM_SELECTION',
        title: 'Add items failed',
        description: (error as Error).message,
        error,
      });
    }
  };

  const formatElapsed = (ms: number) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
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
        operation: 'LOCAL_FOLDER_PICK',
        title: 'Unable to add folder',
        description: (error as Error).message,
        error,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showClose={false} className="max-w-3xl w-[calc(100%-2rem)] h-[min(80vh,calc(100dvh-6rem))] max-h-[calc(100dvh-6rem)] p-0 overflow-hidden shadow-2xl sm:rounded-2xl">
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="border-b border-border px-6 pb-3 pt-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle className="text-xl">{title}</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Select items from the chosen source to add.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Close">
                  <X className="h-4 w-4" />
                </Button>
              </DialogClose>
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4" data-testid="add-items-scroll">
            {!source && (
              <div className="space-y-5">
                <p className="text-lg font-semibold text-foreground">Choose source</p>
                {sourceGroups.map((group) => (
                  <div key={group.label} className="space-y-3">
                    <p className="text-base font-semibold text-foreground">{group.label}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {group.label === 'C64 Ultimate' ? (
                        <Button
                          variant="outline"
                          onClick={() => {
                            const target = group.sources[0];
                            if (!target) return;
                            setPendingLocalSource(false);
                            setSelectedSourceId(target.id);
                          }}
                          disabled={!group.sources[0]?.isAvailable}
                          className="justify-start min-w-0"
                        >
                          <FolderPlus className="h-4 w-4 mr-1" />
                          <span className="truncate">Add file / folder</span>
                        </Button>
                      ) : null}
                      {group.label === 'This device' ? (
                        <Button
                          variant="outline"
                          onClick={() => void handleAddLocalSource()}
                          className="justify-start min-w-0"
                          disabled={pendingLocalSource}
                          aria-busy={pendingLocalSource}
                          aria-label="Add file / folder from device"
                        >
                          <FolderPlus className="h-4 w-4 mr-1" />
                          <span className="truncate">Add file / folder</span>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {source && (
              <div className="space-y-3">
                <div>
                  <p className="text-base font-semibold">Select items</p>
                  <p className="text-xs text-muted-foreground" data-testid="add-items-selection-count">
                    {selection.size} selected
                  </p>
                </div>

                <Input
                  placeholder="Filter files…"
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                  data-testid="add-items-filter"
                />

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
            )}
          </div>

          <DialogFooter className="flex flex-col gap-2 border-t border-border px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between">
            {showProgressFooter && progress && progress.status !== 'idle' && (
              <div className="text-xs text-muted-foreground" data-testid="add-items-progress">
                <span>
                  {progress.message || 'Scanning…'} {progress.count} items, {formatElapsed(progress.elapsedMs)}
                </span>
                {progress.total ? <span> / {progress.total}</span> : null}
              </div>
            )}
            <div className="flex gap-2 sm:ml-auto">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              {source && (
                <Button
                  variant="default"
                  onClick={handleConfirm}
                  disabled={isConfirming || autoConfirming || selection.size === 0}
                  data-testid="add-items-confirm"
                >
                  {confirmLabel}
                </Button>
              )}
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};
