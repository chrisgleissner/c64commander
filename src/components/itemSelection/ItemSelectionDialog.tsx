import { useEffect, useMemo, useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import type { SourceEntry, SelectedItem, SourceLocation } from '@/lib/sourceNavigation/types';
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
  onConfirm: (source: SourceLocation, selections: SelectedItem[]) => Promise<void>;
  filterEntry?: (entry: SourceEntry) => boolean;
  allowFolderSelection?: boolean;
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
}: ItemSelectionDialogProps) => {
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Map<string, SourceEntry>>(new Map());
  const [filterText, setFilterText] = useState('');
  const [pendingLocalSource, setPendingLocalSource] = useState(false);
  const [pendingLocalSourceCount, setPendingLocalSourceCount] = useState(0);

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
    if (browser.error) {
      toast({
        title: 'Browse failed',
        description: browser.error,
        variant: 'destructive',
      });
    }
  }, [browser.error]);

  useEffect(() => {
    if (!open) return;
    setSelectedSourceId(null);
    setSelection(new Map());
    setFilterText('');
    setPendingLocalSource(false);
    setPendingLocalSourceCount(0);
  }, [open]);

  useEffect(() => {
    if (!open || !pendingLocalSource || selectedSourceId) return;
    if (localSourceCount <= pendingLocalSourceCount) return;
    const newestLocal = localSources[0];
    if (!newestLocal) return;
    setSelectedSourceId(newestLocal.id);
    setPendingLocalSource(false);
  }, [localSourceCount, localSources, open, pendingLocalSource, pendingLocalSourceCount, selectedSourceId]);

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
    if (!selection.size) {
      toast({ title: 'Select items', description: 'Choose at least one item to add.', variant: 'destructive' });
      return;
    }
    const selections: SelectedItem[] = Array.from(selection.values()).map((entry) => ({
      type: entry.type,
      name: entry.name,
      path: entry.path,
    }));
    await onConfirm(source, selections);
    onOpenChange(false);
  };

  const handleAddLocalSource = async () => {
    setPendingLocalSource(true);
    setPendingLocalSourceCount(localSourceCount);
    const nextId = await onAddLocalSource();
    if (nextId) {
      setSelectedSourceId(nextId);
      setPendingLocalSource(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-[calc(100%-2rem)] max-h-[85vh] p-0 overflow-hidden shadow-2xl">
        <div className="flex h-full max-h-[85vh] flex-col">
          <DialogHeader className="border-b border-border px-6 pb-3 pt-6">
            <DialogTitle className="text-xl">{title}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {!source && (
              <div className="space-y-5">
                <p className="text-lg font-semibold text-foreground">Choose source</p>
                {sourceGroups.map((group) => (
                  <div key={group.label} className="space-y-3">
                    <p className="text-base font-semibold text-foreground">{group.label}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {group.sources.map((item) => (
                        <Button
                          key={item.id}
                          variant="outline"
                          onClick={() => {
                            setPendingLocalSource(false);
                            setSelectedSourceId(item.id);
                          }}
                          disabled={!item.isAvailable}
                          className="justify-start"
                        >
                          {item.name}
                        </Button>
                      ))}
                      {group.label === 'This device' && (
                        <Button variant="secondary" onClick={() => void handleAddLocalSource()} className="justify-start">
                          <FolderPlus className="h-4 w-4 mr-1" />
                          Add folder
                        </Button>
                      )}
                    </div>
                    {group.label === 'This device' && pendingLocalSource && (
                      <p className="text-xs text-muted-foreground">
                        Waiting for the system folder picker. Use the device back action to cancel if needed.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {source && (
              <div className="space-y-3">
                <div>
                  <p className="text-base font-semibold">Select items</p>
                  <p className="text-xs text-muted-foreground">{selection.size} selected</p>
                </div>

                <Input
                  placeholder="Filter items…"
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                />

                <ItemSelectionView
                  path={browser.path}
                  rootPath={source.rootPath}
                  entries={visibleEntries}
                  isLoading={browser.isLoading}
                  selection={selection}
                  onToggleSelect={toggleSelection}
                  onOpen={browser.navigateTo}
                  onNavigateUp={browser.navigateUp}
                  onRefresh={browser.refresh}
                  showFolderSelect={allowFolderSelection}
                  emptyLabel="No matching items in this folder."
                />
              </div>
            )}
          </div>

          <DialogFooter className="flex items-center justify-between border-t border-border px-6 py-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="default" onClick={handleConfirm} disabled={!source}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};