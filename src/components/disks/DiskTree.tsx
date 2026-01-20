import { Monitor, Smartphone, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import type { DiskTreeNode, DiskTreeState } from '@/lib/disks/diskTree';

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
  disableActions?: boolean;
};

const groupColors = [
  { chip: 'bg-blue-500/20 border-blue-500/40', text: 'text-blue-700' },
  { chip: 'bg-emerald-500/20 border-emerald-500/40', text: 'text-emerald-700' },
  { chip: 'bg-indigo-500/20 border-indigo-500/40', text: 'text-indigo-700' },
  { chip: 'bg-teal-500/20 border-teal-500/40', text: 'text-teal-700' },
];

const pickGroupColor = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash + value.charCodeAt(i) * (i + 1)) % groupColors.length;
  }
  return groupColors[hash] || groupColors[0];
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
  onSelect,
  onDelete,
  onGroup,
  onRename,
  onMount,
  disableActions,
}: {
  disk: DiskEntry;
  matches: boolean;
  filter: string;
  onMount?: (disk: DiskEntry) => void;
  onDelete?: (disk: DiskEntry) => void;
  onGroup?: (disk: DiskEntry) => void;
  onRename?: (disk: DiskEntry) => void;
  disableActions?: boolean;
}) => {
  const isDimmed = filter.length > 0 && !matches;
  const detailsDate = disk.modifiedAt || disk.importedAt;
  const groupColor = disk.group ? pickGroupColor(disk.group) : null;
  return (
    <div
      className={cn(
        'flex items-start gap-2 py-2 px-1 rounded-md',
        isDimmed ? 'opacity-40' : 'hover:bg-muted/40',
      )}
    >
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => onMount?.(disk)}
        disabled={isDimmed || disableActions}
        aria-label={`Mount ${disk.name}`}
      >
        Mount
      </Button>
      <div className="flex flex-1 items-start gap-2 min-w-0">
        <LocationIcon location={disk.location} />
        <div className="min-w-0">
          <div className="text-sm font-medium break-words whitespace-normal">
            {highlightText(disk.name, filter)}
          </div>
          <div className="text-[11px] text-muted-foreground break-words whitespace-normal">
            {highlightText(disk.path, filter)}
          </div>
          {disk.group ? (
            <div className="text-[11px] text-muted-foreground flex items-center gap-1">
              <span
                className={cn('h-2 w-2 rounded-full border', groupColor?.chip)}
                aria-hidden="true"
              />
              <span className={cn(groupColor?.text)}>Group: {highlightText(disk.group, filter)}</span>
            </div>
          ) : null}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Disk actions"
            disabled={disableActions}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Details</DropdownMenuLabel>
          <DropdownMenuItem disabled>Size: {formatBytes(disk.sizeBytes)}</DropdownMenuItem>
          <DropdownMenuItem disabled>Date: {formatDate(detailsDate)}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onGroup?.(disk)} disabled={disableActions}>
            Set group…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onRename?.(disk)} disabled={disableActions}>
            Rename…
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
  disableActions?: boolean;
}) => {
  if (node.type === 'disk') {
    const disk = node.diskId ? disksById[node.diskId] : null;
    if (!disk) return null;
    const matchInfo = node.diskId ? tree.matches[node.diskId]?.matches ?? false : false;
    return (
      <div style={{ paddingLeft: depth * 12 }}>
        <DiskRow
          disk={disk}
          matches={matchInfo}
          filter={filter}
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
  return (
    <div style={{ paddingLeft: depth * 12 }}>
      {node.id !== 'root' && (
        <div className={cn('text-xs font-semibold text-muted-foreground py-1', isDimmed && 'opacity-40')}>
          {highlightText(node.name, filter)}
        </div>
      )}
      {node.children?.map((child) => (
        <FolderNode
          key={child.id}
          node={child}
          depth={node.id === 'root' ? depth : depth + 1}
          tree={tree}
          disksById={disksById}
          filter={filter}
          onDiskMount={onDiskMount}
          onDiskDelete={onDiskDelete}
          onDiskGroup={onDiskGroup}
          onDiskRename={onDiskRename}
          disableActions={disableActions}
        />
      ))}
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
  disableActions,
}: DiskTreeProps) => {
  return (
    <div className="space-y-1">
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
        disableActions={disableActions}
      />
      {tree.root.children?.length === 0 && (
        <p className="text-xs text-muted-foreground">No disks imported yet.</p>
      )}
    </div>
  );
};

