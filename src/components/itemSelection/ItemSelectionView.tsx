import { ArrowUp, FolderOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { ScopedEntry } from '@/lib/scopedBrowser/types';

export type ScopedBrowserViewProps = {
  path: string;
  rootPath: string;
  entries: ScopedEntry[];
  isLoading: boolean;
  selection: Map<string, ScopedEntry>;
  onToggleSelect: (entry: ScopedEntry) => void;
  onOpen: (path: string) => void;
  onNavigateUp: () => void;
  onRefresh: () => void;
  showFolderSelect: boolean;
  emptyLabel: string;
};

export const ScopedBrowserView = ({
  path,
  rootPath,
  entries,
  isLoading,
  selection,
  onToggleSelect,
  onOpen,
  onNavigateUp,
  onRefresh,
  showFolderSelect,
  emptyLabel,
}: ScopedBrowserViewProps) => {
  const atRoot = path === rootPath || path === rootPath.replace(/\/$/, '');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Path: {path}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onNavigateUp}
            disabled={atRoot || isLoading}
          >
            <ArrowUp className="h-4 w-4 mr-1" />
            Up
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            {isLoading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {entries.length === 0 && (
          <p className="text-xs text-muted-foreground">{emptyLabel}</p>
        )}
        {entries.map((entry) => {
          const isSelected = selection.has(entry.path);
          const canSelect = entry.type === 'file' || showFolderSelect;
          return (
            <div key={entry.path} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => canSelect && onToggleSelect(entry)}
                  disabled={!canSelect}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium break-words whitespace-normal">{entry.name}</p>
                  <p className="text-xs text-muted-foreground break-words whitespace-normal">{entry.path}</p>
                </div>
              </div>
              {entry.type === 'dir' && (
                <Button variant="outline" size="sm" onClick={() => onOpen(entry.path)}>
                  <FolderOpen className="h-4 w-4 mr-1" />
                  Open
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};