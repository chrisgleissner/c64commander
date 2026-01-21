import { useMemo, useState } from 'react';
import { MoreVertical } from 'lucide-react';
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
import { cn } from '@/lib/utils';

export type ActionListMenuItem =
  | { type: 'label'; label: string }
  | { type: 'info'; label: string; value: string }
  | { type: 'separator' }
  | { type: 'action'; label: string; onSelect: () => void; disabled?: boolean; destructive?: boolean };

export type ActionListItem = {
  id: string;
  title: string;
  subtitle?: string | null;
  icon?: React.ReactNode;
  selected: boolean;
  onSelectToggle?: (selected: boolean) => void;
  menuItems?: ActionListMenuItem[];
  isDimmed?: boolean;
  disableActions?: boolean;
  actionLabel: string;
  onAction?: () => void;
  onTitleClick?: () => void;
  actionAriaLabel?: string;
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
  showSelectionControls?: boolean;
  selectionLabel?: string;
};

const ActionListRow = ({ item, rowTestId }: { item: ActionListItem; rowTestId?: string }) => (
  <div
    className={cn(
      'flex items-start gap-2 py-2 px-1 rounded-md min-w-0',
      item.isDimmed ? 'opacity-40' : 'hover:bg-muted/40',
    )}
    data-testid={rowTestId}
  >
    <div className="flex items-center gap-2 pt-0.5">
      {item.showSelection !== false ? (
        <Checkbox
          checked={item.selected}
          onCheckedChange={(value) => item.onSelectToggle?.(Boolean(value))}
          aria-label={`Select ${item.title}`}
        />
      ) : null}
      {item.showMenu === false ? null : (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Item actions"
              disabled={item.disableActions}
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
    <div className="flex flex-1 items-start gap-2 min-w-0">
      {item.icon ? <div className="pt-0.5">{item.icon}</div> : null}
      <div className="min-w-0">
        <button
          type="button"
          className="text-sm font-medium break-words whitespace-normal text-left hover:underline"
          onClick={item.onTitleClick}
          disabled={item.isDimmed || item.disableActions}
        >
          {item.title}
        </button>
        {item.subtitle ? (
          <div
            className="text-[11px] text-muted-foreground break-words whitespace-normal"
            data-testid={item.subtitleTestId}
          >
            {item.subtitle}
          </div>
        ) : null}
      </div>
    </div>
    <Button
      variant="outline"
      size="sm"
      className="h-7 px-2 text-xs"
      onClick={item.onAction}
      disabled={item.isDimmed || item.disableActions}
      aria-label={item.actionAriaLabel || `${item.actionLabel} ${item.title}`}
    >
      {item.actionLabel}
    </Button>
  </div>
);

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
  showSelectionControls = true,
  selectionLabel,
}: SelectableActionListProps) => {
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const visibleItems = useMemo(() => items.slice(0, maxVisible), [items, maxVisible]);
  const hasMore = items.length > maxVisible;

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
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          {showSelectionControls ? (
            <p className="text-xs text-muted-foreground">
              {selectedCount
                ? `${selectedCount} selected`
                : `No ${(selectionLabel || title.toLowerCase())} selected`}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {headerActions}
          {hasMore && (
            <Button variant="outline" size="sm" onClick={() => setViewAllOpen(true)}>
              {viewAllLabel}
            </Button>
          )}
        </div>
      </div>

      {showSelectionControls ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">
            {items.length ? `${items.length} items` : emptyLabel}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleSelectAll}
              disabled={!items.length}
            >
              {allSelected ? deselectAllLabel : selectAllLabel}
            </Button>
            {removeSelectedLabel && selectedCount > 0 && onRemoveSelected ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onRemoveSelected}
                className="text-destructive hover:text-destructive"
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
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{viewAllTitle || title}</DialogTitle>
              <DialogDescription>Review all items in this list.</DialogDescription>
            </DialogHeader>
            <div className="bg-card border border-border rounded-xl p-4 overflow-hidden">
              {renderList(items)}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
