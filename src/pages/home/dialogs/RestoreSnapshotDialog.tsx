/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  AppDialog,
  AppDialogBody,
  AppDialogContent,
  AppDialogDescription,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogTitle,
} from "@/components/ui/app-surface";
import { Button } from "@/components/ui/button";
import { SNAPSHOT_TYPE_LIST } from "@/lib/snapshot/snapshotTypes";
import type { ReuRestoreMode } from "@/lib/reu/reuSnapshotTypes";
import type { RestorableSnapshotEntry } from "@/pages/home/types/restorableSnapshots";
import { isReuSnapshotEntry } from "@/pages/home/types/restorableSnapshots";

interface RestoreSnapshotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: RestorableSnapshotEntry | null;
  onConfirm: (mode?: ReuRestoreMode) => void;
  isPending: boolean;
}

export function RestoreSnapshotDialog({
  open,
  onOpenChange,
  snapshot,
  onConfirm,
  isPending,
}: RestoreSnapshotDialogProps) {
  if (!snapshot) return null;

  const typeConfig = SNAPSHOT_TYPE_LIST.find((c) => c.type === snapshot.snapshotType);
  const typeLabel = isReuSnapshotEntry(snapshot) ? "REU Snapshot" : (typeConfig?.label ?? snapshot.snapshotType);
  const ranges = snapshot.metadata.display_ranges.join(", ");
  const label = snapshot.metadata.label;
  const createdAt = snapshot.metadata.created_at;
  const contentName = snapshot.metadata.content_name ?? snapshot.filename;
  const isReuSnapshot = isReuSnapshotEntry(snapshot);

  return (
    <AppDialog open={open} onOpenChange={onOpenChange}>
      <AppDialogContent data-testid="restore-snapshot-dialog">
        <AppDialogHeader>
          <AppDialogTitle>{isReuSnapshot ? "Restore REU Snapshot" : "Restore Snapshot"}</AppDialogTitle>
          <AppDialogDescription>
            {isReuSnapshot
              ? "Choose how the uploaded REU image should be applied."
              : "This will overwrite the corresponding C64 memory regions."}
          </AppDialogDescription>
        </AppDialogHeader>

        <AppDialogBody>
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-1 text-sm">
            <div className="font-semibold">{typeLabel}</div>
            <div className="text-muted-foreground text-xs">{ranges}</div>
            <div className="text-muted-foreground text-xs">{contentName}</div>
            {label && <div className="text-foreground">{label}</div>}
            <div className="text-muted-foreground text-xs">{createdAt}</div>
          </div>
        </AppDialogBody>

        <AppDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          {isReuSnapshot ? (
            <>
              <Button
                variant="outline"
                onClick={() => onConfirm("preload-on-startup")}
                disabled={isPending}
                data-testid="restore-reu-preload"
              >
                {isPending ? "Applying…" : "Preload on Startup"}
              </Button>
              <Button onClick={() => onConfirm("load-into-reu")} disabled={isPending} data-testid="restore-reu-load">
                {isPending ? "Applying…" : "Load into REU"}
              </Button>
            </>
          ) : (
            <Button onClick={() => onConfirm()} disabled={isPending} data-testid="restore-snapshot-confirm">
              {isPending ? "Restoring…" : "Restore"}
            </Button>
          )}
        </AppDialogFooter>
      </AppDialogContent>
    </AppDialog>
  );
}
