import { useEffect, useMemo, useState } from 'react';
import { FolderPlus, X } from 'lucide-react';
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
  onAddLocalSource: () => void;
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
  }, [open]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>{title}</DialogTitle>
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {!source && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Choose source</p>
            {sourceGroups.map((group) => (
              <div key={group.label} className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.sources.map((item) => (
                    <Button
                      key={item.id}
                      variant="outline"
                      onClick={() => setSelectedSourceId(item.id)}
                      disabled={!item.isAvailable}
                      className="justify-start"
                    >
                      {item.name}
                    </Button>
                  ))}
                  {group.label === 'This device' && (
                    <Button variant="secondary" onClick={onAddLocalSource} className="justify-start">
                      <FolderPlus className="h-4 w-4 mr-1" />
                      Add folder
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {source && (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Select items</p>
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

        <DialogFooter className="flex items-center justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="default" onClick={handleConfirm} disabled={!source}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};