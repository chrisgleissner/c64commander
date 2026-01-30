import { useCallback, useMemo, useState, useRef } from 'react';
import { MoreVertical, Play, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { PathWrap } from '@/components/PathWrap';
import { AlphabetScrollbar } from './AlphabetScrollbar';
import { cn } from '@/lib/utils';

export type ActionListMenuItem =
  | { type: 'label'; label: string }
  | { type: 'info'; label: string; value: string }
  | { type: 'separator' }
  | { type: 'action'; label: string; onSelect: () => void; disabled?: boolean; destructive?: boolean };

export type ActionListItem = {
  id: string;
  title: string;
  titleSuffix?: string | null;
  titleClassName?: string | null;
  subtitle?: string | null;
  filterText?: string | null;
  meta?: React.ReactNode;
  icon?: React.ReactNode;
  variant?: 'item' | 'header';
  selected: boolean;
  onSelectToggle?: (selected: boolean) => void;
  menuItems?: ActionListMenuItem[];
  isDimmed?: boolean;
  disableActions?: boolean;
  actionLabel: string;
  onAction?: () => void;
  onTitleClick?: () => void;
  onRowClick?: () => void;
  actionAriaLabel?: string;
  actionIcon?: React.ReactNode;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  secondaryActionAriaLabel?: string;
  subtitleTestId?: string;
  showMenu?: boolean;
  showSelection?: boolean;
};

export type SelectableActionListProps = {
  title: string;
  items: ActionListItem[];
  emptyLabel: string;
  selectAllLabel?: string;
  deselectAllLabel?: string;
  removeSelectedLabel?: string;
  selectedCount: number;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  onRemoveSelected?: () => void;
  maxVisible: number;
  viewAllTitle?: string;
  viewAllLabel?: string;
  listTestId?: string;
  rowTestId?: string;
  headerActions?: React.ReactNode;
  filterHeader?: React.ReactNode;
  filterPlaceholder?: string;
  showSelectionControls?: boolean;
  selectionLabel?: string;
};

const sanitizeForTestId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');

const ActionListRow = ({ item, rowTestId }: { item: ActionListItem; rowTestId?: string }) => {
  if (item.variant === 'header') {
    const headerTestId = rowTestId ? `${rowTestId}-header` : undefined;
    return (
      <div
        className="flex items-start gap-2 px-2 py-1 rounded-md bg-muted/30 min-w-0 max-w-full"
        data-testid={headerTestId}
        data-row-id={item.id}
      >
        {item.icon ? <div className="pt-0.5 text-muted-foreground">{item.icon}</div> : null}
        <div className="min-w-0 text-xs font-semibold text-foreground">
          <PathWrap path={item.title} />
        </div>
      </div>
    );
  }

  const selectionTestId = rowTestId ? `${rowTestId}-select-${sanitizeForTestId(item.title)}` : undefined;
  const actionMenuTestId = rowTestId ? `${rowTestId}-actions-${sanitizeForTestId(item.title)}` : undefined;

  return (
    <div
      className={cn(
        'flex items-center gap-2 py-2 px-1 rounded-md min-w-0 max-w-full',
        item.isDimmed ? 'opacity-40' : 'hover:bg-muted/40',
      )}
      onClick={(event) => {
        if (!item.onRowClick) return;
        if (item.isDimmed || item.disableActions) return;
        if (event.defaultPrevented) return;
        item.onRowClick();
      }}
      data-testid={rowTestId}
      data-row-id={item.id}
    >
      <div className="flex items-center gap-1 shrink-0">
        {item.showSelection !== false ? (
          <Checkbox
            checked={item.selected}
            onCheckedChange={(value) => item.onSelectToggle?.(Boolean(value))}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Select ${item.title}`}
            id={selectionTestId}
            data-testid={selectionTestId}
          />
        ) : null}
        {item.showMenu === false ? null : (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 min-h-[44px] min-w-[44px]"
                aria-label="Item actions"
                disabled={item.disableActions}
                onClick={(event) => event.stopPropagation()}
                id={actionMenuTestId}
                data-testid={actionMenuTestId}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {item.menuItems?.length
                ? item.menuItems.map((entry, index) => {
                    if (entry.type === 'separator') return <DropdownMenuSeparator key={`sep-${index}`} />;
                    if (entry.type === 'label') {
                      return <DropdownMenuLabel key={`label-${index}`}>{entry.label}</DropdownMenuLabel>;
                    }
                    if (entry.type === 'info') {
                      return (
                        <DropdownMenuItem key={`info-${index}`} disabled>
                          {entry.label}: {entry.value}
                        </DropdownMenuItem>
                      );
                    }
                    return (
                      <DropdownMenuItem
                        key={`action-${index}`}
                        onSelect={entry.onSelect}
                        disabled={entry.disabled}
                        className={entry.destructive ? 'text-destructive focus:text-destructive' : undefined}
                      >
                        {entry.label}
                      </DropdownMenuItem>
                    );
                  })
                : null}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex flex-1 items-center gap-2 min-w-0 max-w-full">
        {item.icon ? <div className="shrink-0">{item.icon}</div> : null}
        <div className="min-w-0 w-full">
          <button
            type="button"
            className={cn(
              'text-sm font-medium text-left hover:underline max-w-full min-w-0 flex items-center gap-1',
              item.titleClassName ?? 'truncate',
            )}
            onClick={(event) => {
              event.stopPropagation();
              item.onTitleClick?.();
            }}
            disabled={item.isDimmed || item.disableActions}
          >
            <span className={item.titleClassName ?? 'truncate'}>{item.title}</span>
            {item.titleSuffix ? (
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">{item.titleSuffix}</span>
            ) : null}
          </button>
          {item.subtitle ? (
            <div
              className="text-[11px] text-muted-foreground break-words whitespace-normal max-w-full"
              data-testid={item.subtitleTestId}
            >
              {item.subtitle}
            </div>
          ) : null}
          {item.meta ? (
            <div className="text-[11px] text-muted-foreground break-words whitespace-normal max-w-full">
              {item.meta}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 min-h-[44px] min-w-[44px]"
          onClick={(event) => {
            event.stopPropagation();
            item.onAction?.();
          }}
          disabled={item.isDimmed || item.disableActions}
          aria-label={item.actionAriaLabel || `${item.actionLabel} ${item.title}`}
        >
          {item.actionIcon ?? <Play className="h-4 w-4" />}
        </Button>
        {item.secondaryActionLabel && item.onSecondaryAction ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            onClick={(event) => {
              event.stopPropagation();
              item.onSecondaryAction?.();
            }}
            disabled={item.isDimmed || item.disableActions}
            aria-label={item.secondaryActionAriaLabel || `${item.secondaryActionLabel} ${item.title}`}
          >
            {item.secondaryActionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
};

export const SelectableActionList = ({
  title,
  items,
  emptyLabel,
  selectAllLabel = 'Select all',
  deselectAllLabel = 'Deselect all',
  removeSelectedLabel,
  selectedCount,
  allSelected,
  onToggleSelectAll,
  onRemoveSelected,
  maxVisible,
  viewAllTitle,
  viewAllLabel = 'View all',
  listTestId,
  rowTestId,
  headerActions,
  filterHeader,
  filterPlaceholder = 'Filter files...',
  showSelectionControls = true,
  selectionLabel,
}: SelectableActionListProps) => {
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [viewAllFilterText, setViewAllFilterText] = useState('');
  const viewAllScrollRef = useRef<HTMLDivElement>(null);
  
  const filterWithHeaders = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return items;
    const lower = trimmed.toLowerCase();
    const list: ActionListItem[] = [];
    let pendingHeader: ActionListItem | null = null;
    let hasMatchInSection = false;

    const matchesItem = (item: ActionListItem) => {
      const extra = item.filterText?.toLowerCase() ?? '';
      const subtitle = item.subtitle?.toLowerCase() ?? '';
      return item.title.toLowerCase().includes(lower) || subtitle.includes(lower) || extra.includes(lower);
    };

    items.forEach((item) => {
      if (item.variant === 'header') {
        if (pendingHeader && hasMatchInSection) {
          list.push(pendingHeader);
        }
        pendingHeader = item;
        hasMatchInSection = false;
        return;
      }
      if (!matchesItem(item)) return;
      if (pendingHeader && !hasMatchInSection) {
        list.push(pendingHeader);
        hasMatchInSection = true;
      }
      list.push(item);
    });

    return list;
  }, [items]);

  const filteredItems = useMemo(() => filterWithHeaders(filterText), [items, filterText]);

  const viewAllFilteredItems = useMemo(() => filterWithHeaders(viewAllFilterText), [items, viewAllFilterText]);

  const selectionToggleId = listTestId ? `${listTestId}-toggle-select-all` : undefined;
  const removeSelectedId = listTestId ? `${listTestId}-remove-selected` : undefined;
  
  const { visibleItems, hasMore } = useMemo(() => {
    const totalItems = filteredItems.reduce((count, item) => (item.variant === 'header' ? count : count + 1), 0);
    const list: ActionListItem[] = [];
    let pendingHeader: ActionListItem | null = null;
    let remaining = maxVisible;
    for (const item of filteredItems) {
      if (item.variant === 'header') {
        pendingHeader = item;
        continue;
      }
      if (remaining <= 0) break;
      if (pendingHeader) {
        list.push(pendingHeader);
        pendingHeader = null;
      }
      list.push(item);
      remaining -= 1;
    }
    return { visibleItems: list, hasMore: totalItems > maxVisible };
  }, [filteredItems, maxVisible]);

  const renderList = (list: ActionListItem[]) => (
    <div className="space-y-2" data-testid={listTestId}>
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        list.map((item) => <ActionListRow key={item.id} item={item} rowTestId={rowTestId} />)
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          {showSelectionControls ? (
            <p className="text-xs text-muted-foreground">
              {selectedCount
                ? `${selectedCount} selected`
                : `No ${(selectionLabel || title.toLowerCase())} selected`}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {headerActions}
          {hasMore && (
            <Button variant="outline" size="sm" onClick={() => setViewAllOpen(true)}>
              {viewAllLabel}
            </Button>
          )}
        </div>
      </div>

      {/* Text filter */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          type="text"
          placeholder={filterPlaceholder}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="pl-9 pr-9 h-9"
          data-testid="list-filter-input"
        />
        {filterText && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilterText('')}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
            aria-label="Clear filter"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {filterHeader ? (
        <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
          {filterHeader}
        </div>
      ) : null}

      {showSelectionControls ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs min-w-0">
          <span className="text-muted-foreground min-w-0 break-words">
            {filteredItems.length ? `${filteredItems.length} items` : emptyLabel}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleSelectAll}
              disabled={!items.length}
              className="max-w-full truncate"
              id={selectionToggleId}
              data-testid={selectionToggleId}
            >
              {allSelected ? deselectAllLabel : selectAllLabel}
            </Button>
            {removeSelectedLabel && selectedCount > 0 && onRemoveSelected ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onRemoveSelected}
                className="text-destructive hover:text-destructive max-w-full truncate"
                id={removeSelectedId}
                data-testid={removeSelectedId}
              >
                {removeSelectedLabel}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="bg-card border border-border rounded-xl p-4 overflow-hidden">
        {renderList(visibleItems)}
      </div>

      {viewAllTitle && (
        <Dialog open={viewAllOpen} onOpenChange={setViewAllOpen}>
          <DialogContent className="mx-auto w-[min(92vw,32rem)] max-w-[min(92vw,32rem)] sm:w-full sm:max-w-[36rem] h-[min(70vh,calc(100dvh-10rem))] max-h-[calc(100dvh-10rem)] p-0 overflow-hidden">
            <div className="flex h-full min-h-0 flex-col min-w-0 relative" data-testid="action-list-view-all">
              <DialogHeader className="border-b border-border px-6 pb-3 pt-6 space-y-3">
                <div>
                  <DialogTitle>{viewAllTitle || title}</DialogTitle>
                  <DialogDescription>Review all items in this list.</DialogDescription>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    type="text"
                    placeholder={filterPlaceholder}
                    value={viewAllFilterText}
                    onChange={(e) => setViewAllFilterText(e.target.value)}
                    className="pl-9 pr-9 h-9"
                    data-testid="view-all-filter-input"
                  />
                  {viewAllFilterText && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewAllFilterText('')}
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                      aria-label="Clear filter"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {filterHeader ? (
                  <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                    {filterHeader}
                  </div>
                ) : null}
              </DialogHeader>
              <div 
                ref={viewAllScrollRef}
                className="flex-1 min-h-0 overflow-y-auto px-6 py-4" 
                data-testid="action-list-scroll"
              >
                <div className="bg-card border border-border rounded-xl p-4 overflow-hidden">
                  {renderList(viewAllFilteredItems)}
                </div>
              </div>
              <AlphabetScrollbar 
                items={viewAllFilteredItems.filter(item => item.variant !== 'header').map(item => ({ title: item.title, id: item.id }))}
                scrollContainerRef={viewAllScrollRef}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
