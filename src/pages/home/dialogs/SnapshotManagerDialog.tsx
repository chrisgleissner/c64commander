/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState, type MouseEvent, type SyntheticEvent } from "react";
import {
  AppSheet,
  AppSheetBody,
  AppSheetContent,
  AppSheetDescription,
  AppSheetHeader,
  AppSheetTitle,
} from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { Trash2 } from "lucide-react";
import type { SnapshotStorageEntry, SnapshotType } from "@/lib/snapshot/snapshotTypes";
import { SNAPSHOT_TYPE_LIST } from "@/lib/snapshot/snapshotTypes";
import { filterSnapshots } from "@/lib/snapshot/snapshotFiltering";
import type { SnapshotTypeFilter } from "@/lib/snapshot/snapshotFiltering";

interface SnapshotManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshots: SnapshotStorageEntry[];
  onRestore: (snapshot: SnapshotStorageEntry) => void;
  onDelete: (id: string) => void;
  onUpdateLabel: (id: string, label: string) => void;
}

const TYPE_FILTERS: Array<{ value: SnapshotTypeFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "program", label: "Program" },
  { value: "basic", label: "Basic" },
  { value: "screen", label: "Screen" },
  { value: "custom", label: "Custom" },
];

function SnapshotRow({
  snapshot,
  onRestore,
  onDelete,
  onUpdateLabel,
}: {
  snapshot: SnapshotStorageEntry;
  onRestore: (s: SnapshotStorageEntry) => void;
  onDelete: (id: string) => void;
  onUpdateLabel: (id: string, label: string) => void;
}) {
  const { profile } = useDisplayProfile();
  const typeConfig = SNAPSHOT_TYPE_LIST.find((c) => c.type === snapshot.snapshotType);
  const typeLabel = typeConfig?.label ?? snapshot.snapshotType;
  const ranges = snapshot.metadata.display_ranges.join(", ");
  const label = snapshot.metadata.label;
  const createdAt = snapshot.metadata.created_at;
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(label ?? "");

  useEffect(() => {
    setLabelDraft(label ?? "");
  }, [label]);

  const handleEditOpen = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setLabelDraft(label ?? "");
    setIsEditingLabel(true);
  };

  const handleEditCancel = (event?: SyntheticEvent) => {
    event?.stopPropagation();
    setLabelDraft(label ?? "");
    setIsEditingLabel(false);
  };

  const handleEditSave = (event?: SyntheticEvent) => {
    event?.stopPropagation();
    onUpdateLabel(snapshot.id, labelDraft);
    setIsEditingLabel(false);
  };

  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-border bg-card p-3 hover:bg-accent/50 cursor-pointer transition-colors"
      data-testid="snapshot-row"
      onClick={() => onRestore(snapshot)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || isEditingLabel) return;
        if (e.key === "Enter" || e.key === " ") onRestore(snapshot);
      }}
    >
      <div className="flex-1 min-w-0 space-y-1">
        <div className="text-sm font-semibold leading-tight">{typeLabel}</div>
        <div className="text-xs text-muted-foreground">{ranges}</div>
        {!isEditingLabel ? (
          <button
            type="button"
            className={[
              "block max-w-full truncate text-left text-xs transition-colors hover:text-foreground",
              label ? "text-foreground" : "text-muted-foreground",
            ].join(" ")}
            data-testid={`snapshot-comment-toggle-${snapshot.id}`}
            onClick={handleEditOpen}
            aria-label={label ? "Edit snapshot comment" : "Add snapshot comment"}
          >
            {label ?? "Add comment..."}
          </button>
        ) : (
          <div
            className="rounded-md border border-border/60 bg-background p-2.5"
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className={
                profile === "expanded"
                  ? "grid grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-2 text-[11px]"
                  : "grid grid-cols-1 gap-2 text-[11px]"
              }
            >
              <div className="space-y-1">
                <label htmlFor={`snapshot-comment-${snapshot.id}`} className="text-muted-foreground">
                  Comment
                </label>
                <Input
                  id={`snapshot-comment-${snapshot.id}`}
                  value={labelDraft}
                  onChange={(event) => setLabelDraft(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleEditSave(event);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      handleEditCancel(event);
                    }
                  }}
                  data-testid={`snapshot-comment-input-${snapshot.id}`}
                  aria-label="Snapshot comment"
                  autoFocus
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleEditCancel}
                data-testid={`snapshot-comment-cancel-${snapshot.id}`}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleEditSave}
                data-testid={`snapshot-comment-confirm-${snapshot.id}`}
              >
                OK
              </Button>
            </div>
          </div>
        )}
        <div className="text-xs text-muted-foreground">{createdAt}</div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
        data-testid="snapshot-delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(snapshot.id);
        }}
        aria-label="Delete snapshot"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function SnapshotManagerDialog({
  open,
  onOpenChange,
  snapshots,
  onRestore,
  onDelete,
  onUpdateLabel,
}: SnapshotManagerDialogProps) {
  const { profile } = useDisplayProfile();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<SnapshotTypeFilter>("all");
  const compact = profile === "compact";

  const filtered = filterSnapshots(snapshots, query, typeFilter);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setQuery("");
      setTypeFilter("all");
    }
    onOpenChange(nextOpen);
  };

  return (
    <AppSheet open={open} onOpenChange={handleOpenChange}>
      <AppSheetContent className="overflow-hidden p-0" data-testid="snapshot-manager-dialog">
        <div className="flex h-full min-h-0 flex-col">
          <AppSheetHeader className={compact ? "px-4 pb-2 pt-4 pr-12" : "px-6 pb-3 pt-6 pr-14"}>
            <AppSheetTitle>Load RAM</AppSheetTitle>
            <AppSheetDescription className={compact ? "hidden" : undefined}>
              Select a snapshot to restore.
            </AppSheetDescription>
          </AppSheetHeader>

          <div
            className={
              compact
                ? "shrink-0 space-y-2 border-b border-border px-4 py-3"
                : "shrink-0 space-y-3 border-b border-border px-6 py-4"
            }
          >
            <Input
              placeholder="Filter snapshots…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="snapshot-filter-input"
            />

            <div className="flex gap-1 flex-wrap" data-testid="snapshot-type-filters">
              {TYPE_FILTERS.map(({ value, label }) => (
                <button
                  key={value}
                  data-testid={`snapshot-filter-type-${value}`}
                  className={[
                    "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                    typeFilter === value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-transparent text-muted-foreground border-border hover:bg-accent",
                  ].join(" ")}
                  onClick={() => setTypeFilter(value as SnapshotType | "all")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <AppSheetBody className={compact ? "px-4 py-3" : "px-6 py-4"} data-testid="snapshot-list">
            <div className="pr-2">
              <div className="space-y-2" data-testid="snapshot-list-content">
                {filtered.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground" data-testid="snapshot-empty">
                    {snapshots.length === 0 ? "No snapshots saved yet." : "No snapshots match the filter."}
                  </p>
                ) : (
                  filtered.map((snapshot) => (
                    <SnapshotRow
                      key={snapshot.id}
                      snapshot={snapshot}
                      onRestore={onRestore}
                      onDelete={onDelete}
                      onUpdateLabel={onUpdateLabel}
                    />
                  ))
                )}
              </div>
            </div>
          </AppSheetBody>
        </div>
      </AppSheetContent>
    </AppSheet>
  );
}
