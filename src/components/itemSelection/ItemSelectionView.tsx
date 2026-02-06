import { ArrowUp, ChevronRight, Folder, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PathWrap } from '@/components/PathWrap';
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
      <div className="flex flex-wrap items-center gap-2">
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

      <div className="flex items-start gap-2 w-full min-w-0 font-semibold text-sm">
        <Folder className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <span className="mr-1">Path:</span>{' '}
          <PathWrap path={path} className="text-foreground" />
        </div>
      </div>

      <div className="space-y-2">
        {entries.length === 0 && (
          <p className="text-xs text-muted-foreground">{emptyLabel}</p>
        )}
        {entries.map((entry) => {
          const isSelected = selection.has(entry.path);
          const canSelect = entry.type === 'file' || showFolderSelect;
          const isFolder = entry.type === 'dir';
          return (
            <div
              key={entry.path}
              className="flex items-center gap-2 min-w-0 border-b border-border/50 py-2"
              data-testid="source-entry-row"
              data-entry-type={entry.type}
              onClick={() => {
                if (!isFolder || isLoading) return;
                onOpen(entry.path);
              }}
            >
              <div className="shrink-0">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => canSelect && onToggleSelect(entry)}
                  onClick={(event) => event.stopPropagation()}
                  disabled={!canSelect}
                  aria-label={`Select ${entry.name}`}
                />
              </div>
              <div
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                role={isFolder ? 'button' : undefined}
                aria-label={isFolder ? `Open ${entry.name}` : undefined}
              >
                {isFolder ? (
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <span className="h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <p className="text-sm font-medium break-words whitespace-normal">{entry.name}</p>
              </div>
              {isFolder ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden="true" /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
