import { ArrowUp, FolderOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { SourceEntry } from '@/lib/sourceNavigation/types';

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
  const atRoot = path === rootPath || path === rootPath.replace(/\/$/, '');

  return (
    <div className="space-y-3 relative">
      {showLoadingIndicator && (
        <div
          className="absolute right-3 top-2 z-10 rounded-full bg-muted/80 px-2 py-0.5 text-[11px] text-muted-foreground shadow-sm"
          data-testid="ftp-loading"
        >
          Loading…
        </div>
      )}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="text-xs text-muted-foreground break-all min-w-0">Path: {path}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onNavigateRoot}
            disabled={atRoot || isLoading}
            data-testid="navigate-root"
          >
            Root
          </Button>
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
            <div key={entry.path} className="flex items-center justify-between gap-2 min-w-0" data-testid="source-entry-row">
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