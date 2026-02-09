/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { HardDrive, Monitor, Smartphone, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { DiskEntry } from '@/lib/disks/diskTypes';
import { wrapUserEvent } from '@/lib/tracing/userTrace';
import type { DiskTreeNode, DiskTreeState } from '@/lib/disks/diskTree';
import { pickDiskGroupColor } from '@/lib/disks/diskGroupColors';

const highlightText = (text: string, query: string) => {
  if (!query) return text;
  const lower = text.toLowerCase();
  const target = query.toLowerCase();
  const index = lower.indexOf(target);
  if (index < 0) return text;
  const before = text.slice(0, index);
  const match = text.slice(index, index + target.length);
  const after = text.slice(index + target.length);
  return (
    <>
      {before}
      <span className="bg-primary/10 text-foreground px-0.5 rounded">{match}</span>
      {after}
    </>
  );
};

const LocationIcon = ({ location }: { location: DiskEntry['location'] }) =>
  location === 'local' ? (
    <Smartphone className="h-4 w-4 text-primary/70" aria-label="Local disk" />
  ) : (
    <Monitor className="h-4 w-4 text-blue-500/70" aria-label="C64U disk" />
  );

export type DiskTreeProps = {
  tree: DiskTreeState;
  disksById: Record<string, DiskEntry>;
  filter: string;
  onDiskMount?: (disk: DiskEntry) => void;
  onDiskDelete?: (disk: DiskEntry) => void;
  onDiskGroup?: (disk: DiskEntry) => void;
  onDiskRename?: (disk: DiskEntry) => void;
  showSelection?: boolean;
  selectedDiskIds?: Set<string>;
  onDiskSelect?: (disk: DiskEntry, selected: boolean) => void;
  disableActions?: boolean;
};


const formatBytes = (value?: number | null) => {
  if (!value || value <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
};

const DiskRow = ({
  disk,
  matches,
  filter,
  selected,
  onSelectToggle,
  onDelete,
  onGroup,
  onRename,
  onMount,
  showSelection,
  disableActions,
}: {
  disk: DiskEntry;
  matches: boolean;
  filter: string;
  selected: boolean;
  onSelectToggle?: (disk: DiskEntry, selected: boolean) => void;
  showSelection: boolean;
  onMount?: (disk: DiskEntry) => void;
  onDelete?: (disk: DiskEntry) => void;
  onGroup?: (disk: DiskEntry) => void;
  onRename?: (disk: DiskEntry) => void;
  disableActions?: boolean;
}) => {
  const isDimmed = filter.length > 0 && !matches;
  const detailsDate = disk.modifiedAt || disk.importedAt;
  const groupColor = disk.group ? pickDiskGroupColor(disk.group) : null;
  return (
    <div
      className={cn(
        'flex items-center gap-2 py-2 px-1 rounded-md min-w-0',
        isDimmed ? 'opacity-40' : 'hover:bg-muted/40',
      )}
    >
      <div className="flex items-center gap-1 shrink-0">
        {showSelection ? (
          <Checkbox
            checked={selected}
            onCheckedChange={(value) => onSelectToggle?.(disk, Boolean(value))}
            aria-label={`Select ${disk.name}`}
          />
        ) : null}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 min-h-[44px] min-w-[44px]"
              aria-label="Disk actions"
              disabled={disableActions}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Details</DropdownMenuLabel>
            <DropdownMenuItem disabled>Size: {formatBytes(disk.sizeBytes)}</DropdownMenuItem>
            <DropdownMenuItem disabled>Date: {formatDate(detailsDate)}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onGroup?.(disk)} disabled={disableActions}>
              Set group…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRename?.(disk)} disabled={disableActions}>
              Rename disk…
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onDelete?.(disk)}
              disabled={disableActions}
              className="text-destructive focus:text-destructive"
            >
              Delete disk
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex flex-1 items-center gap-2 min-w-0">
        <div className="min-w-0">
          <button
            type="button"
            className="text-sm font-medium text-left hover:underline break-words whitespace-normal max-w-full"
            onClick={wrapUserEvent(() => onMount?.(disk), 'click', 'Disk', { title: disk.name }, 'DiskRow')}
            disabled={isDimmed || disableActions}
          >
            {highlightText(disk.name, filter)}
          </button>
          <div className="text-[11px] text-muted-foreground break-words whitespace-normal">
            {highlightText(disk.path, filter)}
          </div>
          {disk.group ? (
            <div className="text-[11px] text-muted-foreground flex items-center gap-1 min-w-0">
              <span
                className={cn('h-2 w-2 rounded-full border', groupColor?.chip)}
                aria-hidden="true"
              />
              <span className={cn(groupColor?.text, 'break-words whitespace-normal min-w-0')}>
                Group: {highlightText(disk.group, filter)}
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 min-h-[44px] min-w-[44px]"
        onClick={() => onMount?.(disk)}
        disabled={isDimmed || disableActions}
        aria-label={`Mount ${disk.name}`}
      >
        <HardDrive className="h-4 w-4" />
      </Button>
    </div>
  );
};

const FolderNode = ({
  node,
  depth,
  tree,
  disksById,
  filter,
  onDiskDelete,
  onDiskGroup,
  onDiskRename,
  onDiskMount,
  showSelection,
  selectedDiskIds,
  onDiskSelect,
  disableActions,
}: {
  node: DiskTreeNode;
  depth: number;
  tree: DiskTreeState;
  disksById: Record<string, DiskEntry>;
  filter: string;
  onDiskMount?: (disk: DiskEntry) => void;
  onDiskDelete?: (disk: DiskEntry) => void;
  onDiskGroup?: (disk: DiskEntry) => void;
  onDiskRename?: (disk: DiskEntry) => void;
  showSelection?: boolean;
  selectedDiskIds?: Set<string>;
  onDiskSelect?: (disk: DiskEntry, selected: boolean) => void;
  disableActions?: boolean;
}) => {
  if (node.type === 'disk') {
    const disk = node.diskId ? disksById[node.diskId] : null;
    if (!disk) return null;
    const matchInfo = node.diskId ? tree.matches[node.diskId]?.matches ?? false : false;
    const indent = Math.min(depth * 12, 48);
    return (
      <div style={{ paddingLeft: indent }} className="min-w-0">
        <DiskRow
          disk={disk}
          matches={matchInfo}
          filter={filter}
          selected={selectedDiskIds?.has(disk.id) ?? false}
          onSelectToggle={onDiskSelect}
          showSelection={showSelection ?? true}
          onMount={onDiskMount}
          onDelete={onDiskDelete}
          onGroup={onDiskGroup}
          onRename={onDiskRename}
          disableActions={disableActions}
        />
      </div>
    );
  }

  const hasMatch = tree.hasMatch(node);
  const isDimmed = filter.length > 0 && !hasMatch;
  const indent = Math.min(depth * 12, 48);
  return (
    <div
      className={cn('space-y-1 min-w-0', depth > 0 && 'border-l border-border/40 pl-3')}
      style={{ paddingLeft: indent }}
    >
      {node.id !== 'root' && (
        <div className={cn('text-xs font-semibold text-muted-foreground py-1 break-words min-w-0', isDimmed && 'opacity-40')}>
          {highlightText(node.name, filter)}
        </div>
      )}
      {node.children?.map((child, index) => {
        const prev = node.children?.[index - 1];
        const disk = child.type === 'disk' && child.diskId ? disksById[child.diskId] : null;
        const prevDisk = prev?.type === 'disk' && prev.diskId ? disksById[prev.diskId] : null;
        const showSeparator =
          disk && prevDisk && disk.group !== prevDisk.group && (disk.group || prevDisk.group);
        return (
          <div key={child.id}>
            {showSeparator ? <div className="my-2 border-t border-border/60" /> : null}
            <FolderNode
              node={child}
              depth={node.id === 'root' ? depth : depth + 1}
              tree={tree}
              disksById={disksById}
              filter={filter}
              onDiskMount={onDiskMount}
              onDiskDelete={onDiskDelete}
              onDiskGroup={onDiskGroup}
              onDiskRename={onDiskRename}
              showSelection={showSelection}
              selectedDiskIds={selectedDiskIds}
              onDiskSelect={onDiskSelect}
              disableActions={disableActions}
            />
          </div>
        );
      })}
    </div>
  );
};

export const DiskTree = ({
  tree,
  disksById,
  filter,
  onDiskMount,
  onDiskDelete,
  onDiskGroup,
  onDiskRename,
  showSelection,
  disableActions,
  selectedDiskIds,
  onDiskSelect,
}: DiskTreeProps) => {
  return (
    <div className="space-y-1 min-w-0">
      <FolderNode
        node={tree.root}
        depth={0}
        tree={tree}
        disksById={disksById}
        filter={filter}
        onDiskMount={onDiskMount}
        onDiskDelete={onDiskDelete}
        onDiskGroup={onDiskGroup}
        onDiskRename={onDiskRename}
        showSelection={showSelection}
        selectedDiskIds={selectedDiskIds}
        onDiskSelect={onDiskSelect}
        disableActions={disableActions}
      />
      {tree.root.children?.length === 0 && (
        <p className="text-xs text-muted-foreground">No disks imported yet.</p>
      )}
    </div>
  );
};
