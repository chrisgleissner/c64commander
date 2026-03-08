/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
}

const TYPE_FILTERS: Array<{ value: SnapshotTypeFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "full", label: "Full" },
  { value: "basic", label: "BASIC" },
  { value: "screen", label: "Screen" },
  { value: "custom", label: "Custom" },
];

function SnapshotRow({
  snapshot,
  onRestore,
  onDelete,
}: {
  snapshot: SnapshotStorageEntry;
  onRestore: (s: SnapshotStorageEntry) => void;
  onDelete: (id: string) => void;
}) {
  const typeConfig = SNAPSHOT_TYPE_LIST.find((c) => c.type === snapshot.snapshotType);
  const typeLabel = typeConfig?.label ?? snapshot.snapshotType;
  const ranges = snapshot.metadata.display_ranges.join(", ");
  const label = snapshot.metadata.label;
  const createdAt = snapshot.metadata.created_at;

  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-border bg-card p-3 hover:bg-accent/50 cursor-pointer transition-colors"
      data-testid="snapshot-row"
      onClick={() => onRestore(snapshot)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onRestore(snapshot);
      }}
    >
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="text-sm font-semibold leading-tight">{typeLabel}</div>
        <div className="text-xs text-muted-foreground">{ranges}</div>
        {label && <div className="text-xs text-foreground">{label}</div>}
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
}: SnapshotManagerDialogProps) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<SnapshotTypeFilter>("all");

  const filtered = filterSnapshots(snapshots, query, typeFilter);

  const handleClose = () => {
    setQuery("");
    setTypeFilter("all");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md" data-testid="snapshot-manager-dialog">
        <DialogHeader>
          <DialogTitle>Load RAM</DialogTitle>
          <DialogDescription>Select a snapshot to restore.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Text filter */}
          <Input
            placeholder="Filter snapshots…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="snapshot-filter-input"
          />

          {/* Type filter tabs */}
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

          {/* Snapshot list */}
          <div className="space-y-2 max-h-[50vh] overflow-y-auto" data-testid="snapshot-list">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center" data-testid="snapshot-empty">
                {snapshots.length === 0 ? "No snapshots saved yet." : "No snapshots match the filter."}
              </p>
            ) : (
              filtered.map((s) => <SnapshotRow key={s.id} snapshot={s} onRestore={onRestore} onDelete={onDelete} />)
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
